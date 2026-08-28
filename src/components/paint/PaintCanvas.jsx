// Main paint workspace component.
// Edited to respect Dark Theme dynamically, integrated compact sidebar (removing Navigation pill),
// optimized undo/redo (action-based, user-local), and bandwidth-friendly delayed syncing.
import { useEffect, useRef, useState, useCallback } from "react";
import { Toolbar } from "./Toolbar";
import { savePage } from "./SavedPagesGallery";
import { toast } from "sonner";
import { downloadCanvasAsPDF, downloadPagesAsPDF } from "@/services/storageService";
import { useCollaboration } from "@/hooks/useCollaboration";
import { useSearchParams, Link } from "react-router-dom";
import { Users, Menu, Plus, X, Undo2, Redo2, Save, Download, Sun, Moon, LogOut, FileText, PaintBucket, Copy, Check, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { RoomDashboard } from "@/components/shared/RoomDashboard";
import { ConnectionBanner } from "@/components/shared/ConnectionBanner";
import { AuthContext } from "@/App";
import { useTheme } from "@/context/ThemeContext";
import { PDFDocument } from 'pdf-lib';
import { MagicSearchModal } from "@/components/shared/MagicSearchModal";
import { useContext } from "react";
import { useMedia } from "@/context/MediaContext";
import { rectFromPoints } from "@/lib/geometry";
import { renderStrokes, strokeHitTest, compactStrokes } from "@/lib/strokes";


// Use crypto.randomUUID() for collision-safe stroke IDs across tabs/clients/reloads
const newId = () => crypto.randomUUID();

export const PaintCanvas = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const { theme, toggleTheme } = useTheme();
  const { isAudioActive, toggleAudio, isVideoActive, toggleVideo } = useMedia();

  const [activeTool, setActiveTool] = useState("pencil");
  const [activeColor, setActiveColor] = useState(theme === "dark" ? "#ffffff" : "#000000");
  const [backgroundColor, setBackgroundColor] = useState(theme === "dark" ? "#121212" : "#ffffff");
  const [brushSize, setBrushSize] = useState(5);
  const [isMaximized, setIsMaximized] = useState(false);
  const [orientation, setOrientation] = useState("portrait");
  const [showDashboard, setShowDashboard] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const [magicSearchResponse, setMagicSearchResponse] = useState("");
  const [showMagicSearchModal, setShowMagicSearchModal] = useState(false);

  // ── Infinite canvas viewport ───────────────────────────────────────────────
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const [vpTick, setVpTick] = useState(0); // bumped to force cursor re-render
  const bumpVp = useCallback(() => setVpTick(v => v + 1), []);
  const isPanningRef = useRef(false);
  const panOriginRef = useRef({ cx: 0, cy: 0, vx: 0, vy: 0 });
  const isSpaceRef = useRef(false);
  const toWorld = useCallback((sx, sy) => {
    const { x, y, scale } = viewportRef.current;
    return { x: (sx - x) / scale, y: (sy - y) / scale };
  }, []);
  // Convert world coords → screen px
  const toScreen = useCallback((wx, wy) => {
    const { x, y, scale } = viewportRef.current;
    return { x: wx * scale + x, y: wy * scale + y };
  }, []);

  // Sync theme changes with default pen background behavior
  useEffect(() => {
    setBackgroundColor(theme === "dark" ? "#121212" : "#ffffff");
    setActiveColor(theme === "dark" ? "#ffffff" : "#000000");
  }, [theme]);

  const [searchParams, setSearchParams] = useSearchParams();
  const token = useContext(AuthContext);
  const roomId = searchParams.get("room");
  const searchString = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const { pagesMap, status, roomState, sendWsMessage } = useCollaboration(roomId, token);

  const userId = token ? (() => { try { return JSON.parse(atob(token.split(".")[1]))?.id; } catch { return null; } })() : null;
  const isHost = roomState?.hostId === userId;

  useEffect(() => {
    if (!roomId) {
      searchParams.set("room", Math.random().toString(36).substring(2, 8));
      setSearchParams(searchParams, { replace: true });
    }
  }, [roomId, searchParams, setSearchParams]);

  const [pages, setPages] = useState([{ id: "page-1", name: "Page 1" }]);
  const [currentPageId, setCurrentPageId] = useState("page-1");
  const currentPageIdRef = useRef("page-1");

  const allStrokesRef = useRef({ "page-1": [] });
  const undoStackRef = useRef({ "page-1": [] });
  const redoStackRef = useRef({ "page-1": [] });
  const [stackVersion, setStackVersion] = useState(0);
  const bumpVersion = useCallback(() => setStackVersion(v => v + 1), []);

  const getCurrentStrokes = useCallback(() => allStrokesRef.current[currentPageIdRef.current] ?? [], []);
  const setCurrentStrokes = useCallback((strokes) => { allStrokesRef.current[currentPageIdRef.current] = strokes; }, []);

  const getCtx = useCallback(() => canvasRef.current?.getContext("2d"), []);

  // applyVp: fill bg in screen-space, then render strokes in world-space
  const applyVp = useCallback((ctx, canvas, strokes, bgColor) => {
    const { x, y, scale } = viewportRef.current;
    const bg = bgColor ?? backgroundColor;
    ctx.setTransform(1, 0, 0, 1, 0, 0);       // screen space
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, x, y); // world space
    renderStrokes(ctx, canvas, strokes, bg, theme === "dark", true); // skipFill
    ctx.setTransform(1, 0, 0, 1, 0, 0);       // reset
  }, [backgroundColor, theme]);

  const redraw = useCallback((strokes, bgColor) => {
    const canvas = canvasRef.current; const ctx = getCtx();
    if (!canvas || !ctx) return;
    applyVp(ctx, canvas, strokes ?? getCurrentStrokes(), bgColor ?? backgroundColor);
  }, [getCtx, getCurrentStrokes, backgroundColor, applyVp]);

  const yjsSyncTimerRef = useRef(null);
  const isSyncingRef = useRef(false);
  const isInitialized = useRef(false);
  // B-4: Stable ref so pagesMap observer always reads latest backgroundColor
  // without the effect needing to tear down and re-register on every theme change.
  const bgColorRef = useRef(backgroundColor);
  useEffect(() => { bgColorRef.current = backgroundColor; }, [backgroundColor]);

  const syncToYjs = useCallback((strokes) => {
    if (!pagesMap || !isInitialized.current) return;
    clearTimeout(yjsSyncTimerRef.current);
    yjsSyncTimerRef.current = setTimeout(() => {
      isSyncingRef.current = true;
      try {
        const payload = JSON.stringify(compactStrokes(strokes ?? getCurrentStrokes()));
        pagesMap.set(`${currentPageIdRef.current}_strokes`, payload);
      } catch (e) {
        console.error('[Vani] syncToYjs error:', e);
      } finally {
        isSyncingRef.current = false;
      }
    }, 150);
  }, [pagesMap, getCurrentStrokes]);

  const syncPagesList = useCallback((pagesList) => {
    if (!pagesMap || !isInitialized.current) return;
    isSyncingRef.current = true;
    try {
      pagesMap.set("pagesList", JSON.stringify(pagesList.map((p) => ({ id: p.id, name: p.name }))));
    } catch (e) {
      console.error('[Vani] syncPagesList error:', e);
    } finally {
      isSyncingRef.current = false;
    }
  }, [pagesMap]);

  // LOCAL UNDO/REDO LOGIC
  const pushUndoAction = useCallback((action) => {
    const pId = currentPageIdRef.current;
    if (!undoStackRef.current[pId]) undoStackRef.current[pId] = [];
    undoStackRef.current[pId].push({ pageId: pId, ...action });
    if (undoStackRef.current[pId].length > 50) undoStackRef.current[pId].shift(); // O(N) but N=50 max, negligible
    redoStackRef.current[pId] = [];
    bumpVersion();
  }, []);

  const applyAction = useCallback((action, reverse = false) => {
    const isAdd = action.type === "add";
    const shouldAdd = reverse ? !isAdd : isAdd;
    const current = [...(allStrokesRef.current[action.pageId] || [])];

    if (shouldAdd) {
      allStrokesRef.current[action.pageId] = [...current, ...action.strokes];
    } else {
      const idsToRemove = new Set(action.strokes.map(s => s.id));
      allStrokesRef.current[action.pageId] = current.filter(s => !idsToRemove.has(s.id));
    }
  }, []);

  const handleUndo = useCallback(() => {
    const pId = currentPageIdRef.current;
    if (!undoStackRef.current[pId] || undoStackRef.current[pId].length === 0) return;
    const action = undoStackRef.current[pId].pop();
    if (!redoStackRef.current[pId]) redoStackRef.current[pId] = [];
    redoStackRef.current[pId].push(action);
    applyAction(action, true);
    const ctx = getCtx(); const canvas = canvasRef.current;
    if (canvas && ctx && action.pageId === pId) {
      const strokes = allStrokesRef.current[action.pageId];
      applyVp(ctx, canvas, strokes, bgColorRef.current);
      bumpVersion(); syncToYjs(strokes);
    }
  }, [getCtx, applyVp, syncToYjs, applyAction]);

  const handleRedo = useCallback(() => {
    const pId = currentPageIdRef.current;
    if (!redoStackRef.current[pId] || redoStackRef.current[pId].length === 0) return;
    const action = redoStackRef.current[pId].pop();
    if (!undoStackRef.current[pId]) undoStackRef.current[pId] = [];
    undoStackRef.current[pId].push(action);
    applyAction(action, false);
    const ctx = getCtx(); const canvas = canvasRef.current;
    if (canvas && ctx && action.pageId === pId) {
      const strokes = allStrokesRef.current[action.pageId];
      applyVp(ctx, canvas, strokes, bgColorRef.current);
      bumpVersion(); syncToYjs(strokes);
    }
  }, [getCtx, applyVp, syncToYjs, applyAction]);

  useEffect(() => {
    const canvas = canvasRef.current; const container = containerRef.current; if (!canvas || !container) return;
    canvas.width = container.clientWidth; canvas.height = container.clientHeight;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    isInitialized.current = true;
    const handleResize = () => {
      const saved = canvas.toDataURL("image/webp", 0.85); canvas.width = container.clientWidth; canvas.height = container.clientHeight;
      const img = new Image(); img.onload = () => { ctx.fillStyle = backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); }; img.src = saved;
    };
    window.addEventListener("resize", handleResize); return () => window.removeEventListener("resize", handleResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wheel: Ctrl+wheel=zoom, plain scroll=pan ───────────────────────────────
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    let rafId = null;
    const onWheel = (e) => {
      e.preventDefault();
      const vp = viewportRef.current;
      if (e.ctrlKey || e.metaKey) {
        // Use a continuous factor for smooth trackpad and mouse wheel zooming
        const factor = Math.exp(-e.deltaY * 0.005);
        const ns = Math.min(10, Math.max(0.1, vp.scale * factor));
        const rect = el.getBoundingClientRect();
        const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
        vp.x = ox - (ox - vp.x) * (ns / vp.scale);
        vp.y = oy - (oy - vp.y) * (ns / vp.scale);
        vp.scale = ns;
        bumpVp(); // Update zoom UI
      } else { 
        vp.x -= e.deltaX; 
        vp.y -= e.deltaY; 
        // No bumpVp for panning, avoids heavy React re-renders!
      }
      
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          redraw();
          rafId = null;
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [redraw, bumpVp]);

  // ── Space = pan mode ──────────────────────────────────────────────────────
  useEffect(() => {
    const kd = (e) => { if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); isSpaceRef.current = true; bumpVp(); } };
    const ku = (e) => { if (e.code === "Space") { isSpaceRef.current = false; isPanningRef.current = false; bumpVp(); } };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [bumpVp]);

  useEffect(() => {
    if (!pagesMap) return;
    const existingList = pagesMap.get("pagesList");
    if (existingList) {
      try {
        const remotePagesRaw = JSON.parse(existingList);
        remotePagesRaw.forEach((p) => { if (!allStrokesRef.current[p.id]) allStrokesRef.current[p.id] = []; });
        setPages(remotePagesRaw);
      } catch (e) { console.error('[Vani] Failed to parse remote pagesList:', e); }
    }
    Array.from(pagesMap.keys()).forEach(key => {
      if (key.endsWith("_strokes")) {
        const pageIdForStroke = key.replace("_strokes", "");
        try {
          allStrokesRef.current[pageIdForStroke] = JSON.parse(pagesMap.get(key));
        } catch (e) { console.error('[Vani] Failed to parse initial strokes for', pageIdForStroke, e); }
      }
    });
    redraw(allStrokesRef.current[currentPageIdRef.current] ?? [], bgColorRef.current);

    const observer = (event) => {
      if (event.keysChanged?.has("pagesList")) {
        const rawList = pagesMap.get("pagesList");
        if (rawList) {
          try {
            const remotePages = JSON.parse(rawList);
            remotePages.forEach((p) => { if (!allStrokesRef.current[p.id]) allStrokesRef.current[p.id] = []; });
            setPages(remotePages);
            if (!remotePages.find(p => p.id === currentPageIdRef.current) && remotePages.length > 0) {
              const firstId = remotePages[0].id; currentPageIdRef.current = firstId; setCurrentPageId(firstId);
              redraw(allStrokesRef.current[firstId] ?? [], bgColorRef.current);
            }
          } catch (e) { console.error('[Vani] Failed to parse remote pagesList update:', e); }
        }
      }
      if (!isSyncingRef.current && event.keysChanged) {
        event.keysChanged.forEach(key => {
          if (key.endsWith("_strokes")) {
            const pageIdForStroke = key.replace("_strokes", "");
            const payload = pagesMap.get(key);
            if (payload) {
              try {
                const remoteStrokes = JSON.parse(payload);
                allStrokesRef.current[pageIdForStroke] = remoteStrokes;
                if (pageIdForStroke === currentPageIdRef.current) {
                  redraw(remoteStrokes, bgColorRef.current);
                }
              } catch (e) { console.error('[Vani] Failed to parse remote strokes for', pageIdForStroke, e); }
            }
          }
        });
      }
    };
    pagesMap.observe(observer); return () => pagesMap.unobserve(observer);
  }, [pagesMap]); // bgColorRef is a stable ref, not a state — safe to omit from deps

  const prevBgRef = useRef(backgroundColor);
  useEffect(() => {
    if (!isInitialized.current || prevBgRef.current === backgroundColor) return;
    prevBgRef.current = backgroundColor;
    redraw(undefined, backgroundColor);
  }, [backgroundColor, redraw]);

  const isDrawing = useRef(false); const currentStrokeRef = useRef(null); const erasedStrokesRef = useRef([]);
  // C-2: Track erased IDs in a Set so pointerMove won't re-erase strokes that
  // setCurrentStrokes() hasn't flushed yet due to React state batching.
  const erasedStrokeIdsRef = useRef(new Set());
  const startPoint = useRef(null); const lastPoint = useRef(null); const strokeInitialImageRef = useRef(null);
  const [importedImage, setImportedImage] = useState(null); const [imagePos, setImagePos] = useState({ x: 0, y: 0 }); const [imageDim, setImageDim] = useState({ width: 0, height: 0 });
  const dragMode = useRef(null); const backupFileRef = useRef(null);

  // Returns world-space coords (accounting for viewport transform)
  const getPointerPos = (e) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX == null) return null;
    return toWorld(clientX - rect.left, clientY - rect.top);
  };
  // Returns raw screen coords (for pan tracking only)
  const getRawPos = (e) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0]?.clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0]?.clientY : e.clientY;
    return cx == null ? null : { x: cx - rect.left, y: cy - rect.top };
  };

  useEffect(() => {
    if (!importedImage) return; const canvas = canvasRef.current; const ctx = getCtx(); if (!canvas || !ctx) return;
    redraw(undefined, backgroundColor); ctx.drawImage(importedImage, imagePos.x, imagePos.y, imageDim.width, imageDim.height);
    ctx.strokeStyle = "#6366f1"; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.strokeRect(imagePos.x, imagePos.y, imageDim.width, imageDim.height); ctx.setLineDash([]);
    ctx.fillStyle = "#6366f1"; const hs = 8;
    [[imagePos.x, imagePos.y], [imagePos.x + imageDim.width, imagePos.y], [imagePos.x, imagePos.y + imageDim.height], [imagePos.x + imageDim.width, imagePos.y + imageDim.height]].forEach(([cx, cy]) => { ctx.beginPath(); ctx.arc(cx, cy, hs / 2, 0, Math.PI * 2); ctx.fill(); });
  }, [importedImage, imagePos, imageDim, backgroundColor, redraw, getCtx]);

  const handlePointerDown = (e) => {
    // Middle-mouse or Space → start pan
    if (e.button === 1 || isSpaceRef.current) {
      e.preventDefault(); isPanningRef.current = true;
      const raw = getRawPos(e);
      if (raw) panOriginRef.current = { cx: raw.x, cy: raw.y, vx: viewportRef.current.x, vy: viewportRef.current.y };
      return;
    }
    const pos = getPointerPos(e); if (!pos) return;
    const canvas = canvasRef.current; const ctx = getCtx(); if (!canvas || !ctx) return;
    if (importedImage && activeTool === "move") {
      const hs = 10, x1 = imagePos.x, y1 = imagePos.y, x2 = x1 + imageDim.width, y2 = y1 + imageDim.height;
      if (pos.x >= x1 - hs && pos.x <= x1 + hs && pos.y >= y1 - hs && pos.y <= y1 + hs) dragMode.current = "nw";
      else if (pos.x >= x2 - hs && pos.x <= x2 + hs && pos.y >= y1 - hs && pos.y <= y1 + hs) dragMode.current = "ne";
      else if (pos.x >= x1 - hs && pos.x <= x1 + hs && pos.y >= y2 - hs && pos.y <= y2 + hs) dragMode.current = "sw";
      else if (pos.x >= x2 - hs && pos.x <= x2 + hs && pos.y >= y2 - hs && pos.y <= y2 + hs) dragMode.current = "se";
      else if (pos.x > x1 && pos.x < x2 && pos.y > y1 && pos.y < y2) dragMode.current = "move";
    }
    isDrawing.current = true; lastPoint.current = pos; startPoint.current = pos;
    erasedStrokesRef.current = []; erasedStrokeIdsRef.current = new Set(); // reset for new gesture
    if (activeTool === "eraser") {
      const eraserRad = brushSize * 2; const initialLen = getCurrentStrokes().length;
      const remains = getCurrentStrokes().filter(s => {
        if (erasedStrokeIdsRef.current.has(s.id)) return false; // skip already erased
        const hit = strokeHitTest(s, pos.x, pos.y, eraserRad);
        if (hit) { erasedStrokesRef.current.push(s); erasedStrokeIdsRef.current.add(s.id); }
        return !hit;
      });
      if (remains.length !== initialLen) { setCurrentStrokes(remains); applyVp(ctx, canvas, remains, backgroundColor); }
      return;
    }
    strokeInitialImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const authorId = userId || "local";
    if (activeTool === "pencil" || activeTool === "highlighter") currentStrokeRef.current = { id: newId(), authorId, type: "freehand", tool: activeTool, color: activeColor, size: brushSize, opacity: activeTool === "highlighter" ? 0.4 : 1, points: [[pos.x, pos.y, e.pressure || 0.5]] };
    else if (["rectangle", "circle", "line", "magic_search"].includes(activeTool)) currentStrokeRef.current = { id: newId(), authorId, type: "shape", tool: activeTool, color: activeColor, size: brushSize, start: pos, end: pos };
  };

  const rafRef = useRef(null);

  const handlePointerMove = (e) => {
    // Pan mode
    if (isPanningRef.current) {
      const raw = getRawPos(e); if (!raw) return;
      viewportRef.current.x = panOriginRef.current.vx + (raw.x - panOriginRef.current.cx);
      viewportRef.current.y = panOriginRef.current.vy + (raw.y - panOriginRef.current.cy);
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          redraw();
          rafRef.current = null;
        });
      }
      return;
    }
    if (!isDrawing.current || dragMode.current) {
      if (dragMode.current) {
        const pos = getPointerPos(e); if (!pos) return;
        const dx = pos.x - lastPoint.current.x, dy = pos.y - lastPoint.current.y, dm = dragMode.current;
        if (dm === "move") setImagePos(p => ({ x: p.x + dx, y: p.y + dy }));
        else if (dm === "se") setImageDim(d => ({ width: Math.max(50, d.width + dx), height: Math.max(50, d.height + dy) }));
        else if (dm === "sw") { setImagePos(p => ({ ...p, x: p.x + dx })); setImageDim(d => ({ width: Math.max(50, d.width - dx), height: Math.max(50, d.height + dy) })); }
        else if (dm === "ne") { setImagePos(p => ({ ...p, y: p.y + dy })); setImageDim(d => ({ width: Math.max(50, d.width + dx), height: Math.max(50, d.height - dy) })); }
        else if (dm === "nw") { setImagePos(p => ({ x: p.x + dx, y: p.y + dy })); setImageDim(d => ({ width: Math.max(50, d.width - dx), height: Math.max(50, d.height - dy) })); }
        lastPoint.current = pos;
      }
      return;
    }
    const pos = getPointerPos(e); if (!pos) return;
    const canvas = canvasRef.current; const ctx = getCtx(); if (!canvas || !ctx) return;
    if (activeTool === "eraser") {
      const eraserRad = brushSize * 2;
      const remains = getCurrentStrokes().filter(s => {
        if (erasedStrokeIdsRef.current.has(s.id)) return false; // skip already-erased
        const hit = strokeHitTest(s, pos.x, pos.y, eraserRad);
        if (hit) { erasedStrokesRef.current.push(s); erasedStrokeIdsRef.current.add(s.id); }
        return !hit;
      });
      if (remains.length !== getCurrentStrokes().length) { setCurrentStrokes(remains); applyVp(ctx, canvas, remains, backgroundColor); }
      lastPoint.current = pos; return;
    }
    if (!currentStrokeRef.current) return;

    if (activeTool === "pencil" || activeTool === "highlighter") {
      currentStrokeRef.current.points.push([pos.x, pos.y, e.pressure || 0.5]);
      currentStrokeRef.current._path = null; // Invalidate cached path
    } else if (["rectangle", "circle", "line", "magic_search"].includes(activeTool)) {
      currentStrokeRef.current.end = pos;
    }

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        if (!currentStrokeRef.current) {
           rafRef.current = null;
           return;
        }

        if (activeTool === "magic_search") {
          redraw(); // draws background strokes
          const ctx = getCtx();
          if (ctx) {
            const { x: vx, y: vy, scale: vs } = viewportRef.current;
            ctx.save(); ctx.setTransform(vs, 0, 0, vs, vx, vy);
            ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
            const { start, end } = currentStrokeRef.current;
            ctx.setLineDash([5 / vs, 5 / vs]); // Scale dash pattern inversely
            ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
            ctx.restore();
          }
        } else {
          // Draw all committed strokes + the current stroke
          const strokesToDraw = [...getCurrentStrokes(), currentStrokeRef.current];
          redraw(strokesToDraw);
        }

        rafRef.current = null;
      });
    }
    lastPoint.current = pos;
  };

  const handlePointerUp = () => {
    if (isPanningRef.current) { isPanningRef.current = false; bumpVp(); return; }
    if (!isDrawing.current) return;
    isDrawing.current = false; dragMode.current = null; strokeInitialImageRef.current = null;
    if (activeTool === "eraser") {
      if (erasedStrokesRef.current.length > 0) pushUndoAction({ type: "remove", strokes: erasedStrokesRef.current });
      syncToYjs(); // Send batch erased state over network
      return;
    }

    if (activeTool === "magic_search" && currentStrokeRef.current) {
      const { start, end } = currentStrokeRef.current;
      // Convert world coords to screen coords because the physical canvas is in screen space
      const sStart = toScreen(start.x, start.y);
      const sEnd = toScreen(end.x, end.y);
      const { x: x1, y: y1, width, height } = rectFromPoints(sStart, sEnd);

      const canvas = canvasRef.current;
      if (canvas) {
        redraw(undefined, backgroundColor);

        // Create off-screen canvas for cropping
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext("2d");

        // Draw the cropped region from the main canvas onto the temp canvas
        tempCtx.drawImage(canvas, x1, y1, width, height, 0, 0, width, height);

        tempCanvas.toBlob((blob) => {
          const formData = new FormData();
          formData.append("file", blob, "crop.png");
          // No need to send points anymore since it's already cropped!

          toast.loading("Analyzing region...", { id: "magic_search" });
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
          fetch(backendUrl + "/api/ai/process", {
            method: "POST",
            body: formData,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }).then(res => res.json()).then(data => {
            if (data.error) throw new Error(data.error);
            toast.success("Analysis complete", { id: "magic_search" });
            setMagicSearchResponse(data.response);
            setShowMagicSearchModal(true);
            setActiveTool("pencil");
          }).catch(err => {
            toast.error("Analysis failed", { id: "magic_search" });
            setActiveTool("pencil");
          });
        }, "image/png");
      }

      currentStrokeRef.current = null;
      isDrawing.current = false; dragMode.current = null; strokeInitialImageRef.current = null;
      return;
    }

    if (currentStrokeRef.current) {
      pushUndoAction({ type: "add", strokes: [currentStrokeRef.current] });
      const strokes = [...getCurrentStrokes(), currentStrokeRef.current];
      setCurrentStrokes(strokes); currentStrokeRef.current = null; syncToYjs(strokes);
      redraw(); // explicitly render the final committed state
    }
    lastPoint.current = null; startPoint.current = null;
  };

  const hexToRgb = (hex) => { const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null; };
  const handleClick = (e) => {
    if (activeTool !== "fill") return;
    const pos = getPointerPos(e); if (!pos) return;
    const canvas = canvasRef.current, ctx = getCtx(); if (!canvas || !ctx) return;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height), data = imgData.data, { width, height } = canvas;
    const pi = (Math.floor(pos.y) * width + Math.floor(pos.x)) * 4, tc = { r: data[pi], g: data[pi + 1], b: data[pi + 2], a: data[pi + 3] }, nc = hexToRgb(activeColor);
    if (!nc || (tc.r === nc.r && tc.g === nc.g && tc.b === nc.b)) return;
    const q = [[Math.floor(pos.x), Math.floor(pos.y)]], visited = new Set();
    let head = 0;
    while (head < q.length) {
      const [cx, cy] = q[head++];
      const key = `${cx},${cy}`;
      if (visited.has(key) || cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      visited.add(key); const idx = (cy * width + cx) * 4;
      if (Math.abs(data[idx] - tc.r) < 15 && Math.abs(data[idx + 1] - tc.g) < 15 && Math.abs(data[idx + 2] - tc.b) < 15) {
        data[idx] = nc.r; data[idx + 1] = nc.g; data[idx + 2] = nc.b; data[idx + 3] = 255;
        // D-3: array push is amortized O(1), no shifting required
        q.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    const snapStroke = { id: newId(), authorId: userId || "local", type: "snapshot", data: canvas.toDataURL("image/webp", 0.7) };
    pushUndoAction({ type: "add", strokes: [snapStroke] });
    const strokes = [...getCurrentStrokes(), snapStroke]; setCurrentStrokes(strokes); syncToYjs(strokes); toast("Area filled!");
  };

  const handleClear = () => { pushUndoAction({ type: "remove", strokes: getCurrentStrokes() }); setCurrentStrokes([]); redraw([], backgroundColor); syncToYjs([]); toast("Canvas cleared!"); };

  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current; if (!canvas) return;
    savePage({ id: Date.now().toString(), name: `Drawing`, thumbnail: canvas.toDataURL("image/webp", 0.4), canvasData: canvas.toDataURL("image/webp", 0.85), createdAt: Date.now() }) ? toast.success("Saved") : toast.error("Failed");
  }, []);
  const handleDownload = useCallback(async () => { const canvas = canvasRef.current; if (!canvas) return; const res = await downloadCanvasAsPDF(canvas); res.success ? toast.success("Downloaded") : toast.error("Failed"); }, []);
  const handleDownloadAllPages = useCallback(async () => {
    const pagesWithContent = pages.filter(p => !!allStrokesRef.current[p.id]?.length); if (pagesWithContent.length === 0) return toast.error("No content");
    const res = await downloadPagesAsPDF(pagesWithContent.map(p => ({ ...p, canvasData: null })), "chanakya-drawings"); res.success ? toast.success("Downloaded") : toast.error("Failed");
  }, [pages]);

  const handleLoadPage = (canvasData) => {
    const canvas = canvasRef.current, ctx = getCtx(); if (!canvas || !ctx) return;
    const img = new Image(); img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0);
      const snap = { id: newId(), authorId: userId || "local", type: "snapshot", data: canvas.toDataURL("image/webp", 0.7) };
      pushUndoAction({ type: "add", strokes: [snap] }); setCurrentStrokes([snap]); syncToYjs([snap]); toast.success("Loaded");
    }; img.src = canvasData;
  };
  const handleLoadBackupFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => {
      try {
        const p = JSON.parse(r.result); if (!Array.isArray(p) || p.length === 0) return toast.error("Invalid");
        setPages(p); if (p[0]?.id) { setCurrentPageId(p[0].id); currentPageIdRef.current = p[0].id; }
        if (p[0]?.canvasData) handleLoadPage(p[0].canvasData); else toast.success("Restored");
      } catch { toast.error("Error"); }
    }; r.readAsText(file);
  };
  const handleImportImage = (data) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = new Image(); img.onload = () => {
      let w = img.width, h = img.height; if (w > canvas.width || h > canvas.height) { const ratio = Math.min(canvas.width / w, canvas.height / h); w *= ratio; h *= ratio; }
      setImportedImage(img); setImagePos({ x: (canvas.width - w) / 2, y: (canvas.height - h) / 2 }); setImageDim({ width: w, height: h }); setActiveTool("move"); toast.success("Drag and place");
    }; img.src = data;
  };
  const handlePlaceImage = () => {
    if (!importedImage) return; const canvas = canvasRef.current, ctx = getCtx(); if (!canvas || !ctx) return;
    redraw(undefined, backgroundColor); ctx.drawImage(importedImage, imagePos.x, imagePos.y, imageDim.width, imageDim.height);
    const snap = { id: newId(), authorId: userId || "local", type: "snapshot", data: canvas.toDataURL("image/webp", 0.8) };
    pushUndoAction({ type: "add", strokes: [snap] }); const strokes = [...getCurrentStrokes(), snap]; setCurrentStrokes(strokes); syncToYjs(strokes);
    setImportedImage(null); setActiveTool("pencil"); toast.success("Placed");
  };

  const handleAddPage = () => {
    const newId = `page-${Date.now()}`; const newPages = [...pages, { id: newId, name: `Page ${pages.length + 1}` }];
    allStrokesRef.current[newId] = []; setPages(newPages); setCurrentPageId(newId); currentPageIdRef.current = newId;
    bumpVersion();
    const ctx = getCtx(), canvas = canvasRef.current; if (ctx && canvas) { ctx.fillStyle = backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    syncPagesList(newPages); toast.success("New page");
  };
  const handleDeletePage = (pageId) => {
    if (!isHost) return toast.error("Only the host can delete pages"); if (pages.length <= 1) return toast.error("Cannot delete last page");
    const newPages = pages.filter(p => p.id !== pageId).map((p, i) => ({ ...p, name: `Page ${i + 1}` }));
    delete allStrokesRef.current[pageId];
    if (pageId === currentPageIdRef.current) {
      const nextId = newPages[0].id; setCurrentPageId(nextId); currentPageIdRef.current = nextId;
      const ctx = getCtx(), canvas = canvasRef.current; if (ctx && canvas) renderStrokes(ctx, canvas, allStrokesRef.current[nextId] ?? [], backgroundColor, theme === "dark");
      bumpVersion();
    }
    setPages(newPages);
    if (pagesMap) {
      try { pagesMap.delete(`${pageId}_strokes`); }
      catch (e) { console.error('[Vani] Failed to delete page strokes from Yjs:', e); }
    }
    syncPagesList(newPages); toast.success("Deleted");
  };
  const handleSwitchPage = (pageId) => {
    if (pageId === currentPageIdRef.current) return;
    setCurrentPageId(pageId);
    currentPageIdRef.current = pageId;
    bumpVersion();
    // C-3: Read canvasRef.current again here — setCurrentPageId is async
    // and the previous `canvas` capture may point to a stale layout.
    const freshCanvas = canvasRef.current;
    const ctx = getCtx();
    if (ctx && freshCanvas) applyVp(ctx, freshCanvas, allStrokesRef.current[pageId] ?? [], backgroundColor);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in input fields (like the AI assistant)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") { e.preventDefault(); handleUndo(); } else if (e.key === "y") { e.preventDefault(); handleRedo(); } else if (e.key === "s") { e.preventDefault(); handleSave(); }
      } else {
        switch (e.key.toLowerCase()) { case "p": setActiveTool("pencil"); break; case "e": setActiveTool("eraser"); break; case "r": setActiveTool("rectangle"); break; case "c": setActiveTool("circle"); break; case "l": setActiveTool("line"); break; case "g": setActiveTool("fill"); break; }
      }
    }; window.addEventListener("keydown", handleKeyDown); return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, handleSave]);

  const canUndo = (undoStackRef.current[currentPageId] && undoStackRef.current[currentPageId].length > 0);
  const canRedo = (redoStackRef.current[currentPageId] && redoStackRef.current[currentPageId].length > 0);
  const isActivePan = isPanningRef.current || isSpaceRef.current;
  const canvasCursor = isActivePan ? (isPanningRef.current ? "grabbing" : "grab") : activeTool === "fill" ? "cell" : activeTool === "move" ? "move" : "crosshair";
  const zoomPct = Math.round(viewportRef.current.scale * 100);

  return (
    <div className={`h-screen w-screen overflow-hidden ${theme === 'dark' ? 'bg-[#121212]' : 'bg-[#ffffff]'} relative font-sans select-none transition-colors duration-300`}>
      {/* G-1: Offline/Reconnecting UI */}
      <ConnectionBanner status={status} />
      <div className="absolute inset-0 z-0">
        <div ref={containerRef} className="w-full h-full">
          <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: canvasCursor }}
            onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp} onTouchStart={handlePointerDown} onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp} onClick={handleClick} />
        </div>
      </div>
      {/* Zoom badge */}
      <div className="glass-panel absolute bottom-14 right-3 z-40 pointer-events-none rounded-lg px-2 py-0.5 text-xs font-mono text-toolbar-foreground/80">{zoomPct}%</div>

      {/* ── Top-Left: Universal Navigation & Hamburger Menu ────────────────── */}
      <div className="absolute top-3 left-3 z-40 pointer-events-auto flex items-center gap-2">
        <div className="relative">
          <button onClick={() => setShowMenu(v => !v)} className="glass-panel w-9 h-9 flex items-center justify-center rounded-lg text-toolbar-foreground hover:bg-toolbar-hover transition-all duration-150 hover:scale-105 active:scale-95" title="Menu"><Menu className="w-4 h-4" /></button>
          {showMenu && (
            <div className="glass-panel-strong animate-glass-in absolute top-11 left-0 w-56 rounded-xl overflow-hidden z-50">
              <div className="p-2 space-y-1">
                <button onClick={() => { handleSave(); setShowMenu(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-toolbar-foreground hover:bg-toolbar-hover transition-colors rounded-md"><Save className="w-4 h-4" /> Save to Gallery</button>
                <button onClick={() => { handleDownload(); setShowMenu(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-toolbar-foreground hover:bg-toolbar-hover transition-colors rounded-md"><Download className="w-4 h-4" /> Download PDF</button>
                <div className="w-full h-px bg-toolbar-foreground/10 my-1" />
                <button onClick={() => { backupFileRef.current?.click(); setShowMenu(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-orange-400 hover:bg-toolbar-hover transition-colors rounded-md"><Menu className="w-4 h-4" /> Load Backup</button>
              </div>
            </div>
          )}
          <input ref={backupFileRef} type="file" accept=".json" onChange={handleLoadBackupFile} className="hidden" />
        </div>

        {/* Undo/Redo are adjacent to menu */}
        <button onClick={handleUndo} disabled={!canUndo} className="glass-panel w-9 h-9 flex items-center justify-center rounded-lg text-toolbar-foreground hover:bg-toolbar-hover disabled:opacity-30 transition-all duration-150 hover:scale-105 active:scale-95 disabled:hover:scale-100"><Undo2 className="w-4 h-4" /></button>
        <button onClick={handleRedo} disabled={!canRedo} className="glass-panel w-9 h-9 flex items-center justify-center rounded-lg text-toolbar-foreground hover:bg-toolbar-hover disabled:opacity-30 transition-all duration-150 hover:scale-105 active:scale-95 disabled:hover:scale-100"><Redo2 className="w-4 h-4" /></button>
      </div>

      {/* ── Top-Right: Dashboard & Streams ───────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-40 flex items-center gap-2 pointer-events-auto">
        <span title={status === "connected" ? "Connected" : "Disconnected"} className={`w-2.5 h-2.5 rounded-full transition-colors ${status === "connected" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]" : "bg-red-400"}`} />
        <button onClick={toggleVideo} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150 hover:scale-105 active:scale-95 ${isVideoActive ? 'bg-blue-500 text-white shadow-[0_4px_14px_rgba(59,130,246,0.45)]' : 'glass-panel text-toolbar-foreground hover:bg-toolbar-hover'}`} title={isVideoActive ? "Disconnect Video" : "Join Video Call"}>
          {isVideoActive ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>
        <button onClick={toggleAudio} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150 hover:scale-105 active:scale-95 ${isAudioActive ? 'bg-green-500 text-white shadow-[0_4px_14px_rgba(34,197,94,0.45)]' : 'glass-panel text-toolbar-foreground hover:bg-toolbar-hover'}`} title={isAudioActive ? "Disconnect Audio" : "Join Audio"}>
          {isAudioActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>
        <button onClick={() => setShowDashboard(true)} className="glass-panel w-9 h-9 flex items-center justify-center rounded-lg text-toolbar-foreground hover:bg-toolbar-hover transition-all duration-150 hover:scale-105 active:scale-95" title="Collaboration Dashboard"><Users className="w-4 h-4" /></button>
      </div>

      {/* ── Top-Center: Drawing Tools ──────────────────────────────────────── */}
      {!isMaximized && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
          <div className="glass-panel-strong rounded-xl px-1 py-0.5">
            <Toolbar activeTool={activeTool} onToolChange={setActiveTool} activeColor={activeColor} onColorChange={setActiveColor} backgroundColor={backgroundColor} onBackgroundColorChange={setBackgroundColor} brushSize={brushSize} onBrushSizeChange={setBrushSize} onClear={handleClear} onSave={undefined} onLoadPage={handleLoadPage} canUndo={false} canRedo={false} onDownload={undefined} onDownloadAllPages={handleDownloadAllPages} onLoadBackupFile={undefined} onImportImage={handleImportImage} onAddPage={handleAddPage} onSwitchPage={handleSwitchPage} pages={pages} currentPageId={currentPageId} isMaximized={isMaximized} onToggleMaximize={() => setIsMaximized(!isMaximized)} orientation={orientation} onToggleOrientation={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")} onPlaceImage={handlePlaceImage} hasImportedImage={!!importedImage} backupFileRef={backupFileRef} />
          </div>
        </div>
      )}

      {/* ── Bottom-Center: Page Tabs ───────────────────────────────────────── */}
      {!isMaximized && (
        <div className="glass-panel-strong absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 pointer-events-auto rounded-xl p-1 max-w-[70vw] overflow-x-auto">
          {pages.map((page) => (
            <div key={page.id} className="relative flex-shrink-0 flex items-center">
              <button onClick={() => handleSwitchPage(page.id)} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all duration-150 whitespace-nowrap ${currentPageId === page.id ? "bg-toolbar-active text-accent-foreground pr-6 shadow-[0_2px_10px_hsl(var(--toolbar-active)/0.4)]" : "text-toolbar-foreground hover:bg-toolbar-hover"}`}>{page.name}</button>
              {isHost && pages.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); handleDeletePage(page.id); }} className={`absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full transition-colors ${currentPageId === page.id ? "text-accent-foreground/70 hover:text-accent-foreground hover:bg-white/10" : "text-toolbar-foreground/40 hover:text-red-400 hover:bg-red-500/10"}`} title={`Delete ${page.name}`}><X className="w-2.5 h-2.5" /></button>
              )}
            </div>
          ))}
          <button onClick={handleAddPage} className="w-7 h-7 flex items-center justify-center rounded-lg text-toolbar-foreground/60 hover:bg-toolbar-hover hover:text-toolbar-foreground transition-all duration-150 hover:scale-110 flex-shrink-0" title="Add Page"><Plus className="w-4 h-4" /></button>
        </div>
      )}

      {showMenu && <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />}
      <RoomDashboard show={showDashboard} onClose={() => setShowDashboard(false)} roomState={roomState} isHost={isHost} onAssignOwner={(id) => sendWsMessage({ type: "assign_owner", targetUserId: id })} />

      {/* ── Magic Search Response Modal ───────────────────────────────────────── */}
      <MagicSearchModal
        open={showMagicSearchModal}
        response={magicSearchResponse}
        onClose={() => setShowMagicSearchModal(false)}
      />

    </div>
  );
};