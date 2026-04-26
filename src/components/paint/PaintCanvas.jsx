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
import { Users, Menu, Plus, X, Undo2, Redo2, Save, Download, Sun, Moon, LogOut, FileText, PaintBucket, Copy, Check } from "lucide-react";
import { RoomDashboard } from "@/components/shared/RoomDashboard";
import { getStroke } from "perfect-freehand";
import { useTheme } from "@/context/ThemeContext";

function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ["M", stroke[0][0], stroke[0][1], "Q"]);
  d.push("Z");
  return d.join(" ");
}

// ─── Theme-aware color adaptation ─────────────────────────────────────────
// Converts a hex color to HSL components.
function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

// Converts HSL back to a hex string.
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Returns an adapted color visible on the current theme background without modifying the original.
function adaptColorForTheme(color, isDark) {
  if (!color || !color.startsWith('#')) return color;
  try {
    const { h, s, l } = hexToHsl(color);
    if (isDark) {
      // Dark background: if the stroke is too dark (black, navy, dark grey…), lighten it significantly.
      if (l < 45) return hslToHex(h, Math.min(s + 10, 100), Math.max(l + 55, 75));
    } else {
      // Light background: if the stroke is too light (white, pale yellow…), darken it.
      if (l > 75) return hslToHex(h, Math.min(s + 10, 100), Math.min(l - 50, 35));
    }
  } catch { /* malformed color — fall through */ }
  return color; // original color is already fine for this theme
}

function renderStrokes(ctx, canvas, strokes, bgColor, isDark = false) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    const drawColor = adaptColorForTheme(s.color, isDark);
    if (s.type === "freehand") {
      const drawn = getStroke(s.points, { size: s.size, thinning: s.tool === "highlighter" ? 0 : 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: true });
      const pathData = getSvgPathFromStroke(drawn);
      if (!pathData) continue;
      ctx.save(); ctx.globalAlpha = s.opacity ?? 1; ctx.fillStyle = drawColor; ctx.fill(new Path2D(pathData)); ctx.restore();
    } else if (s.type === "shape") {
      ctx.save(); ctx.strokeStyle = drawColor; ctx.lineWidth = s.size; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const { start, end } = s;
      if (s.tool === "rectangle") ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      else if (s.tool === "circle") { const r = Math.hypot(end.x - start.x, end.y - start.y); ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); }
      ctx.restore();
    } else if (s.type === "snapshot") {
      const img = new Image(); img.src = s.data;
      if (img.complete) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
  }
}

function strokeHitTest(stroke, px, py, eraserRadius) {
  if (stroke.type === "freehand") {
    const threshold = eraserRadius + stroke.size / 2;
    return stroke.points.some(([x, y]) => Math.hypot(x - px, y - py) < threshold);
  }
  if (stroke.type === "shape") {
    const { start, end } = stroke;
    const minX = Math.min(start.x, end.x) - eraserRadius, maxX = Math.max(start.x, end.x) + eraserRadius;
    const minY = Math.min(start.y, end.y) - eraserRadius, maxY = Math.max(start.y, end.y) + eraserRadius;
    return px >= minX && px <= maxX && py >= minY && py <= maxY;
  }
  return false;
}

function compactStrokes(strokes) {
  return strokes.map((s) => s.type === "freehand" ? { ...s, points: s.points.map(([x, y, p]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2, Math.round(p * 100) / 100]) } : s);
}

let _sid = 0; const newId = () => `s${Date.now()}_${_sid++}`;

export const PaintCanvas = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const { theme, toggleTheme } = useTheme();

  const [activeTool, setActiveTool] = useState("pencil");
  const [activeColor, setActiveColor] = useState(theme === "dark" ? "#ffffff" : "#000000");
  const [backgroundColor, setBackgroundColor] = useState(theme === "dark" ? "#121212" : "#ffffff");
  const [brushSize, setBrushSize] = useState(5);
  const [isMaximized, setIsMaximized] = useState(false);
  const [orientation, setOrientation] = useState("portrait");
  const [showDashboard, setShowDashboard] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Sync theme changes with default pen background behavior
  useEffect(() => {
    setBackgroundColor(theme === "dark" ? "#121212" : "#ffffff");
    setActiveColor(theme === "dark" ? "#ffffff" : "#000000");
  }, [theme]);

  const [searchParams, setSearchParams] = useSearchParams();
  const token = localStorage.getItem("auth_token");
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
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [stackVersion, setStackVersion] = useState(0);
  const bumpVersion = () => setStackVersion((v) => v + 1);

  const getCurrentStrokes = useCallback(() => allStrokesRef.current[currentPageIdRef.current] ?? [], []);
  const setCurrentStrokes = useCallback((strokes) => { allStrokesRef.current[currentPageIdRef.current] = strokes; }, []);

  const getCtx = useCallback(() => canvasRef.current?.getContext("2d"), []);
  const redraw = useCallback((strokes, bgColor) => {
    const canvas = canvasRef.current; const ctx = getCtx();
    if (!canvas || !ctx) return;
    renderStrokes(ctx, canvas, strokes ?? getCurrentStrokes(), bgColor ?? backgroundColor, theme === "dark");
  }, [getCtx, getCurrentStrokes, backgroundColor, theme]);

  const yjsSyncTimerRef = useRef(null);
  const isSyncingRef = useRef(false);
  const isInitialized = useRef(false);

  const syncToYjs = useCallback((strokes) => {
    if (!pagesMap || !isInitialized.current) return;
    clearTimeout(yjsSyncTimerRef.current);
    yjsSyncTimerRef.current = setTimeout(() => {
      try {
        const payload = JSON.stringify(compactStrokes(strokes ?? getCurrentStrokes()));
        isSyncingRef.current = true;
        pagesMap.set(`${currentPageIdRef.current}_strokes`, payload);
        isSyncingRef.current = false;
      } catch (e) { console.error("Yjs error", e); }
    }, 150);
  }, [pagesMap, getCurrentStrokes]);

  const syncPagesList = useCallback((pagesList) => {
    if (!pagesMap || !isInitialized.current) return;
    try { isSyncingRef.current = true; pagesMap.set("pagesList", JSON.stringify(pagesList.map((p) => ({ id: p.id, name: p.name })))); isSyncingRef.current = false; } catch (e) { }
  }, [pagesMap]);

  // LOCAL UNDO/REDO LOGIC
  const pushUndoAction = useCallback((action) => {
    undoStackRef.current.push({ pageId: currentPageIdRef.current, ...action });
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
    bumpVersion();
  }, []);

  const applyAction = useCallback((action, reverse = false) => {
    const isAdd = action.type === "add";
    const shouldAdd = reverse ? !isAdd : isAdd;
    const current = [...allStrokesRef.current[action.pageId]];
    
    if (shouldAdd) {
      // Adding back strokes
      allStrokesRef.current[action.pageId] = [...current, ...action.strokes];
    } else {
      // Removing strokes
      const idsToRemove = new Set(action.strokes.map(s => s.id));
      allStrokesRef.current[action.pageId] = current.filter(s => !idsToRemove.has(s.id));
    }
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const action = undoStackRef.current.pop();
    redoStackRef.current.push(action);
    applyAction(action, true); // reverse
    const ctx = getCtx(); const canvas = canvasRef.current;
    if (canvas && ctx && action.pageId === currentPageIdRef.current) {
      const strokes = allStrokesRef.current[action.pageId];
      renderStrokes(ctx, canvas, strokes, backgroundColor, theme === "dark");
      bumpVersion(); syncToYjs(strokes);
    }
  }, [getCtx, backgroundColor, syncToYjs, applyAction]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const action = redoStackRef.current.pop();
    undoStackRef.current.push(action);
    applyAction(action, false); // normal
    const ctx = getCtx(); const canvas = canvasRef.current;
    if (canvas && ctx && action.pageId === currentPageIdRef.current) {
      const strokes = allStrokesRef.current[action.pageId];
      renderStrokes(ctx, canvas, strokes, backgroundColor, theme === "dark");
      bumpVersion(); syncToYjs(strokes);
    }
  }, [getCtx, backgroundColor, syncToYjs, applyAction]);

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

  useEffect(() => {
    if (!pagesMap) return;
    const existingList = pagesMap.get("pagesList");
    if (existingList) {
      try {
        const remotePagesRaw = JSON.parse(existingList);
        remotePagesRaw.forEach((p) => { if (!allStrokesRef.current[p.id]) allStrokesRef.current[p.id] = []; });
        setPages(remotePagesRaw);
      } catch { }
    }
    Array.from(pagesMap.keys()).forEach(key => {
      if (key.endsWith("_strokes")) {
        const pageIdForStroke = key.replace("_strokes", "");
        try {
          allStrokesRef.current[pageIdForStroke] = JSON.parse(pagesMap.get(key));
        } catch { }
      }
    });
    redraw(allStrokesRef.current[currentPageIdRef.current] ?? [], backgroundColor);

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
              redraw(allStrokesRef.current[firstId] ?? [], backgroundColor);
            }
          } catch { }
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
                  redraw(remoteStrokes, backgroundColor);
                }
              } catch { }
            }
          }
        });
      }
    };
    pagesMap.observe(observer); return () => pagesMap.unobserve(observer);
  }, [pagesMap, backgroundColor]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevBgRef = useRef(backgroundColor);
  useEffect(() => {
    if (!isInitialized.current || prevBgRef.current === backgroundColor) return;
    prevBgRef.current = backgroundColor;
    redraw(undefined, backgroundColor);
  }, [backgroundColor, redraw]);

  const isDrawing = useRef(false); const currentStrokeRef = useRef(null); const erasedStrokesRef = useRef([]);
  const startPoint = useRef(null); const lastPoint = useRef(null); const strokeInitialImageRef = useRef(null);
  const [importedImage, setImportedImage] = useState(null); const [imagePos, setImagePos] = useState({ x: 0, y: 0 }); const [imageDim, setImageDim] = useState({ width: 0, height: 0 });
  const dragMode = useRef(null); const backupFileRef = useRef(null);

  const getPointerPos = (e) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(); const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX; const clientY = "touches" in e ? e.touches[0]?.clientY : e.clientY;
    return clientX == null ? null : { x: clientX - rect.left, y: clientY - rect.top };
  };

  useEffect(() => {
    if (!importedImage) return; const canvas = canvasRef.current; const ctx = getCtx(); if (!canvas || !ctx) return;
    redraw(undefined, backgroundColor); ctx.drawImage(importedImage, imagePos.x, imagePos.y, imageDim.width, imageDim.height);
    ctx.strokeStyle = "#6366f1"; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.strokeRect(imagePos.x, imagePos.y, imageDim.width, imageDim.height); ctx.setLineDash([]);
    ctx.fillStyle = "#6366f1"; const hs = 8;
    [[imagePos.x, imagePos.y], [imagePos.x + imageDim.width, imagePos.y], [imagePos.x, imagePos.y + imageDim.height], [imagePos.x + imageDim.width, imagePos.y + imageDim.height]].forEach(([cx, cy]) => { ctx.beginPath(); ctx.arc(cx, cy, hs / 2, 0, Math.PI * 2); ctx.fill(); });
  }, [importedImage, imagePos, imageDim, backgroundColor, redraw, getCtx]);

  const handlePointerDown = (e) => {
    const pos = getPointerPos(e); if (!pos) return;
    const canvas = canvasRef.current; const ctx = getCtx(); if (!canvas || !ctx) return;
    if (importedImage && activeTool === "move") {
      const hs = 10, x1 = imagePos.x, y1 = imagePos.y, x2 = x1 + imageDim.width, y2 = y1 + imageDim.height;
      if (pos.x >= x1-hs && pos.x <= x1+hs && pos.y >= y1-hs && pos.y <= y1+hs) dragMode.current = "nw";
      else if (pos.x >= x2-hs && pos.x <= x2+hs && pos.y >= y1-hs && pos.y <= y1+hs) dragMode.current = "ne";
      else if (pos.x >= x1-hs && pos.x <= x1+hs && pos.y >= y2-hs && pos.y <= y2+hs) dragMode.current = "sw";
      else if (pos.x >= x2-hs && pos.x <= x2+hs && pos.y >= y2-hs && pos.y <= y2+hs) dragMode.current = "se";
      else if (pos.x > x1 && pos.x < x2 && pos.y > y1 && pos.y < y2) dragMode.current = "move";
    }
    isDrawing.current = true; lastPoint.current = pos; startPoint.current = pos; erasedStrokesRef.current = [];
    if (activeTool === "eraser") {
      const eraserRad = brushSize * 2; const initialLen = getCurrentStrokes().length;
      const remains = getCurrentStrokes().filter(s => {
        const hit = strokeHitTest(s, pos.x, pos.y, eraserRad); if(hit) erasedStrokesRef.current.push(s); return !hit;
      });
      if (remains.length !== initialLen) { setCurrentStrokes(remains); renderStrokes(ctx, canvas, remains, backgroundColor, theme === "dark"); } // no Yjs sync yet! delay to Up.
      return;
    }
    strokeInitialImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const authorId = userId || "local";
    if (activeTool === "pencil" || activeTool === "highlighter") currentStrokeRef.current = { id: newId(), authorId, type: "freehand", tool: activeTool, color: activeColor, size: brushSize, opacity: activeTool === "highlighter" ? 0.4 : 1, points: [[pos.x, pos.y, e.pressure || 0.5]] };
    else if (["rectangle", "circle", "line"].includes(activeTool)) currentStrokeRef.current = { id: newId(), authorId, type: "shape", tool: activeTool, color: activeColor, size: brushSize, start: pos, end: pos };
  };

  const handlePointerMove = (e) => {
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
      const eraserRad = brushSize * 2; const remains = getCurrentStrokes().filter(s => { const hit = strokeHitTest(s, pos.x, pos.y, eraserRad); if(hit) erasedStrokesRef.current.push(s); return !hit; });
      if (remains.length !== getCurrentStrokes().length) { setCurrentStrokes(remains); renderStrokes(ctx, canvas, remains, backgroundColor, theme === "dark"); }
      lastPoint.current = pos; return;
    }
    if (!currentStrokeRef.current) return;
    if (activeTool === "pencil" || activeTool === "highlighter") {
      currentStrokeRef.current.points.push([pos.x, pos.y, e.pressure || 0.5]);
      if (strokeInitialImageRef.current) ctx.putImageData(strokeInitialImageRef.current, 0, 0);
      const pathData = getSvgPathFromStroke(getStroke(currentStrokeRef.current.points, { size: brushSize, thinning: activeTool==="highlighter"?0:0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: e.pointerType!=="pen" }));
      if (pathData) { ctx.save(); ctx.globalAlpha = activeTool==="highlighter"?0.4:1; ctx.fillStyle = activeColor; ctx.fill(new Path2D(pathData)); ctx.restore(); }
    } else if (["rectangle", "circle", "line"].includes(activeTool)) {
      currentStrokeRef.current.end = pos; if (strokeInitialImageRef.current) ctx.putImageData(strokeInitialImageRef.current, 0, 0);
      ctx.save(); ctx.strokeStyle = activeColor; ctx.lineWidth = brushSize; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const { start, end } = currentStrokeRef.current;
      if (activeTool === "rectangle") ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      else if (activeTool === "circle") { ctx.beginPath(); ctx.arc(start.x, start.y, Math.hypot(end.x - start.x, end.y - start.y), 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); }
      ctx.restore();
    }
    lastPoint.current = pos;
  };

  const handlePointerUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false; dragMode.current = null; strokeInitialImageRef.current = null;
    if (activeTool === "eraser") {
      if (erasedStrokesRef.current.length > 0) pushUndoAction({ type: "remove", strokes: erasedStrokesRef.current });
      syncToYjs(); // Send batch erased state over network
      return;
    }
    if (currentStrokeRef.current) {
      pushUndoAction({ type: "add", strokes: [currentStrokeRef.current] });
      const strokes = [...getCurrentStrokes(), currentStrokeRef.current];
      setCurrentStrokes(strokes); currentStrokeRef.current = null; syncToYjs(strokes);
    }
    lastPoint.current = null; startPoint.current = null;
  };

  const hexToRgb = (hex) => { const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null; };
  const handleClick = (e) => {
    if (activeTool !== "fill") return;
    const pos = getPointerPos(e); if (!pos) return;
    const canvas = canvasRef.current, ctx = getCtx(); if (!canvas || !ctx) return;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height), data = imgData.data, { width, height } = canvas;
    const pi = (Math.floor(pos.y) * width + Math.floor(pos.x)) * 4, tc = { r: data[pi], g: data[pi+1], b: data[pi+2], a: data[pi+3] }, nc = hexToRgb(activeColor);
    if (!nc || (tc.r === nc.r && tc.g === nc.g && tc.b === nc.b)) return;
    const q = [[Math.floor(pos.x), Math.floor(pos.y)]], visited = new Set();
    while (q.length > 0) {
      const [cx, cy] = q.shift(), key = `${cx},${cy}`;
      if (visited.has(key) || cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      visited.add(key); const idx = (cy * width + cx) * 4;
      if (Math.abs(data[idx]-tc.r)<15 && Math.abs(data[idx+1]-tc.g)<15 && Math.abs(data[idx+2]-tc.b)<15) {
        data[idx] = nc.r; data[idx+1] = nc.g; data[idx+2] = nc.b; data[idx+3] = 255;
        q.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
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
        const p = JSON.parse(r.result); if (!Array.isArray(p) || p.length===0) return toast.error("Invalid");
        setPages(p); if (p[0]?.id) { setCurrentPageId(p[0].id); currentPageIdRef.current = p[0].id; }
        if (p[0]?.canvasData) handleLoadPage(p[0].canvasData); else toast.success("Restored");
      } catch { toast.error("Error"); }
    }; r.readAsText(file);
  };
  const handleImportImage = (data) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = new Image(); img.onload = () => {
      let w = img.width, h = img.height; if (w>canvas.width || h>canvas.height) { const ratio = Math.min(canvas.width/w, canvas.height/h); w*=ratio; h*=ratio; }
      setImportedImage(img); setImagePos({ x: (canvas.width-w)/2, y: (canvas.height-h)/2 }); setImageDim({ width: w, height: h }); setActiveTool("move"); toast.success("Drag and place");
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
    undoStackRef.current = []; redoStackRef.current = []; bumpVersion();
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
      undoStackRef.current = []; redoStackRef.current = []; bumpVersion();
    }
    setPages(newPages); if (pagesMap) { try { pagesMap.delete(`${pageId}_strokes`); } catch { } }
    syncPagesList(newPages); toast.success("Deleted");
  };
  const handleSwitchPage = (pageId) => {
    if (pageId === currentPageIdRef.current) return;
    const canvas = canvasRef.current; if (canvas) setPages(prev => prev.map(p => p.id === currentPageIdRef.current ? { ...p, canvasData: canvas.toDataURL("image/webp", 0.7) } : p));
    setCurrentPageId(pageId); currentPageIdRef.current = pageId; undoStackRef.current = []; redoStackRef.current = []; bumpVersion();
    const ctx = getCtx(); if (ctx && canvas) renderStrokes(ctx, canvas, allStrokesRef.current[pageId] ?? [], backgroundColor, theme === "dark");
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") { e.preventDefault(); handleUndo(); } else if (e.key === "y") { e.preventDefault(); handleRedo(); } else if (e.key === "s") { e.preventDefault(); handleSave(); }
      } else {
        switch (e.key.toLowerCase()) { case "p": setActiveTool("pencil"); break; case "e": setActiveTool("eraser"); break; case "r": setActiveTool("rectangle"); break; case "c": setActiveTool("circle"); break; case "l": setActiveTool("line"); break; case "g": setActiveTool("fill"); break; }
      }
    }; window.addEventListener("keydown", handleKeyDown); return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, handleSave]);

  const canUndo = undoStackRef.current.length > 0; const canRedo = redoStackRef.current.length > 0;

  return (
    <div className={`h-screen w-screen overflow-hidden ${theme === 'dark' ? 'bg-[#121212]' : 'bg-[#ffffff]'} relative font-sans select-none transition-colors duration-300`}>
      <div className="absolute inset-0 z-0">
        <div ref={containerRef} className="w-full h-full">
          <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: activeTool === "fill" ? "cell" : activeTool === "move" ? "move" : "crosshair" }} onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp} onMouseLeave={handlePointerUp} onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp} onClick={handleClick} />
        </div>
      </div>

      {/* ── Top-Left: Universal Navigation & Hamburger Menu ────────────────── */}
      <div className="absolute top-3 left-3 z-40 pointer-events-auto flex items-center gap-2">
        <div className="relative">
          <button onClick={() => setShowMenu(v => !v)} className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/20 text-toolbar-foreground hover:bg-toolbar-hover transition-colors shadow-sm" title="Menu"><Menu className="w-4 h-4" /></button>
            {showMenu && (
              <div className="absolute top-11 left-0 w-56 bg-toolbar border border-toolbar-foreground/15 rounded-xl shadow-xl overflow-hidden z-50">
                <div className="p-2 space-y-1">
                  <button onClick={() => { handleSave(); setShowMenu(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-toolbar-foreground hover:bg-toolbar-hover transition-colors rounded-md"><Save className="w-4 h-4" /> Save to Gallery</button>
                  <button onClick={() => { handleDownload(); setShowMenu(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-toolbar-foreground hover:bg-toolbar-hover transition-colors rounded-md"><Download className="w-4 h-4" /> Download PDF</button>
                  <div className="w-full h-px bg-toolbar-foreground/10 my-1"/>
                  <button onClick={() => { backupFileRef.current?.click(); setShowMenu(false); }} className="flex items-center gap-3 w-full px-3 py-2 text-sm text-orange-400 hover:bg-toolbar-hover transition-colors rounded-md"><Menu className="w-4 h-4" /> Load Backup</button>
                </div>
              </div>
            )}
            <input ref={backupFileRef} type="file" accept=".json" onChange={handleLoadBackupFile} className="hidden" />
        </div>
        
        {/* Undo/Redo are adjacent to menu */}
        <button onClick={handleUndo} disabled={!canUndo} className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/15 text-toolbar-foreground hover:bg-toolbar-hover disabled:opacity-30 transition-colors shadow-sm"><Undo2 className="w-4 h-4" /></button>
        <button onClick={handleRedo} disabled={!canRedo} className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/15 text-toolbar-foreground hover:bg-toolbar-hover disabled:opacity-30 transition-colors shadow-sm"><Redo2 className="w-4 h-4" /></button>
      </div>

      {/* ── Top-Right: Dashboard ───────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-40 flex items-center gap-2 pointer-events-auto">
        <span title={status === "connected" ? "Connected" : "Disconnected"} className={`w-2.5 h-2.5 rounded-full ${status === "connected" ? "bg-green-500" : "bg-red-400"}`} />
        <button onClick={() => setShowDashboard(true)} className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/20 text-toolbar-foreground hover:bg-toolbar-hover transition-colors shadow-sm" title="Collaboration Dashboard"><Users className="w-4 h-4" /></button>
      </div>

      {/* ── Top-Center: Drawing Tools ──────────────────────────────────────── */}
      {!isMaximized && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
          <div className="bg-toolbar shadow-md border border-toolbar-foreground/15 rounded-xl px-1 py-0.5">
            <Toolbar activeTool={activeTool} onToolChange={setActiveTool} activeColor={activeColor} onColorChange={setActiveColor} backgroundColor={backgroundColor} onBackgroundColorChange={setBackgroundColor} brushSize={brushSize} onBrushSizeChange={setBrushSize} onClear={handleClear} onSave={undefined} onLoadPage={handleLoadPage} canUndo={false} canRedo={false} onDownload={undefined} onDownloadAllPages={handleDownloadAllPages} onLoadBackupFile={undefined} onImportImage={handleImportImage} onAddPage={handleAddPage} onSwitchPage={handleSwitchPage} pages={pages} currentPageId={currentPageId} isMaximized={isMaximized} onToggleMaximize={() => setIsMaximized(!isMaximized)} orientation={orientation} onToggleOrientation={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")} onPlaceImage={handlePlaceImage} hasImportedImage={!!importedImage} backupFileRef={backupFileRef} />
          </div>
        </div>
      )}

      {/* ── Bottom-Center: Page Tabs ───────────────────────────────────────── */}
      {!isMaximized && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 pointer-events-auto bg-toolbar border border-toolbar-foreground/15 rounded-xl p-1 shadow-md max-w-[70vw] overflow-x-auto">
          {pages.map((page) => (
            <div key={page.id} className="relative flex-shrink-0 flex items-center">
              <button onClick={() => handleSwitchPage(page.id)} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors whitespace-nowrap ${currentPageId === page.id ? "bg-toolbar-active text-accent-foreground pr-6" : "text-toolbar-foreground hover:bg-toolbar-hover"}`}>{page.name}</button>
              {isHost && pages.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); handleDeletePage(page.id); }} className={`absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full transition-colors ${currentPageId === page.id ? "text-accent-foreground/70 hover:text-accent-foreground hover:bg-white/10" : "text-toolbar-foreground/40 hover:text-red-400 hover:bg-red-500/10"}`} title={`Delete ${page.name}`}><X className="w-2.5 h-2.5" /></button>
              )}
            </div>
          ))}
          <button onClick={handleAddPage} className="w-7 h-7 flex items-center justify-center rounded-lg text-toolbar-foreground/60 hover:bg-toolbar-hover hover:text-toolbar-foreground transition-colors flex-shrink-0" title="Add Page"><Plus className="w-4 h-4" /></button>
        </div>
      )}

      {showMenu && <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />}
      <RoomDashboard show={showDashboard} onClose={() => setShowDashboard(false)} roomState={roomState} isHost={isHost} onAssignOwner={(id) => sendWsMessage({ type: "assign_owner", targetUserId: id })} />
    </div>
  );
};