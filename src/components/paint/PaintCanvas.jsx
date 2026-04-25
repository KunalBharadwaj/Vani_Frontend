// Main paint workspace component.
// Stroke-list model for undo/redo, bandwidth-efficient Yjs sync, and collaborative page management.
import { useEffect, useRef, useState, useCallback } from "react";
import { Toolbar } from "./Toolbar";
import { savePage } from "./SavedPagesGallery";
import { toast } from "sonner";
import { downloadCanvasAsPDF, downloadPagesAsPDF } from "@/services/storageService";
import { useCollaboration } from "@/hooks/useCollaboration";
import { useSearchParams } from "react-router-dom";
import { Users, Menu, Plus, X, Undo2, Redo2, Save, Download } from "lucide-react";
import { RoomDashboard } from "@/components/shared/RoomDashboard";
import { getStroke } from "perfect-freehand";

// ─── SVG path helper ──────────────────────────────────────────────────────────
function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", stroke[0][0], stroke[0][1], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

// ─── Render all strokes onto ctx ─────────────────────────────────────────────
function renderStrokes(ctx, canvas, strokes, bgColor) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    if (s.type === "freehand") {
      const drawn = getStroke(s.points, {
        size: s.size, thinning: s.tool === "highlighter" ? 0 : 0.6,
        smoothing: 0.5, streamline: 0.5, simulatePressure: true,
      });
      const pathData = getSvgPathFromStroke(drawn);
      if (!pathData) continue;
      ctx.save();
      ctx.globalAlpha = s.opacity ?? 1;
      ctx.fillStyle = s.color;
      ctx.fill(new Path2D(pathData));
      ctx.restore();
    } else if (s.type === "shape") {
      ctx.save();
      ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const { start, end } = s;
      if (s.tool === "rectangle") {
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      } else if (s.tool === "circle") {
        const r = Math.hypot(end.x - start.x, end.y - start.y);
        ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      }
      ctx.restore();
    } else if (s.type === "snapshot") {
      const img = new Image();
      img.src = s.data;
      if (img.complete) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
  }
}

// ─── Hit-test stroke for eraser ──────────────────────────────────────────────
function strokeHitTest(stroke, px, py, eraserRadius) {
  if (stroke.type === "freehand") {
    const threshold = eraserRadius + stroke.size / 2;
    return stroke.points.some(([x, y]) => Math.hypot(x - px, y - py) < threshold);
  }
  if (stroke.type === "shape") {
    const { start, end } = stroke;
    const minX = Math.min(start.x, end.x) - eraserRadius;
    const maxX = Math.max(start.x, end.x) + eraserRadius;
    const minY = Math.min(start.y, end.y) - eraserRadius;
    const maxY = Math.max(start.y, end.y) + eraserRadius;
    return px >= minX && px <= maxX && py >= minY && py <= maxY;
  }
  return false;
}

function compactStrokes(strokes) {
  return strokes.map((s) => {
    if (s.type === "freehand") {
      return { ...s, points: s.points.map(([x, y, p]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2, Math.round(p * 100) / 100]) };
    }
    return s;
  });
}

let _sid = 0;
const newId = () => `s${Date.now()}_${_sid++}`;

// ─────────────────────────────────────────────────────────────────────────────
export const PaintCanvas = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [activeTool, setActiveTool] = useState("pencil");
  const [activeColor, setActiveColor] = useState("#000000");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(5);
  const [isMaximized, setIsMaximized] = useState(false);
  const [orientation, setOrientation] = useState("portrait");
  const [showDashboard, setShowDashboard] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const token = localStorage.getItem("auth_token");
  const roomId = searchParams.get("room");
  const { pagesMap, status, roomState, sendWsMessage } = useCollaboration(roomId, token);

  const userId = token
    ? (() => { try { return JSON.parse(atob(token.split(".")[1]))?.id; } catch { return null; } })()
    : null;
  const isHost = roomState?.hostId === userId;

  useEffect(() => {
    if (!roomId) {
      const newRoom = Math.random().toString(36).substring(2, 8);
      searchParams.set("room", newRoom);
      setSearchParams(searchParams, { replace: true });
    }
  }, [roomId, searchParams, setSearchParams]);

  // ─── Pages state ──────────────────────────────────────────────────────────
  const [pages, setPages] = useState([{ id: "page-1", name: "Page 1" }]);
  const [currentPageId, setCurrentPageId] = useState("page-1");
  const currentPageIdRef = useRef("page-1");

  // ─── Stroke-list model ────────────────────────────────────────────────────
  const allStrokesRef = useRef({ "page-1": [] });
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [stackVersion, setStackVersion] = useState(0);
  const bumpVersion = () => setStackVersion((v) => v + 1);

  const getCurrentStrokes = useCallback(() => allStrokesRef.current[currentPageIdRef.current] ?? [], []);
  const setCurrentStrokes = useCallback((strokes) => { allStrokesRef.current[currentPageIdRef.current] = strokes; }, []);

  const getCtx = useCallback(() => canvasRef.current?.getContext("2d"), []);
  const redraw = useCallback((strokes, bgColor) => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    renderStrokes(ctx, canvas, strokes ?? getCurrentStrokes(), bgColor ?? backgroundColor);
  }, [getCtx, getCurrentStrokes, backgroundColor]);

  // ─── Yjs sync ─────────────────────────────────────────────────────────────
  const yjsSyncTimerRef = useRef(null);
  const isSyncingRef = useRef(false);
  const isInitialized = useRef(false);

  // Sync stroke data for current page
  const syncToYjs = useCallback((strokes) => {
    if (!pagesMap || !isInitialized.current) return;
    clearTimeout(yjsSyncTimerRef.current);
    yjsSyncTimerRef.current = setTimeout(() => {
      try {
        const payload = JSON.stringify(compactStrokes(strokes ?? getCurrentStrokes()));
        isSyncingRef.current = true;
        pagesMap.set(`${currentPageIdRef.current}_strokes`, payload);
        isSyncingRef.current = false;
      } catch (e) { console.error("Yjs sync error", e); }
    }, 250);
  }, [pagesMap, getCurrentStrokes]);

  // Sync pages list so all participants see added/deleted pages
  const syncPagesList = useCallback((pagesList) => {
    if (!pagesMap || !isInitialized.current) return;
    try {
      isSyncingRef.current = true;
      pagesMap.set("pagesList", JSON.stringify(pagesList.map((p) => ({ id: p.id, name: p.name }))));
      isSyncingRef.current = false;
    } catch (e) { console.error("Pages sync error", e); }
  }, [pagesMap]);

  // ─── History ──────────────────────────────────────────────────────────────
  const pushUndo = useCallback(() => {
    const snap = JSON.parse(JSON.stringify(getCurrentStrokes()));
    undoStackRef.current.push({ pageId: currentPageIdRef.current, strokes: snap });
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
    bumpVersion();
  }, [getCurrentStrokes]);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const { pageId, strokes } = undoStackRef.current.pop();
    redoStackRef.current.push({ pageId, strokes: JSON.parse(JSON.stringify(getCurrentStrokes())) });
    allStrokesRef.current[pageId] = strokes;
    const canvas = canvasRef.current; const ctx = getCtx();
    if (canvas && ctx) renderStrokes(ctx, canvas, strokes, backgroundColor);
    bumpVersion(); syncToYjs(strokes);
  }, [getCurrentStrokes, getCtx, backgroundColor, syncToYjs]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const { pageId, strokes } = redoStackRef.current.pop();
    undoStackRef.current.push({ pageId, strokes: JSON.parse(JSON.stringify(getCurrentStrokes())) });
    allStrokesRef.current[pageId] = strokes;
    const canvas = canvasRef.current; const ctx = getCtx();
    if (canvas && ctx) renderStrokes(ctx, canvas, strokes, backgroundColor);
    bumpVersion(); syncToYjs(strokes);
  }, [getCurrentStrokes, getCtx, backgroundColor, syncToYjs]);

  // ─── Canvas init ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    isInitialized.current = true;

    const handleResize = () => {
      const saved = canvas.toDataURL("image/webp", 0.85);
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      const img = new Image();
      img.onload = () => { ctx.fillStyle = backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
      img.src = saved;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Yjs observer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pagesMap) return;

    // Late-joiner: load pages list
    const existingPagesList = pagesMap.get("pagesList");
    if (existingPagesList) {
      try {
        const remotePagesRaw = JSON.parse(existingPagesList);
        // Ensure allStrokesRef has entries for all remote pages
        remotePagesRaw.forEach((p) => { if (!allStrokesRef.current[p.id]) allStrokesRef.current[p.id] = []; });
        setPages(remotePagesRaw);
      } catch { /* ignore */ }
    }

    // Late-joiner: load current page strokes
    const existingPayload = pagesMap.get(`${currentPageIdRef.current}_strokes`);
    if (existingPayload) {
      try {
        const remoteStrokes = JSON.parse(existingPayload);
        allStrokesRef.current[currentPageIdRef.current] = remoteStrokes;
        redraw(remoteStrokes, backgroundColor);
      } catch { /* ignore */ }
    }

    const observer = (event) => {
      // Handle pages list changes (page add/delete by anyone)
      if (event.keysChanged?.has("pagesList")) {
        const rawList = pagesMap.get("pagesList");
        if (rawList) {
          try {
            const remotePagesRaw = JSON.parse(rawList);
            remotePagesRaw.forEach((p) => { if (!allStrokesRef.current[p.id]) allStrokesRef.current[p.id] = []; });
            setPages((prev) => {
              // Merge: keep remote list but if current page was deleted, we'll handle below
              return remotePagesRaw;
            });
            // If current page was removed by host, switch to first available
            setPages((prev) => {
              const ids = prev.map((p) => p.id);
              if (!ids.includes(currentPageIdRef.current)) {
                const firstId = ids[0];
                if (firstId) {
                  currentPageIdRef.current = firstId;
                  setCurrentPageId(firstId);
                  const strokes = allStrokesRef.current[firstId] ?? [];
                  redraw(strokes, backgroundColor);
                }
              }
              return prev;
            });
          } catch { /* ignore */ }
        }
      }

      // Handle strokes for current page
      const strokeKey = `${currentPageIdRef.current}_strokes`;
      if (event.keysChanged?.has(strokeKey) && !isSyncingRef.current) {
        const payload = pagesMap.get(strokeKey);
        if (!payload) return;
        try {
          const remoteStrokes = JSON.parse(payload);
          allStrokesRef.current[currentPageIdRef.current] = remoteStrokes;
          redraw(remoteStrokes, backgroundColor);
        } catch { /* ignore */ }
      }
    };

    pagesMap.observe(observer);
    return () => pagesMap.unobserve(observer);
  }, [pagesMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Background color change ──────────────────────────────────────────────
  const prevBgColorRef = useRef(backgroundColor);
  useEffect(() => {
    if (!isInitialized.current) return;
    if (prevBgColorRef.current === backgroundColor) return;
    prevBgColorRef.current = backgroundColor;
    redraw(undefined, backgroundColor);
    syncToYjs();
  }, [backgroundColor, redraw, syncToYjs]);

  // ─── Drawing state ────────────────────────────────────────────────────────
  const isDrawing = useRef(false);
  const currentStrokeRef = useRef(null);
  const startPoint = useRef(null);
  const lastPoint = useRef(null);
  const strokeInitialImageRef = useRef(null);
  const [importedImage, setImportedImage] = useState(null);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const dragMode = useRef(null);
  const backupFileRef = useRef(null);

  const getPointerPosition = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX == null) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // ─── Imported image overlay ───────────────────────────────────────────────
  useEffect(() => {
    if (!importedImage) return;
    const canvas = canvasRef.current; const ctx = getCtx();
    if (!canvas || !ctx) return;
    redraw(undefined, backgroundColor);
    ctx.drawImage(importedImage, imagePosition.x, imagePosition.y, imageDimensions.width, imageDimensions.height);
    ctx.strokeStyle = "#6366f1"; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.strokeRect(imagePosition.x, imagePosition.y, imageDimensions.width, imageDimensions.height);
    ctx.setLineDash([]);
    const hs = 8;
    ctx.fillStyle = "#6366f1";
    [[imagePosition.x, imagePosition.y], [imagePosition.x + imageDimensions.width, imagePosition.y],
     [imagePosition.x, imagePosition.y + imageDimensions.height], [imagePosition.x + imageDimensions.width, imagePosition.y + imageDimensions.height]]
      .forEach(([cx, cy]) => { ctx.beginPath(); ctx.arc(cx, cy, hs / 2, 0, Math.PI * 2); ctx.fill(); });
  }, [importedImage, imagePosition, imageDimensions, backgroundColor, redraw, getCtx]);

  // ─── Pointer Down ──────────────────────────────────────────────────────────
  const handlePointerDown = (e) => {
    const pos = getPointerPosition(e);
    if (!pos) return;
    const canvas = canvasRef.current; const ctx = getCtx();
    if (!canvas || !ctx) return;

    if (importedImage && activeTool === "move") {
      const hs = 10, x1 = imagePosition.x, y1 = imagePosition.y;
      const x2 = x1 + imageDimensions.width, y2 = y1 + imageDimensions.height;
      if (pos.x >= x1-hs && pos.x <= x1+hs && pos.y >= y1-hs && pos.y <= y1+hs) dragMode.current = "resize-nw";
      else if (pos.x >= x2-hs && pos.x <= x2+hs && pos.y >= y1-hs && pos.y <= y1+hs) dragMode.current = "resize-ne";
      else if (pos.x >= x1-hs && pos.x <= x1+hs && pos.y >= y2-hs && pos.y <= y2+hs) dragMode.current = "resize-sw";
      else if (pos.x >= x2-hs && pos.x <= x2+hs && pos.y >= y2-hs && pos.y <= y2+hs) dragMode.current = "resize-se";
      else if (pos.x > x1 && pos.x < x2 && pos.y > y1 && pos.y < y2) dragMode.current = "move";
    }

    isDrawing.current = true; lastPoint.current = pos; startPoint.current = pos;

    if (activeTool === "eraser") {
      pushUndo();
      const eraserRadius = brushSize * 2;
      const remaining = getCurrentStrokes().filter((s) => !strokeHitTest(s, pos.x, pos.y, eraserRadius));
      if (remaining.length !== getCurrentStrokes().length) {
        setCurrentStrokes(remaining);
        renderStrokes(ctx, canvas, remaining, backgroundColor);
        syncToYjs(remaining);
      }
      return;
    }
    if (activeTool === "pencil" || activeTool === "highlighter") {
      strokeInitialImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      currentStrokeRef.current = { id: newId(), type: "freehand", tool: activeTool, color: activeColor, size: brushSize, opacity: activeTool === "highlighter" ? 0.4 : 1, points: [[pos.x, pos.y, e.pressure || 0.5]] };
    } else if (["rectangle", "circle", "line"].includes(activeTool)) {
      strokeInitialImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      currentStrokeRef.current = { id: newId(), type: "shape", tool: activeTool, color: activeColor, size: brushSize, start: pos, end: pos };
    }
  };

  // ─── Pointer Move ──────────────────────────────────────────────────────────
  const handlePointerMove = (e) => {
    if (!isDrawing.current) return;
    const pos = getPointerPosition(e); if (!pos) return;
    const canvas = canvasRef.current; const ctx = getCtx();
    if (!canvas || !ctx) return;

    if (activeTool === "eraser") {
      const eraserRadius = brushSize * 2;
      const remaining = getCurrentStrokes().filter((s) => !strokeHitTest(s, pos.x, pos.y, eraserRadius));
      if (remaining.length !== getCurrentStrokes().length) { setCurrentStrokes(remaining); renderStrokes(ctx, canvas, remaining, backgroundColor); }
      lastPoint.current = pos; return;
    }
    if (activeTool === "move" && importedImage) {
      const dx = pos.x - lastPoint.current.x, dy = pos.y - lastPoint.current.y, dm = dragMode.current;
      if (dm === "move") setImagePosition((p) => ({ x: p.x + dx, y: p.y + dy }));
      else if (dm === "resize-se") setImageDimensions((d) => ({ width: Math.max(50, d.width + dx), height: Math.max(50, d.height + dy) }));
      else if (dm === "resize-sw") { setImagePosition((p) => ({ ...p, x: p.x + dx })); setImageDimensions((d) => ({ width: Math.max(50, d.width - dx), height: Math.max(50, d.height + dy) })); }
      else if (dm === "resize-ne") { setImagePosition((p) => ({ ...p, y: p.y + dy })); setImageDimensions((d) => ({ width: Math.max(50, d.width + dx), height: Math.max(50, d.height - dy) })); }
      else if (dm === "resize-nw") { setImagePosition((p) => ({ x: p.x + dx, y: p.y + dy })); setImageDimensions((d) => ({ width: Math.max(50, d.width - dx), height: Math.max(50, d.height - dy) })); }
      lastPoint.current = pos; return;
    }
    if (!currentStrokeRef.current) return;
    if (activeTool === "pencil" || activeTool === "highlighter") {
      currentStrokeRef.current.points.push([pos.x, pos.y, e.pressure || 0.5]);
      if (strokeInitialImageRef.current) ctx.putImageData(strokeInitialImageRef.current, 0, 0);
      const drawn = getStroke(currentStrokeRef.current.points, { size: brushSize, thinning: activeTool === "highlighter" ? 0 : 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: e.pointerType !== "pen" });
      const pathData = getSvgPathFromStroke(drawn);
      if (pathData) { ctx.save(); ctx.globalAlpha = activeTool === "highlighter" ? 0.4 : 1; ctx.fillStyle = activeColor; ctx.fill(new Path2D(pathData)); ctx.restore(); }
    } else if (["rectangle", "circle", "line"].includes(activeTool)) {
      currentStrokeRef.current.end = pos;
      if (strokeInitialImageRef.current) ctx.putImageData(strokeInitialImageRef.current, 0, 0);
      ctx.save(); ctx.strokeStyle = activeColor; ctx.lineWidth = brushSize; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const { start, end } = currentStrokeRef.current;
      if (activeTool === "rectangle") { ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y); }
      else if (activeTool === "circle") { const r = Math.hypot(end.x - start.x, end.y - start.y); ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); }
      ctx.restore();
    }
    lastPoint.current = pos;
  };

  // ─── Pointer Up ───────────────────────────────────────────────────────────
  const handlePointerUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false; dragMode.current = null; strokeInitialImageRef.current = null;
    if (activeTool === "eraser") { syncToYjs(); return; }
    if (currentStrokeRef.current) {
      pushUndo();
      const strokes = [...getCurrentStrokes(), currentStrokeRef.current];
      setCurrentStrokes(strokes); currentStrokeRef.current = null; syncToYjs(strokes);
    }
    lastPoint.current = null; startPoint.current = null;
  };

  // ─── Flood fill ───────────────────────────────────────────────────────────
  const hexToRgb = (hex) => { const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null; };

  const handleClick = (e) => {
    if (activeTool !== "fill") return;
    const pos = getPointerPosition(e); if (!pos) return;
    const canvas = canvasRef.current; const ctx = getCtx();
    if (!canvas || !ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data; const { width, height } = canvas;
    const pi = (Math.floor(pos.y) * width + Math.floor(pos.x)) * 4;
    const tc = { r: data[pi], g: data[pi+1], b: data[pi+2], a: data[pi+3] };
    const nc = hexToRgb(activeColor); if (!nc) return;
    if (tc.r === nc.r && tc.g === nc.g && tc.b === nc.b) return;
    const queue = [[Math.floor(pos.x), Math.floor(pos.y)]]; const visited = new Set();
    while (queue.length > 0) {
      const [cx, cy] = queue.shift(); const key = `${cx},${cy}`;
      if (visited.has(key) || cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      visited.add(key);
      const idx = (cy * width + cx) * 4;
      if (Math.abs(data[idx]-tc.r) < 15 && Math.abs(data[idx+1]-tc.g) < 15 && Math.abs(data[idx+2]-tc.b) < 15) {
        data[idx] = nc.r; data[idx+1] = nc.g; data[idx+2] = nc.b; data[idx+3] = 255;
        queue.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const snapStroke = { id: newId(), type: "snapshot", data: canvas.toDataURL("image/webp", 0.7) };
    pushUndo(); const strokes = [...getCurrentStrokes(), snapStroke]; setCurrentStrokes(strokes); syncToYjs(strokes);
    toast("Area filled!");
  };

  const handleClear = () => { pushUndo(); setCurrentStrokes([]); redraw([], backgroundColor); syncToYjs([]); toast("Canvas cleared!"); };

  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current; if (!canvas) return;
    try {
      const page = { id: Date.now().toString(), name: `Drawing ${new Date().toLocaleTimeString()}`, thumbnail: canvas.toDataURL("image/webp", 0.4), canvasData: canvas.toDataURL("image/webp", 0.85), createdAt: Date.now() };
      savePage(page) ? toast.success("Drawing saved to gallery") : toast.error("Failed to save");
    } catch { toast.error("Failed to save drawing"); }
  }, []);

  const handleDownload = useCallback(async () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const result = await downloadCanvasAsPDF(canvas);
    result.success ? toast.success(`Downloaded: ${result.fileName}`) : toast.error(result.error || "Download failed");
  }, []);

  const handleDownloadAllPages = useCallback(async () => {
    const pagesWithContent = pages.filter((p) => !!allStrokesRef.current[p.id]?.length);
    if (pagesWithContent.length === 0) return toast.error("No pages with content");
    // Convert pages to canvas snapshots for PDF
    const withData = pagesWithContent.map((p) => ({ ...p, canvasData: null }));
    const result = await downloadPagesAsPDF(withData, "chanakya-drawings");
    result.success ? toast.success(`Downloaded: ${result.fileName}`) : toast.error(result.error || "Download failed");
  }, [pages]);

  const handleLoadPage = (canvasData) => {
    const canvas = canvasRef.current; const ctx = getCtx(); if (!canvas || !ctx) return;
    pushUndo();
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0);
      const snapStroke = { id: newId(), type: "snapshot", data: canvas.toDataURL("image/webp", 0.7) };
      setCurrentStrokes([snapStroke]); syncToYjs([snapStroke]); toast.success("Drawing loaded!");
    };
    img.src = canvasData;
  };

  const handleLoadBackupFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed) || parsed.length === 0) { toast.error("Invalid backup"); return; }
        setPages(parsed); const first = parsed[0];
        if (first?.id) { setCurrentPageId(first.id); currentPageIdRef.current = first.id; }
        if (first?.canvasData) handleLoadPage(first.canvasData);
        else toast.success("Backup restored");
      } catch { toast.error("Failed to parse backup"); }
    };
    reader.readAsText(file);
  };

  const handleImportImage = (imageData) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > canvas.width || h > canvas.height) { const ratio = Math.min(canvas.width / w, canvas.height / h); w *= ratio; h *= ratio; }
      setImportedImage(img); setImagePosition({ x: (canvas.width - w) / 2, y: (canvas.height - h) / 2 });
      setImageDimensions({ width: w, height: h }); setActiveTool("move");
      toast.success("Image imported! Drag to position, then click Place.");
    };
    img.src = imageData;
  };

  const handlePlaceImage = () => {
    if (!importedImage) return;
    const canvas = canvasRef.current; const ctx = getCtx(); if (!canvas || !ctx) return;
    redraw(getCurrentStrokes(), backgroundColor);
    ctx.drawImage(importedImage, imagePosition.x, imagePosition.y, imageDimensions.width, imageDimensions.height);
    const snapStroke = { id: newId(), type: "snapshot", data: canvas.toDataURL("image/webp", 0.8) };
    pushUndo(); const strokes = [...getCurrentStrokes(), snapStroke]; setCurrentStrokes(strokes); syncToYjs(strokes);
    setImportedImage(null); setActiveTool("pencil"); toast.success("Image placed!");
  };

  // ─── Page management ──────────────────────────────────────────────────────
  const handleAddPage = () => {
    const newPageId = `page-${Date.now()}`;
    const newPages = [...pages, { id: newPageId, name: `Page ${pages.length + 1}` }];
    allStrokesRef.current[newPageId] = [];
    setPages(newPages);
    setCurrentPageId(newPageId);
    currentPageIdRef.current = newPageId;
    undoStackRef.current = []; redoStackRef.current = []; bumpVersion();
    const ctx = getCtx(); const canvas = canvasRef.current;
    if (ctx && canvas) { ctx.fillStyle = backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    // Sync new pages list to Yjs so all participants see it
    syncPagesList(newPages);
    toast.success("New page added!");
  };

  // Host-only page deletion with consistent renaming
  const handleDeletePage = (pageId) => {
    if (!isHost) return toast.error("Only the host can delete pages");
    if (pages.length <= 1) return toast.error("Cannot delete the last page");
    const newPages = pages.filter((p) => p.id !== pageId).map((p, i) => ({ ...p, name: `Page ${i + 1}` }));
    delete allStrokesRef.current[pageId];
    // If deleting current page, switch to first remaining page
    let nextPageId = currentPageIdRef.current;
    if (pageId === currentPageIdRef.current) {
      nextPageId = newPages[0].id;
      setCurrentPageId(nextPageId);
      currentPageIdRef.current = nextPageId;
      const ctx = getCtx(); const canvas = canvasRef.current;
      if (ctx && canvas) renderStrokes(ctx, canvas, allStrokesRef.current[nextPageId] ?? [], backgroundColor);
      undoStackRef.current = []; redoStackRef.current = []; bumpVersion();
    }
    setPages(newPages);
    // Delete page strokes from Yjs too
    if (pagesMap) { try { pagesMap.delete(`${pageId}_strokes`); } catch { /* ignore */ } }
    syncPagesList(newPages);
    toast.success("Page deleted");
  };

  const handleSwitchPage = (pageId) => {
    if (pageId === currentPageIdRef.current) return;
    // Persist current canvas snapshot
    const canvas = canvasRef.current;
    if (canvas) { const canvasData = canvas.toDataURL("image/webp", 0.7); setPages((prev) => prev.map((p) => p.id === currentPageIdRef.current ? { ...p, canvasData } : p)); }
    setCurrentPageId(pageId); currentPageIdRef.current = pageId;
    undoStackRef.current = []; redoStackRef.current = []; bumpVersion();
    const ctx = getCtx();
    if (ctx && canvas) renderStrokes(ctx, canvas, allStrokesRef.current[pageId] ?? [], backgroundColor);
  };

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") { e.preventDefault(); handleUndo(); }
        else if (e.key === "y") { e.preventDefault(); handleRedo(); }
        else if (e.key === "s") { e.preventDefault(); handleSave(); }
      } else {
        switch (e.key.toLowerCase()) {
          case "p": setActiveTool("pencil"); break;
          case "e": setActiveTool("eraser"); break;
          case "r": setActiveTool("rectangle"); break;
          case "c": setActiveTool("circle"); break;
          case "l": setActiveTool("line"); break;
          case "g": setActiveTool("fill"); break;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, handleSave]);

  const getCursor = () => {
    switch (activeTool) {
      case "pencil": case "eraser": case "rectangle": case "circle": case "line": return "crosshair";
      case "fill": return "cell";
      default: return "default";
    }
  };

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen overflow-hidden bg-workspace relative font-sans select-none">

      {/* ── Full-screen Canvas ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <div ref={containerRef} className="w-full h-full">
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ cursor: getCursor() }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            onClick={handleClick}
          />
        </div>
      </div>

      {/* ── Top-Left: Hamburger Menu ───────────────────────────────────────── */}
      <div className="absolute top-3 left-3 z-40 pointer-events-auto">
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/20 text-toolbar-foreground hover:bg-toolbar-hover transition-colors shadow-sm"
            title="Menu"
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <div className="absolute top-11 left-0 w-44 bg-toolbar border border-toolbar-foreground/15 rounded-xl shadow-xl overflow-hidden z-50">
              <button onClick={() => { handleSave(); setShowMenu(false); }} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-toolbar-foreground hover:bg-toolbar-hover transition-colors">
                <Save className="w-4 h-4 text-primary" /> Save to Gallery
              </button>
              <button onClick={() => { handleDownload(); setShowMenu(false); }} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-toolbar-foreground hover:bg-toolbar-hover transition-colors">
                <Download className="w-4 h-4 text-blue-500" /> Download PDF
              </button>
              <div className="h-px bg-toolbar-foreground/10 mx-2" />
              <button onClick={() => { backupFileRef.current?.click(); setShowMenu(false); }} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-toolbar-foreground hover:bg-toolbar-hover transition-colors">
                <Menu className="w-4 h-4 text-orange-400" /> Load Backup
              </button>
              <input ref={backupFileRef} type="file" accept=".json" onChange={handleLoadBackupFile} className="hidden" />
            </div>
          )}
        </div>
      </div>

      {/* ── Top-Right: Status + Dashboard ─────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-40 flex items-center gap-2 pointer-events-auto">
        {/* Connection dot */}
        <span
          title={status === "connected" ? "Connected" : "Disconnected"}
          className={`w-2.5 h-2.5 rounded-full ${status === "connected" ? "bg-green-500" : "bg-red-400"}`}
        />
        <button
          onClick={() => setShowDashboard(true)}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/20 text-toolbar-foreground hover:bg-toolbar-hover transition-colors shadow-sm"
          title="Collaboration Dashboard"
        >
          <Users className="h-4 w-4" />
        </button>
      </div>

      {/* ── Top-Center: Drawing Toolbar ────────────────────────────────────── */}
      {!isMaximized && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
          <div className="bg-toolbar shadow-md border border-toolbar-foreground/15 rounded-xl px-1 py-0.5">
            <Toolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              activeColor={activeColor}
              onColorChange={setActiveColor}
              backgroundColor={backgroundColor}
              onBackgroundColorChange={setBackgroundColor}
              brushSize={brushSize}
              onBrushSizeChange={setBrushSize}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onClear={handleClear}
              onSave={handleSave}
              onLoadPage={handleLoadPage}
              canUndo={canUndo}
              canRedo={canRedo}
              onDownload={handleDownload}
              onDownloadAllPages={handleDownloadAllPages}
              onLoadBackupFile={handleLoadBackupFile}
              onImportImage={handleImportImage}
              onAddPage={handleAddPage}
              onSwitchPage={handleSwitchPage}
              pages={pages}
              currentPageId={currentPageId}
              isMaximized={isMaximized}
              onToggleMaximize={() => setIsMaximized(!isMaximized)}
              orientation={orientation}
              onToggleOrientation={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")}
              onPlaceImage={handlePlaceImage}
              hasImportedImage={!!importedImage}
              backupFileRef={backupFileRef}
            />
          </div>
        </div>
      )}

      {/* ── Bottom-Left: Undo / Redo ───────────────────────────────────────── */}
      <div className="absolute bottom-3 left-3 z-40 flex items-center gap-1 pointer-events-auto">
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/15 text-toolbar-foreground hover:bg-toolbar-hover disabled:opacity-30 transition-colors shadow-sm"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-toolbar border border-toolbar-foreground/15 text-toolbar-foreground hover:bg-toolbar-hover disabled:opacity-30 transition-colors shadow-sm"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>

      {/* ── Bottom-Center: Page Tabs ───────────────────────────────────────── */}
      {!isMaximized && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 pointer-events-auto bg-toolbar border border-toolbar-foreground/15 rounded-xl p-1 shadow-md max-w-[70vw] overflow-x-auto">
          {pages.map((page) => (
            <div key={page.id} className="relative flex-shrink-0 flex items-center">
              <button
                onClick={() => handleSwitchPage(page.id)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors whitespace-nowrap ${
                  currentPageId === page.id
                    ? "bg-toolbar-active text-accent-foreground pr-6"
                    : "text-toolbar-foreground hover:bg-toolbar-hover"
                }`}
              >
                {page.name}
              </button>
              {/* Host-only delete button — only on active page and when pages > 1 */}
              {isHost && pages.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeletePage(page.id); }}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full transition-colors ${
                    currentPageId === page.id
                      ? "text-accent-foreground/70 hover:text-accent-foreground hover:bg-white/10"
                      : "text-toolbar-foreground/40 hover:text-red-400 hover:bg-red-500/10"
                  }`}
                  title={`Delete ${page.name}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}
          {/* Add page button */}
          <button
            onClick={handleAddPage}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-toolbar-foreground/60 hover:bg-toolbar-hover hover:text-toolbar-foreground transition-colors flex-shrink-0"
            title="Add Page"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Overlay click to close menu */}
      {showMenu && <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />}

      <RoomDashboard
        show={showDashboard}
        onClose={() => setShowDashboard(false)}
        roomState={roomState}
        isHost={isHost}
        onAssignOwner={(id) => sendWsMessage({ type: "assign_owner", targetUserId: id })}
      />
    </div>
  );
};