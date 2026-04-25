// Main paint workspace component.
// Owns the <canvas> element, drawing tools, undo/redo logic, and integration
// with the saved gallery and toolbar.
import { useEffect, useRef, useState, useCallback } from "react";
import { Toolbar } from "./Toolbar";
import { savePage } from "./SavedPagesGallery";
import { toast } from "sonner";
import { downloadCanvasAsPDF, downloadPagesAsPDF } from "@/services/storageService";
import { useCollaboration } from "@/hooks/useCollaboration";
import { useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import { RoomDashboard } from "@/components/shared/RoomDashboard";

export const PaintCanvas = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // UI / tool state
  const [activeTool, setActiveTool] = useState("pencil");
  const [activeColor, setActiveColor] = useState("#000000");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(5);
  const [isMaximized, setIsMaximized] = useState(false);
  const [orientation, setOrientation] = useState("portrait"); // portrait or landscape
  
  const [searchParams, setSearchParams] = useSearchParams();
  const token = localStorage.getItem("auth_token");
  const roomId = searchParams.get("room");
  const [showDashboard, setShowDashboard] = useState(false);
  const { pagesMap, status, roomState, sendWsMessage } = useCollaboration(roomId, token);

  const userId = token ? (function(){ try { return JSON.parse(atob(token.split('.')[1]))?.id } catch(e) { return null; } })() : null;
  const isHost = roomState?.hostId === userId;

  // Generate a room if none exists
  useEffect(() => {
    if (!roomId) {
      const newRoom = Math.random().toString(36).substring(2, 8);
      searchParams.set("room", newRoom);
      setSearchParams(searchParams, { replace: true });
    }
  }, [roomId, searchParams, setSearchParams]);

  const [pages, setPages] = useState([
    { id: "page-1", name: "Page 1", canvasData: null }
  ]);
  const [currentPageId, setCurrentPageId] = useState("page-1");

  // Undo/redo history of canvas snapshots (as data URLs)
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Image import state
  const [importedImage, setImportedImage] = useState(null);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  
  const isInitialized = useRef(false);
  const prevBackgroundColor = useRef("#ffffff");
  const dragMode = useRef(null); // 'move', 'resize-nw', 'resize-ne', 'resize-sw', 'resize-se'
  
  const isDrawing = useRef(false);
  const lastPoint = useRef(null);
  const startPoint = useRef(null);
  const previewCanvas = useRef(null);
  const backupFileRef = useRef(null);

  // Get canvas context
  const getContext = useCallback(() => {
    // Always read the 2D drawing context from the current canvas ref
    return canvasRef.current?.getContext("2d");
  }, []);

  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const dataUrl = canvas.toDataURL();
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      return [...newHistory, dataUrl];
    });
    setHistoryIndex((prev) => prev + 1);

    if (pagesMap && isInitialized.current) {
        pagesMap.set(currentPageId.toString(), dataUrl);
    }
  }, [historyIndex, pagesMap, currentPageId]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Fill with background color
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Create preview canvas for shape drawing
    const preview = document.createElement("canvas");
    preview.width = canvas.width;
    preview.height = canvas.height;
    previewCanvas.current = preview;

    // Save initial state
    const initialState = canvas.toDataURL();
    setHistory([initialState]);
    setHistoryIndex(0);
    isInitialized.current = true;

    toast("Chanakya is ready!");

    // Handle resize
    const handleResize = () => {
      if (!container || !canvas) return;
      
      // Save current content
      const imageData = canvas.toDataURL();
      
      // Resize canvas
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      
      if (previewCanvas.current) {
        previewCanvas.current.width = canvas.width;
        previewCanvas.current.height = canvas.height;
      }
      
      // Restore content
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = imageData;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Yjs Sync Effect
  useEffect(() => {
    if (!pagesMap || !isInitialized.current) return;
    
    const observer = (event) => {
      if (event.keysChanged.has(currentPageId.toString())) {
        const remoteData = pagesMap.get(currentPageId.toString());
        const canvas = canvasRef.current;
        const ctx = getContext();
        if (remoteData && canvas && ctx) {
            const currentData = canvas.toDataURL();
            if (remoteData !== currentData) {
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    // Silently update top of history without triggering saveToHistory
                    setHistory((prev) => {
                       if (prev.length === 0) return [remoteData];
                       const h = [...prev];
                       h[historyIndex] = remoteData;
                       return h;
                    });
                };
                img.src = remoteData;
            }
        }
      }
    };
    
    pagesMap.observe(observer);
    
    // Initial sync load
    const remoteData = pagesMap.get(currentPageId.toString());
    if (remoteData) {
      const canvas = canvasRef.current;
      const ctx = getContext();
      if (canvas && ctx) {
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = remoteData;
      }
    }
    
    return () => pagesMap.unobserve(observer);
  }, [pagesMap, currentPageId, getContext, historyIndex]);

  // Handle background color change - replace old background with new one
  useEffect(() => {
    if (!isInitialized.current) return;
    if (prevBackgroundColor.current === backgroundColor) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get the current image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Parse old and new background colors
    const oldBg = hexToRgb(prevBackgroundColor.current);
    const newBg = hexToRgb(backgroundColor);
    
    if (oldBg && newBg) {
      // Replace old background color pixels with new background color
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Check if pixel matches old background (with some tolerance)
        if (Math.abs(r - oldBg.r) < 10 && 
            Math.abs(g - oldBg.g) < 10 && 
            Math.abs(b - oldBg.b) < 10) {
          data[i] = newBg.r;
          data[i + 1] = newBg.g;
          data[i + 2] = newBg.b;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
    }
    
    prevBackgroundColor.current = backgroundColor;
  }, [backgroundColor]);

  // Auto-save current page data when history changes
  useEffect(() => {
    if (!isInitialized.current || history.length === 0) return;
    
    // Debounce auto-save to avoid saving on every stroke
    const timer = setTimeout(() => {
      setPages(prevPages => 
        prevPages.map(p => 
          p.id === currentPageId 
            ? { ...p, canvasData: history[historyIndex] }
            : p
        )
      );
    }, 500);
    
    return () => clearTimeout(timer);
  }, [history, historyIndex, currentPageId]);

  // Render imported image while it's being moved
  useEffect(() => {
    if (!importedImage) return;

    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    // Clear and redraw background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw the image at current position
    ctx.drawImage(
      importedImage,
      imagePosition.x,
      imagePosition.y,
      imageDimensions.width,
      imageDimensions.height
    );

    // Draw border to show the image bounds
    ctx.strokeStyle = "#20c997";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
      imagePosition.x,
      imagePosition.y,
      imageDimensions.width,
      imageDimensions.height
    );
    ctx.setLineDash([]);

    // Draw resize handles at corners
    const handleSize = 10;
    ctx.fillStyle = "#20c997";
    const corners = [
      { x: imagePosition.x, y: imagePosition.y }, // NW
      { x: imagePosition.x + imageDimensions.width, y: imagePosition.y }, // NE
      { x: imagePosition.x, y: imagePosition.y + imageDimensions.height }, // SW
      { x: imagePosition.x + imageDimensions.width, y: imagePosition.y + imageDimensions.height } // SE
    ];
    
    corners.forEach(corner => {
      ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
    });
  }, [importedImage, imagePosition, imageDimensions, backgroundColor]);

  // Helper function to convert hex to RGB
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  const getPointerPosition = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  // Draw line between two points
  const drawLine = (ctx, from, to, color, size) => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  // Handle drawing start
  const handlePointerDown = (e) => {
    const pos = getPointerPosition(e);
    if (!pos) return;

    // Check if clicking on image resize handles
    if (importedImage && activeTool === "move") {
      const handleSize = 10;
      const x1 = imagePosition.x;
      const y1 = imagePosition.y;
      const x2 = imagePosition.x + imageDimensions.width;
      const y2 = imagePosition.y + imageDimensions.height;

      // Check corners
      if (pos.x >= x1 - handleSize && pos.x <= x1 + handleSize &&
          pos.y >= y1 - handleSize && pos.y <= y1 + handleSize) {
        dragMode.current = 'resize-nw';
      } else if (pos.x >= x2 - handleSize && pos.x <= x2 + handleSize &&
                 pos.y >= y1 - handleSize && pos.y <= y1 + handleSize) {
        dragMode.current = 'resize-ne';
      } else if (pos.x >= x1 - handleSize && pos.x <= x1 + handleSize &&
                 pos.y >= y2 - handleSize && pos.y <= y2 + handleSize) {
        dragMode.current = 'resize-sw';
      } else if (pos.x >= x2 - handleSize && pos.x <= x2 + handleSize &&
                 pos.y >= y2 - handleSize && pos.y <= y2 + handleSize) {
        dragMode.current = 'resize-se';
      } else if (pos.x > x1 && pos.x < x2 && pos.y > y1 && pos.y < y2) {
        dragMode.current = 'move';
      }
    }

    isDrawing.current = true;
    lastPoint.current = pos;
    startPoint.current = pos;

    const ctx = getContext();
    if (!ctx) return;

    if (activeTool === "pencil" || activeTool === "eraser" || activeTool === "highlighter") {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
      if (activeTool === "eraser") {
        ctx.fillStyle = backgroundColor;
      } else {
        ctx.fillStyle = activeColor;
        if (activeTool === "highlighter") {
          ctx.globalAlpha = 0.4; // Transparent for highlighter
        }
      }
      ctx.fill();
      ctx.globalAlpha = 1; // Reset alpha
    }
  };

  // Handle drawing movement
  const handlePointerMove = (e) => {
    if (!isDrawing.current) return;

    const pos = getPointerPosition(e);
    if (!pos || !lastPoint.current) return;

    const ctx = getContext();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    if (activeTool === "move" && importedImage) {
      const deltaX = pos.x - lastPoint.current.x;
      const deltaY = pos.y - lastPoint.current.y;
      
      if (dragMode.current === 'move') {
        // Move imported image
        setImagePosition(prev => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY
        }));
      } else if (dragMode.current === 'resize-se') {
        // Resize from bottom-right corner
        setImageDimensions(prev => ({
          width: Math.max(50, prev.width + deltaX),
          height: Math.max(50, prev.height + deltaY)
        }));
      } else if (dragMode.current === 'resize-sw') {
        // Resize from bottom-left corner
        setImagePosition(prev => ({ ...prev, x: prev.x + deltaX }));
        setImageDimensions(prev => ({
          width: Math.max(50, prev.width - deltaX),
          height: Math.max(50, prev.height + deltaY)
        }));
      } else if (dragMode.current === 'resize-ne') {
        // Resize from top-right corner
        setImagePosition(prev => ({ ...prev, y: prev.y + deltaY }));
        setImageDimensions(prev => ({
          width: Math.max(50, prev.width + deltaX),
          height: Math.max(50, prev.height - deltaY)
        }));
      } else if (dragMode.current === 'resize-nw') {
        // Resize from top-left corner
        setImagePosition(prev => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY
        }));
        setImageDimensions(prev => ({
          width: Math.max(50, prev.width - deltaX),
          height: Math.max(50, prev.height - deltaY)
        }));
      }
      
      lastPoint.current = pos;
    } else if (activeTool === "pencil" || activeTool === "eraser" || activeTool === "highlighter") {
      let color = activeColor;
      if (activeTool === "eraser") {
        color = backgroundColor;
        ctx.globalAlpha = 1;
      } else if (activeTool === "highlighter") {
        ctx.globalAlpha = 0.4;
      }
      drawLine(ctx, lastPoint.current, pos, color, brushSize);
      ctx.globalAlpha = 1; // Reset alpha
      lastPoint.current = pos;
    } else if (["rectangle", "circle", "line"].includes(activeTool) && startPoint.current) {
      // Draw preview on main canvas by restoring and redrawing
      const preview = previewCanvas.current;
      if (!preview) return;

      // Restore original state
      if (history[historyIndex]) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          drawShape(ctx, startPoint.current, pos);
        };
        img.src = history[historyIndex];
      } else {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawShape(ctx, startPoint.current, pos);
      }
    }
  };

  // Draw shape helper
  const drawShape = (ctx, start, end) => {
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (activeTool === "rectangle") {
      const width = end.x - start.x;
      const height = end.y - start.y;
      ctx.strokeRect(start.x, start.y, width, height);
    } else if (activeTool === "circle") {
      const radius = Math.sqrt(
        Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
      );
      ctx.beginPath();
      ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (activeTool === "line") {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  };

  // Handle drawing end
  const handlePointerUp = () => {
    if (isDrawing.current) {
      isDrawing.current = false;
      lastPoint.current = null;
      startPoint.current = null;
      dragMode.current = null;
      saveToHistory();
    }
  };

  // Flood fill algorithm for fill tool
  const floodFill = (ctx, canvas, x, y, fillColor) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    // Get the color at the clicked position
    const pixelIndex = (Math.floor(y) * width + Math.floor(x)) * 4;
    const targetColor = {
      r: data[pixelIndex],
      g: data[pixelIndex + 1],
      b: data[pixelIndex + 2],
      a: data[pixelIndex + 3]
    };

    // Convert hex color to RGB
    const rgb = hexToRgb(fillColor);
    const newColor = { r: rgb.r, g: rgb.g, b: rgb.b, a: 255 };

    // If target color and fill color are the same, no need to fill
    if (JSON.stringify(targetColor) === JSON.stringify(newColor)) return;

    // BFS flood fill
    const queue = [[Math.floor(x), Math.floor(y)]];
    const visited = new Set();

    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      const key = `${cx},${cy}`;

      if (visited.has(key) || cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      visited.add(key);

      const idx = (cy * width + cx) * 4;
      const pixelColor = {
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
        a: data[idx + 3]
      };

      // Check if pixel color matches target color (with tolerance)
      if (Math.abs(pixelColor.r - targetColor.r) < 10 &&
          Math.abs(pixelColor.g - targetColor.g) < 10 &&
          Math.abs(pixelColor.b - targetColor.b) < 10 &&
          Math.abs(pixelColor.a - targetColor.a) < 10) {
        data[idx] = newColor.r;
        data[idx + 1] = newColor.g;
        data[idx + 2] = newColor.b;
        data[idx + 3] = newColor.a;

        queue.push([cx + 1, cy]);
        queue.push([cx - 1, cy]);
        queue.push([cx, cy + 1]);
        queue.push([cx, cy - 1]);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  };

  // Handle fill tool click
  const handleClick = (e) => {
    if (activeTool !== "fill") return;

    const pos = getPointerPosition(e);
    if (!pos) return;

    const ctx = getContext();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    floodFill(ctx, canvas, pos.x, pos.y, activeColor);
    saveToHistory();
    toast("Area filled!");
  };

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;

    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    const newIndex = historyIndex - 1;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      setHistoryIndex(newIndex);
    };
    img.src = history[newIndex];
  }, [historyIndex, history, getContext]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;

    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    const newIndex = historyIndex + 1;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      setHistoryIndex(newIndex);
    };
    img.src = history[newIndex];
  }, [historyIndex, history, getContext]);

  // Clear canvas
  const handleClear = () => {
    const ctx = getContext();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveToHistory();
    toast("Canvas cleared!");
  };

  // Save drawing only to offline gallery (IndexedDB)
  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const thumbnail = canvas.toDataURL("image/png", 0.5);
      const canvasData = canvas.toDataURL("image/png");

      const page = {
        id: Date.now().toString(),
        name: `Drawing ${new Date().toLocaleTimeString()}`,
        thumbnail,
        canvasData,
        createdAt: Date.now(),
      };

      const saved = savePage(page);
      if (saved) {
        toast.success("Drawing saved to gallery (offline)");
      } else {
        toast.error("Failed to save drawing");
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save drawing");
    }
  }, []);

  // Download drawing to Downloads folder as PDF
  const handleDownload = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const result = await downloadCanvasAsPDF(canvas);
    if (result.success) {
      toast.success(`Downloaded: ${result.fileName}`);
    } else {
      toast.error(result.error || "Download failed");
    }
  }, []);

  // Download all pages as a single multi-page PDF
  const handleDownloadAllPages = useCallback(async () => {
    if (pages.length === 0) {
      toast.error("No pages to download");
      return;
    }

    const pagesWithContent = pages.filter(p => !!p.canvasData);
    if (pagesWithContent.length === 0) {
      toast.error("No pages with content to download");
      return;
    }

    const result = await downloadPagesAsPDF(pagesWithContent, "chanakya-drawings");
    if (result.success) {
      toast.success(`Downloaded: ${result.fileName}`);
    } else {
      toast.error(result.error || "Download failed");
    }
  }, [pages]);

  // Load saved page
  const handleLoadPage = (canvasData) => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      saveToHistory();
      toast.success("Drawing loaded!");
    };
    img.src = canvasData;
  };

  // Restore pages from a JSON backup file
  const handleLoadBackupFile = (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!Array.isArray(parsed) || parsed.length === 0) {
            toast.error("Invalid or empty backup file");
            return;
          }
          // Expecting an array of pages with { id, name, canvasData }
          setPages(parsed);
          const first = parsed[0];
          if (first?.id) setCurrentPageId(first.id);

          const canvas = canvasRef.current;
          const ctx = getContext();
          if (canvas && ctx && first?.canvasData) {
            const img = new Image();
            img.onload = () => {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0);
              setHistory([first.canvasData]);
              setHistoryIndex(0);
              toast.success("Backup restored");
            };
            img.onerror = () => toast.error("Failed to load first page from backup");
            img.src = first.canvasData;
          } else {
            toast.success("Backup restored");
          }
        } catch (err) {
          console.error("Backup parse error:", err);
          toast.error("Failed to parse backup JSON");
        }
      };
      reader.readAsText(file);
    } catch (err) {
      console.error("Backup load error:", err);
      toast.error("Failed to load backup file");
    }
  };

  // Import image
  const handleImportImage = (imageData) => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    const img = new Image();
    img.onload = () => {
      // Calculate dimensions to fit image on canvas
      let width = img.width;
      let height = img.height;
      
      if (width > canvas.width || height > canvas.height) {
        const ratio = Math.min(canvas.width / width, canvas.height / height);
        width *= ratio;
        height *= ratio;
      }
      
      const x = (canvas.width - width) / 2;
      const y = (canvas.height - height) / 2;
      
      // Store image data for positioning
      setImportedImage(img);
      setImagePosition({ x, y });
      setImageDimensions({ width, height });
      setActiveTool("move");
      
      toast.success("Image imported! Drag to move, drag corners to resize, then click 'Place' to finalize.");
    };
    img.src = imageData;
  };

  // Place the imported image on canvas
  const handlePlaceImage = () => {
    if (!importedImage) return;
    
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(importedImage, imagePosition.x, imagePosition.y, imageDimensions.width, imageDimensions.height);
    
    saveToHistory();
    setImportedImage(null);
    setActiveTool("pencil");
    toast.success("Image placed!");
  };

  // Add new page
  const handleAddPage = () => {
    const newPageId = Date.now();
    const newPage = {
      id: newPageId,
      name: `Page ${pages.length + 1}`,
      canvasData: null
    };
    setPages([...pages, newPage]);
    setCurrentPageId(newPageId);
    
    // Clear canvas for new page
    const ctx = getContext();
    const canvas = canvasRef.current;
    if (ctx && canvas) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setHistory([canvas.toDataURL()]);
      setHistoryIndex(0);
    }
    toast.success("New page created!");
  };

  // Switch page
  const handleSwitchPage = (pageId) => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    
    if (!canvas || !ctx) return;

    // Save current page data before switching
    const updatedPages = pages.map(p => 
      p.id === currentPageId 
        ? { ...p, canvasData: canvas.toDataURL() } 
        : p
    );
    
    // Find the page we're switching to
    const targetPage = updatedPages.find(p => p.id === pageId);
    if (!targetPage) return;

    // Update pages and current page ID
    setPages(updatedPages);
    setCurrentPageId(pageId);

    // Load the target page's canvas data
    if (targetPage.canvasData) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHistory([img.src]);
        setHistoryIndex(0);
        toast(`Switched to ${targetPage.name}`);
      };
      img.onerror = () => {
        toast.error("Failed to load page");
      };
      img.src = targetPage.canvasData;
    } else {
      // Empty page - just clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setHistory([canvas.toDataURL()]);
      setHistoryIndex(0);
      toast(`Switched to ${targetPage.name}`);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") {
          e.preventDefault();
          handleUndo();
        } else if (e.key === "y") {
          e.preventDefault();
          handleRedo();
        } else if (e.key === "s") {
          e.preventDefault();
          handleSave();
        }
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

  // Get cursor style based on tool
  const getCursor = () => {
    switch (activeTool) {
      case "pencil":
      case "eraser":
      case "rectangle":
      case "circle":
      case "line":
        return "crosshair";
      case "fill":
        return "cell";
      default:
        return "default";
    }
  };

  return (
    <div className="flex flex-col h-screen bg-workspace">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-toolbar border-b border-toolbar-foreground/10">
        <h1 className="text-lg font-semibold text-toolbar-foreground">Chanakya</h1>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowDashboard(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-toolbar-foreground/60 hover:bg-toolbar-foreground/10 transition-colors"
          >
            <Users className="h-3.5 w-3.5" />
            Dashboard
          </button>
          {roomId && (
            <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2 py-1 rounded cursor-pointer hover:bg-blue-500/20 transition-colors" title="Share this URL to collaborate" onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success("URL copied to clipboard!"); }}>
              Room: {roomId}
            </span>
          )}
          <span className="text-xs text-toolbar-foreground/60">Raspberry Pi Edition</span>
          <span className={`text-xs px-2 py-1 rounded-full ${status === 'connected' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {status === 'connected' ? '● Synced' : '○ Offline'}
          </span>
        </div>
      </header>

      {/* Toolbar - Always visible on top */}
      <div className={`px-4 py-2 ${isMaximized ? "fixed top-12 left-0 right-0 z-50 bg-toolbar border-b" : ""}`}>
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
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
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

      {/* Pages Tab - Only visible when not maximized */}
      {!isMaximized && (
        <div className="flex items-center gap-2 px-4 py-2 bg-toolbar-foreground/5 border-b border-toolbar-foreground/10 overflow-x-auto">
          {pages.map(page => (
            <button
              key={page.id}
              onClick={() => handleSwitchPage(page.id)}
              className={`px-4 py-2 text-sm rounded-lg transition-all font-semibold border-2 ${
                currentPageId === page.id
                  ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105"
                  : "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80 hover:shadow-md"
              }`}
            >
              {page.name}
            </button>
          ))}
        </div>
      )}

      {/* Canvas Area */}
      <div className={`flex-1 p-4 overflow-visible relative ${isMaximized ? "fixed inset-12 z-40" : ""}`}>
        <div
          ref={containerRef}
          className={`w-full h-full bg-canvas rounded-lg border border-canvas-border shadow-inner overflow-hidden relative ${
            orientation === "landscape" ? "" : ""
          }`}
          style={orientation === "landscape" ? { aspectRatio: "16 / 9" } : {}}
        >
          <canvas
            ref={canvasRef}
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

      {/* Status Bar - Only visible when not maximized */}
      {!isMaximized && (
        <footer className="flex items-center justify-between px-4 py-1 bg-toolbar text-toolbar-foreground/60 text-xs">
          <span>Tool: {activeTool.charAt(0).toUpperCase() + activeTool.slice(1)}</span>
          <span>Color: {activeColor}</span>
          <span>Size: {brushSize}px</span>
          <span>{orientation === "portrait" ? "📱 Portrait" : "🏔️ Landscape"}</span>
          <span>{isMaximized ? "Maximized" : "Normal"}</span>
        </footer>
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