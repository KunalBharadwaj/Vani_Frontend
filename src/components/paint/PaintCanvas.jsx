// Main paint workspace component.
// Stroke-list model: each mark is stored as a lightweight object.
// This powers correct undo/redo, stroke-level erasing, and ~100x smaller
// Yjs payloads (JSON strokes) vs the old ImageData snapshots.
import { useEffect, useRef, useState, useCallback } from "react";
import { Toolbar } from "./Toolbar";
import { savePage } from "./SavedPagesGallery";
import { toast } from "sonner";
import { downloadCanvasAsPDF, downloadPagesAsPDF } from "@/services/storageService";
import { useCollaboration } from "@/hooks/useCollaboration";
import { useSearchParams } from "react-router-dom";
import { Users, Menu } from "lucide-react";
import { RoomDashboard } from "@/components/shared/RoomDashboard";
import { getStroke } from "perfect-freehand";

// ─── SVG path helper for perfect-freehand ────────────────────────────────────
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

// ─── Render all strokes onto a canvas ctx ────────────────────────────────────
function renderStrokes(ctx, canvas, strokes, bgColor) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const s of strokes) {
    if (s.type === "freehand") {
      const drawn = getStroke(s.points, {
        size: s.size,
        thinning: s.tool === "highlighter" ? 0 : 0.6,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: true,
      });
      const pathData = getSvgPathFromStroke(drawn);
      if (!pathData) continue;
      const path = new Path2D(pathData);
      ctx.save();
      ctx.globalAlpha = s.opacity ?? 1;
      ctx.fillStyle = s.color;
      ctx.fill(path);
      ctx.restore();
    } else if (s.type === "shape") {
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const { start, end } = s;
      if (s.tool === "rectangle") {
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      } else if (s.tool === "circle") {
        const r = Math.hypot(end.x - start.x, end.y - start.y);
        ctx.beginPath();
        ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.tool === "line") {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.restore();
    } else if (s.type === "snapshot") {
      // flood-fill or imported image — stored as compact webp data url
      const img = new Image();
      img.src = s.data;
      if (img.complete) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    }
  }
}

// ─── Hit-test: is pointer within brushSize px of any point in the stroke? ───
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

// ─── Compact a stroke array for Yjs (round coords) ──────────────────────────
function compactStrokes(strokes) {
  return strokes.map((s) => {
    if (s.type === "freehand") {
      return {
        ...s,
        points: s.points.map(([x, y, p]) => [
          Math.round(x * 2) / 2,
          Math.round(y * 2) / 2,
          Math.round(p * 100) / 100,
        ]),
      };
    }
    return s;
  });
}

let _strokeIdCounter = 0;
const newId = () => `s${Date.now()}_${_strokeIdCounter++}`;

// ──────────────────────────────────────────────────────────────────────────────
export const PaintCanvas = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // UI / tool state
  const [activeTool, setActiveTool] = useState("pencil");
  const [activeColor, setActiveColor] = useState("#000000");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(5);
  const [isMaximized, setIsMaximized] = useState(false);
  const [orientation, setOrientation] = useState("portrait");

  const [searchParams, setSearchParams] = useSearchParams();
  const token = localStorage.getItem("auth_token");
  const roomId = searchParams.get("room");
  const [showDashboard, setShowDashboard] = useState(false);
  const { pagesMap, status, roomState, sendWsMessage } = useCollaboration(roomId, token);

  const userId = token
    ? (() => { try { return JSON.parse(atob(token.split(".")[1]))?.id; } catch { return null; } })()
    : null;
  const isHost = roomState?.hostId === userId;

  // Generate a room if none exists
  useEffect(() => {
    if (!roomId) {
      const newRoom = Math.random().toString(36).substring(2, 8);
      searchParams.set("room", newRoom);
      setSearchParams(searchParams, { replace: true });
    }
  }, [roomId, searchParams, setSearchParams]);

  // ─── Pages ────────────────────────────────────────────────────────────────
  const [pages, setPages] = useState([{ id: "page-1", name: "Page 1", canvasData: null }]);
  const [currentPageId, setCurrentPageId] = useState("page-1");

  // ─── Stroke-list model ────────────────────────────────────────────────────
  // Per-page stroke arrays  { [pageId]: stroke[] }
  const allStrokesRef = useRef({ "page-1": [] });
  const undoStackRef = useRef([]);   // stack of { pageId, strokes[] } snapshots
  const redoStackRef = useRef([]);
  const [stackVersion, setStackVersion] = useState(0); // triggers re-render for canUndo/canRedo

  const bumpVersion = () => setStackVersion((v) => v + 1);

  const getCurrentStrokes = useCallback(() => {
    return allStrokesRef.current[currentPageId] ?? [];
  }, [currentPageId]);

  const setCurrentStrokes = useCallback((strokes) => {
    allStrokesRef.current[currentPageId] = strokes;
  }, [currentPageId]);

  // ─── Rendering helpers ────────────────────────────────────────────────────
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

  const syncToYjs = useCallback((strokes) => {
    if (!pagesMap || !isInitialized.current || isSyncingRef.current) return;
    // Debounce to max 1 Yjs write per 300ms
    clearTimeout(yjsSyncTimerRef.current);
    yjsSyncTimerRef.current = setTimeout(() => {
      try {
        const payload = JSON.stringify(compactStrokes(strokes ?? getCurrentStrokes()));
        pagesMap.set(`${currentPageId}_strokes`, payload);
      } catch (e) {
        console.error("Yjs sync error", e);
      }
    }, 300);
  }, [pagesMap, getCurrentStrokes, currentPageId]);

  // ─── History helpers ──────────────────────────────────────────────────────
  const pushUndo = useCallback(() => {
    const snap = JSON.parse(JSON.stringify(getCurrentStrokes()));
    undoStackRef.current.push({ pageId: currentPageId, strokes: snap });
    // Cap undo stack at 50 to save memory
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
    bumpVersion();
  }, [getCurrentStrokes, currentPageId]);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const { pageId, strokes } = undoStackRef.current.pop();
    // Push current to redo
    redoStackRef.current.push({ pageId, strokes: JSON.parse(JSON.stringify(getCurrentStrokes())) });
    allStrokesRef.current[pageId] = strokes;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (canvas && ctx) renderStrokes(ctx, canvas, strokes, backgroundColor);
    bumpVersion();
    syncToYjs(strokes);
  }, [getCurrentStrokes, getCtx, backgroundColor, syncToYjs]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const { pageId, strokes } = redoStackRef.current.pop();
    undoStackRef.current.push({ pageId, strokes: JSON.parse(JSON.stringify(getCurrentStrokes())) });
    allStrokesRef.current[pageId] = strokes;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (canvas && ctx) renderStrokes(ctx, canvas, strokes, backgroundColor);
    bumpVersion();
    syncToYjs(strokes);
  }, [getCurrentStrokes, getCtx, backgroundColor, syncToYjs]);

  // ─── Initialize canvas ────────────────────────────────────────────────────
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
    toast("Chanakya is ready!");

    const handleResize = () => {
      const saved = canvas.toDataURL("image/webp", 0.85);
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = saved;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Yjs observer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pagesMap) return;

    // Late-joiner: load existing strokes
    const existingPayload = pagesMap.get(`${currentPageId}_strokes`);
    if (existingPayload) {
      try {
        const remoteStrokes = JSON.parse(existingPayload);
        setCurrentStrokes(remoteStrokes);
        redraw(remoteStrokes, backgroundColor);
      } catch { /* ignore parse errors */ }
    }

    const observer = (event) => {
      if (isSyncingRef.current) return;
      const key = `${currentPageId}_strokes`;
      if (event.keysChanged?.has(key)) {
        const payload = pagesMap.get(key);
        if (!payload) return;
        try {
          const remoteStrokes = JSON.parse(payload);
          setCurrentStrokes(remoteStrokes);
          redraw(remoteStrokes, backgroundColor);
        } catch { /* ignore */ }
      }
    };

    pagesMap.observe(observer);
    return () => pagesMap.unobserve(observer);
  }, [pagesMap, currentPageId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const currentStrokeRef = useRef(null); // the in-progress stroke object
  const startPoint = useRef(null);
  const lastPoint = useRef(null);
  const strokeInitialImageRef = useRef(null); // ImageData snapshot before stroke starts

  const [importedImage, setImportedImage] = useState(null);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const dragMode = useRef(null);
  const backupFileRef = useRef(null);
  const previewCanvas = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const preview = document.createElement("canvas");
    preview.width = canvas.width;
    preview.height = canvas.height;
    previewCanvas.current = preview;
  }, []);

  // ─── Pointer helpers ──────────────────────────────────────────────────────
  const getPointerPosition = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX == null) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // ─── Imported image rendering ─────────────────────────────────────────────
  useEffect(() => {
    if (!importedImage) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    redraw(undefined, backgroundColor);
    ctx.drawImage(importedImage, imagePosition.x, imagePosition.y, imageDimensions.width, imageDimensions.height);
    ctx.strokeStyle = "#20c997"; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.strokeRect(imagePosition.x, imagePosition.y, imageDimensions.width, imageDimensions.height);
    ctx.setLineDash([]);
    const hs = 10;
    const corners = [
      [imagePosition.x, imagePosition.y],
      [imagePosition.x + imageDimensions.width, imagePosition.y],
      [imagePosition.x, imagePosition.y + imageDimensions.height],
      [imagePosition.x + imageDimensions.width, imagePosition.y + imageDimensions.height],
    ];
    ctx.fillStyle = "#20c997";
    corners.forEach(([cx, cy]) => ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs));
  }, [importedImage, imagePosition, imageDimensions, backgroundColor, redraw, getCtx]);

  // ─── Pointer Down ─────────────────────────────────────────────────────────
  const handlePointerDown = (e) => {
    const pos = getPointerPosition(e);
    if (!pos) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    // Image drag/resize
    if (importedImage && activeTool === "move") {
      const hs = 10;
      const x1 = imagePosition.x, y1 = imagePosition.y;
      const x2 = x1 + imageDimensions.width, y2 = y1 + imageDimensions.height;
      if (pos.x >= x1-hs && pos.x <= x1+hs && pos.y >= y1-hs && pos.y <= y1+hs) dragMode.current = "resize-nw";
      else if (pos.x >= x2-hs && pos.x <= x2+hs && pos.y >= y1-hs && pos.y <= y1+hs) dragMode.current = "resize-ne";
      else if (pos.x >= x1-hs && pos.x <= x1+hs && pos.y >= y2-hs && pos.y <= y2+hs) dragMode.current = "resize-sw";
      else if (pos.x >= x2-hs && pos.x <= x2+hs && pos.y >= y2-hs && pos.y <= y2+hs) dragMode.current = "resize-se";
      else if (pos.x > x1 && pos.x < x2 && pos.y > y1 && pos.y < y2) dragMode.current = "move";
    }

    isDrawing.current = true;
    lastPoint.current = pos;
    startPoint.current = pos;

    if (activeTool === "eraser") {
      // Stroke-level eraser: hit-test existing strokes on pointer down
      pushUndo();
      const eraserRadius = brushSize * 2;
      const strokes = getCurrentStrokes();
      const remaining = strokes.filter(
        (s) => !strokeHitTest(s, pos.x, pos.y, eraserRadius)
      );
      if (remaining.length !== strokes.length) {
        setCurrentStrokes(remaining);
        renderStrokes(ctx, canvas, remaining, backgroundColor);
        syncToYjs(remaining);
      }
      return;
    }

    if (activeTool === "pencil" || activeTool === "highlighter") {
      // Save ImageData snapshot so we can do live preview during drawing
      strokeInitialImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      currentStrokeRef.current = {
        id: newId(),
        type: "freehand",
        tool: activeTool,
        color: activeColor,
        size: brushSize,
        opacity: activeTool === "highlighter" ? 0.4 : 1,
        points: [[pos.x, pos.y, e.pressure || 0.5]],
      };
    } else if (["rectangle", "circle", "line"].includes(activeTool)) {
      strokeInitialImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      currentStrokeRef.current = {
        id: newId(),
        type: "shape",
        tool: activeTool,
        color: activeColor,
        size: brushSize,
        start: pos,
        end: pos,
      };
    }
  };

  // ─── Pointer Move ─────────────────────────────────────────────────────────
  const handlePointerMove = (e) => {
    if (!isDrawing.current) return;
    const pos = getPointerPosition(e);
    if (!pos) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    // Eraser: also erase while dragging
    if (activeTool === "eraser") {
      const eraserRadius = brushSize * 2;
      const strokes = getCurrentStrokes();
      const remaining = strokes.filter(
        (s) => !strokeHitTest(s, pos.x, pos.y, eraserRadius)
      );
      if (remaining.length !== strokes.length) {
        setCurrentStrokes(remaining);
        renderStrokes(ctx, canvas, remaining, backgroundColor);
        // Don't sync on every move — will sync on pointerUp
      }
      lastPoint.current = pos;
      return;
    }

    // Image drag
    if (activeTool === "move" && importedImage) {
      const dx = pos.x - lastPoint.current.x;
      const dy = pos.y - lastPoint.current.y;
      const dm = dragMode.current;
      if (dm === "move") {
        setImagePosition((p) => ({ x: p.x + dx, y: p.y + dy }));
      } else if (dm === "resize-se") {
        setImageDimensions((d) => ({ width: Math.max(50, d.width + dx), height: Math.max(50, d.height + dy) }));
      } else if (dm === "resize-sw") {
        setImagePosition((p) => ({ ...p, x: p.x + dx }));
        setImageDimensions((d) => ({ width: Math.max(50, d.width - dx), height: Math.max(50, d.height + dy) }));
      } else if (dm === "resize-ne") {
        setImagePosition((p) => ({ ...p, y: p.y + dy }));
        setImageDimensions((d) => ({ width: Math.max(50, d.width + dx), height: Math.max(50, d.height - dy) }));
      } else if (dm === "resize-nw") {
        setImagePosition((p) => ({ x: p.x + dx, y: p.y + dy }));
        setImageDimensions((d) => ({ width: Math.max(50, d.width - dx), height: Math.max(50, d.height - dy) }));
      }
      lastPoint.current = pos;
      return;
    }

    if (!currentStrokeRef.current) return;

    if (activeTool === "pencil" || activeTool === "highlighter") {
      currentStrokeRef.current.points.push([pos.x, pos.y, e.pressure || 0.5]);
      // Restore snapshot and overdraw the in-progress stroke
      if (strokeInitialImageRef.current) ctx.putImageData(strokeInitialImageRef.current, 0, 0);
      const drawn = getStroke(currentStrokeRef.current.points, {
        size: brushSize,
        thinning: activeTool === "highlighter" ? 0 : 0.6,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: e.pointerType !== "pen",
      });
      const pathData = getSvgPathFromStroke(drawn);
      if (pathData) {
        ctx.save();
        ctx.globalAlpha = activeTool === "highlighter" ? 0.4 : 1;
        ctx.fillStyle = activeColor;
        ctx.fill(new Path2D(pathData));
        ctx.restore();
      }
    } else if (["rectangle", "circle", "line"].includes(activeTool)) {
      currentStrokeRef.current.end = pos;
      // Live shape preview
      if (strokeInitialImageRef.current) ctx.putImageData(strokeInitialImageRef.current, 0, 0);
      ctx.save();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const { start, end } = currentStrokeRef.current;
      if (activeTool === "rectangle") {
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      } else if (activeTool === "circle") {
        const r = Math.hypot(end.x - start.x, end.y - start.y);
        ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      }
      ctx.restore();
    }

    lastPoint.current = pos;
  };

  // ─── Pointer Up ──────────────────────────────────────────────────────────
  const handlePointerUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    dragMode.current = null;
    strokeInitialImageRef.current = null;

    if (activeTool === "eraser") {
      syncToYjs();
      return;
    }

    if (currentStrokeRef.current) {
      pushUndo();
      const strokes = [...getCurrentStrokes(), currentStrokeRef.current];
      setCurrentStrokes(strokes);
      currentStrokeRef.current = null;
      syncToYjs(strokes);
    }

    lastPoint.current = null;
    startPoint.current = null;
  };

  // ─── Flood fill ──────────────────────────────────────────────────────────
  const hexToRgb = (hex) => {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null;
  };

  const handleClick = (e) => {
    if (activeTool !== "fill") return;
    const pos = getPointerPosition(e);
    if (!pos) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const { width, height } = canvas;
    const pi = (Math.floor(pos.y) * width + Math.floor(pos.x)) * 4;
    const tc = { r: data[pi], g: data[pi+1], b: data[pi+2], a: data[pi+3] };
    const nc = hexToRgb(activeColor);
    if (!nc) return;
    if (tc.r === nc.r && tc.g === nc.g && tc.b === nc.b) return;

    const queue = [[Math.floor(pos.x), Math.floor(pos.y)]];
    const visited = new Set();
    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      const key = `${cx},${cy}`;
      if (visited.has(key) || cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      visited.add(key);
      const idx = (cy * width + cx) * 4;
      if (
        Math.abs(data[idx]-tc.r) < 15 &&
        Math.abs(data[idx+1]-tc.g) < 15 &&
        Math.abs(data[idx+2]-tc.b) < 15
      ) {
        data[idx] = nc.r; data[idx+1] = nc.g; data[idx+2] = nc.b; data[idx+3] = 255;
        queue.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Store fill as a snapshot stroke
    const snapData = canvas.toDataURL("image/webp", 0.7);
    const snapStroke = { id: newId(), type: "snapshot", data: snapData };
    pushUndo();
    const strokes = [...getCurrentStrokes(), snapStroke];
    setCurrentStrokes(strokes);
    syncToYjs(strokes);
    toast("Area filled!");
  };

  // ─── Clear ───────────────────────────────────────────────────────────────
  const handleClear = () => {
    pushUndo();
    setCurrentStrokes([]);
    redraw([], backgroundColor);
    syncToYjs([]);
    toast("Canvas cleared!");
  };

  // ─── Save to Gallery ─────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const thumbnail = canvas.toDataURL("image/webp", 0.4);
      const canvasData = canvas.toDataURL("image/webp", 0.85);
      const page = { id: Date.now().toString(), name: `Drawing ${new Date().toLocaleTimeString()}`, thumbnail, canvasData, createdAt: Date.now() };
      if (savePage(page)) toast.success("Drawing saved to gallery");
      else toast.error("Failed to save drawing");
    } catch { toast.error("Failed to save drawing"); }
  }, []);

  // ─── Download ────────────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const result = await downloadCanvasAsPDF(canvas);
    result.success ? toast.success(`Downloaded: ${result.fileName}`) : toast.error(result.error || "Download failed");
  }, []);

  const handleDownloadAllPages = useCallback(async () => {
    const pagesWithContent = pages.filter((p) => !!p.canvasData);
    if (pagesWithContent.length === 0) return toast.error("No pages with content");
    const result = await downloadPagesAsPDF(pagesWithContent, "chanakya-drawings");
    result.success ? toast.success(`Downloaded: ${result.fileName}`) : toast.error(result.error || "Download failed");
  }, [pages]);

  // ─── Load page from gallery ───────────────────────────────────────────────
  const handleLoadPage = (canvasData) => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    pushUndo();
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const snapStroke = { id: newId(), type: "snapshot", data: canvas.toDataURL("image/webp", 0.7) };
      setCurrentStrokes([snapStroke]);
      syncToYjs([snapStroke]);
      toast.success("Drawing loaded!");
    };
    img.src = canvasData;
  };

  // ─── Backup restore ───────────────────────────────────────────────────────
  const handleLoadBackupFile = (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!Array.isArray(parsed) || parsed.length === 0) { toast.error("Invalid backup"); return; }
          setPages(parsed);
          const first = parsed[0];
          if (first?.id) setCurrentPageId(first.id);
          if (first?.canvasData) handleLoadPage(first.canvasData);
          else toast.success("Backup restored");
        } catch { toast.error("Failed to parse backup"); }
      };
      reader.readAsText(file);
    } catch { toast.error("Failed to load backup"); }
  };

  // ─── Import image ─────────────────────────────────────────────────────────
  const handleImportImage = (imageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > canvas.width || h > canvas.height) {
        const ratio = Math.min(canvas.width / w, canvas.height / h);
        w *= ratio; h *= ratio;
      }
      setImportedImage(img);
      setImagePosition({ x: (canvas.width - w) / 2, y: (canvas.height - h) / 2 });
      setImageDimensions({ width: w, height: h });
      setActiveTool("move");
      toast.success("Image imported! Drag to move, then click Place.");
    };
    img.src = imageData;
  };

  const handlePlaceImage = () => {
    if (!importedImage) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    redraw(getCurrentStrokes(), backgroundColor);
    ctx.drawImage(importedImage, imagePosition.x, imagePosition.y, imageDimensions.width, imageDimensions.height);
    const snapData = canvas.toDataURL("image/webp", 0.8);
    const snapStroke = { id: newId(), type: "snapshot", data: snapData };
    pushUndo();
    const strokes = [...getCurrentStrokes(), snapStroke];
    setCurrentStrokes(strokes);
    syncToYjs(strokes);
    setImportedImage(null);
    setActiveTool("pencil");
    toast.success("Image placed!");
  };

  // ─── Pages ────────────────────────────────────────────────────────────────
  const handleAddPage = () => {
    const newPageId = Date.now();
    const newPage = { id: newPageId, name: `Page ${pages.length + 1}`, canvasData: null };
    allStrokesRef.current[newPageId] = [];
    setPages([...pages, newPage]);
    setCurrentPageId(newPageId);
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (ctx && canvas) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    undoStackRef.current = [];
    redoStackRef.current = [];
    bumpVersion();
    toast.success("New page created!");
  };

  const handleSwitchPage = (pageId) => {
    if (pageId === currentPageId) return;
    // Save strokes for current page into pages state (canvasData = snapshot for download)
    const canvas = canvasRef.current;
    const canvasData = canvas ? canvas.toDataURL("image/webp", 0.7) : null;
    setPages((prev) => prev.map((p) => p.id === currentPageId ? { ...p, canvasData } : p));

    setCurrentPageId(pageId);
    undoStackRef.current = [];
    redoStackRef.current = [];
    bumpVersion();

    // Load the new page's strokes
    const ctx = getCtx();
    if (ctx && canvas) {
      const strokes = allStrokesRef.current[pageId] ?? [];
      renderStrokes(ctx, canvas, strokes, backgroundColor);
    }

    const page = pages.find((p) => p.id === pageId);
    toast(`Switched to ${page?.name ?? "page"}`);
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

  // ─── Cursor ───────────────────────────────────────────────────────────────
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
    <div className="h-screen w-screen overflow-hidden bg-workspace relative font-sans">
      {/* Canvas */}
      <div className="absolute inset-0 z-0">
        <div
          ref={containerRef}
          className="w-full h-full"
          style={orientation === "landscape" ? { aspectRatio: "16 / 9" } : {}}
        >
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

      {/* Floating Top-Left Menu button */}
      {!isMaximized && (
        <div className="absolute top-4 left-4 z-40 pointer-events-auto">
          <button
            className="p-2.5 bg-toolbar border border-toolbar-foreground/20 rounded-xl text-toolbar-foreground hover:bg-toolbar-hover transition-colors shadow-sm"
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Floating Top-Right: Dashboard + status */}
      {!isMaximized && (
        <div className="absolute top-4 right-4 z-40 flex items-center gap-2 pointer-events-auto">
          <span
            className={`text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-xl border ${
              status === "connected"
                ? "bg-green-500/10 text-green-500 border-green-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}
          >
            {status === "connected" ? "● Synced" : "○ Offline"}
          </span>
          <button
            onClick={() => setShowDashboard(true)}
            className="flex items-center justify-center p-2.5 bg-toolbar border border-toolbar-foreground/20 text-toolbar-foreground hover:bg-toolbar-hover rounded-xl transition-colors shadow-sm"
            title="Collaboration Dashboard"
          >
            <Users className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Floating Top-Center Main Toolbar */}
      <div
        className={`absolute top-4 left-1/2 -translate-x-1/2 z-40 transition-all ${
          isMaximized ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"
        }`}
      >
        <div className="bg-toolbar shadow-md border border-toolbar-foreground/15 rounded-xl p-1">
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

      {/* Floating Bottom-Left: Page tabs */}
      {!isMaximized && (
        <div className="absolute bottom-6 left-4 z-40 flex items-center gap-2 pointer-events-auto bg-toolbar border border-toolbar-foreground/15 p-1.5 rounded-xl shadow-md">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => handleSwitchPage(page.id)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
                currentPageId === page.id
                  ? "bg-toolbar-active text-accent-foreground"
                  : "text-toolbar-foreground hover:bg-toolbar-hover"
              }`}
            >
              {page.name}
            </button>
          ))}
        </div>
      )}

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