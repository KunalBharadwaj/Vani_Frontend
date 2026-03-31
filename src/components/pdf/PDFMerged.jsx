// PDF Viewer with collaborative sharing via Yjs.
// When a user uploads a PDF, the file data is stored in a shared Yjs map
// so all room members instantly see and can navigate the same document.
import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useSearchParams } from 'react-router-dom';
import { useCollaboration } from '@/hooks/useCollaboration';
import { toast } from 'sonner';
import {
  Upload,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  Users,
  Loader2,
  X,
  Pencil,
  Trash2,
  Undo2,
  Redo2,
  Hand,
  History,
} from 'lucide-react';

// Configure PDF.js worker from public folder
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Annotation drawing colors
const ANNOTATION_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#000000',
];

const PDFMerged = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const roomId = searchParams.get('room');
  const readonly = searchParams.get('readonly') === 'true';
  const token = localStorage.getItem('auth_token');

  const [showHistory, setShowHistory] = useState(false);
  const [historyDocs, setHistoryDocs] = useState([]);

  // Ensure room exists (same logic as PaintCanvas)
  useEffect(() => {
    if (!roomId) {
      const newRoom = Math.random().toString(36).substring(2, 8);
      searchParams.set('room', newRoom);
      setSearchParams(searchParams, { replace: true });
    }
  }, [roomId, searchParams, setSearchParams]);

  const { pdfMap, status } = useCollaboration(roomId, token);

  // PDF state
  const [pdfDataUrl, setPdfDataUrl] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [pdfFileName, setPdfFileName] = useState('');
  const [currentPage, _setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  const setCurrentPage = useCallback((val) => {
    const newVal = typeof val === 'function' ? val(currentPageRef.current) : val;
    currentPageRef.current = newVal;
    _setCurrentPage(newVal);
  }, []);

  // Annotation state
  const [annotating, setAnnotating] = useState(false);
  const [annotationColor, setAnnotationColor] = useState('#ef4444');
  const [annotationSize, setAnnotationSize] = useState(3);
  const [isErasing, setIsErasing] = useState(false);
  const annotationCanvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const annotationHistoryRef = useRef({});   // page -> stack of data-URLs for undo
  const redoHistoryRef = useRef({});         // page -> stack of data-URLs for redo
  const pageContainerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, sL: 0, sT: 0 });

  const fileInputRef = useRef(null);
  const isSyncingRef = useRef(false);  // prevent echo loops
  const lastRemoteCanvasOverlayRef = useRef(null);

  // ─── Yjs observation: react to remote changes ───────────────────
  useEffect(() => {
    if (!pdfMap) return;

    // Initial load from Yjs state (e.g. late joiner)
    const existingPdf = pdfMap.get('pdfData');
    const existingName = pdfMap.get('fileName');
    const existingPage = pdfMap.get('currentPage') || 1;
    const existingCanvas = pdfMap.get(`canvasOverlay_${existingPage}`);
    if (existingPage !== currentPageRef.current) setCurrentPage(existingPage);

    if (existingPdf && !pdfDataUrl) {
      setPdfDataUrl(existingPdf);
      if (existingName) setPdfFileName(existingName);
    }
    
    const applyRemoteCanvas = (remoteCanvas) => {
        const c = annotationCanvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!remoteCanvas) {
            ctx.clearRect(0, 0, c.width, c.height);
        } else {
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0);
            };
            img.src = remoteCanvas;
        }
    };
    
    if (existingCanvas) {
        lastRemoteCanvasOverlayRef.current = existingCanvas;
        // The canvas might not be mounted immediately on first render if container hasn't sized,
        // but observer sync handles subsequent ones. Use requestAnimationFrame to ensure mount.
        setTimeout(() => applyRemoteCanvas(existingCanvas), 100);
    }

    const observer = () => {
      if (isSyncingRef.current) return;

      const remotePdf = pdfMap.get('pdfData');
      const remoteName = pdfMap.get('fileName');
      const remotePage = pdfMap.get('currentPage') || 1;
      const remoteCanvas = pdfMap.get(`canvasOverlay_${remotePage}`);

      if (remotePdf && remotePdf !== pdfDataUrl) {
        setPdfDataUrl(remotePdf);
      }
      if (remoteName) {
        setPdfFileName(remoteName);
      }
      if (remotePage !== currentPageRef.current) {
        setCurrentPage(remotePage);
      }
      if (remoteCanvas !== lastRemoteCanvasOverlayRef.current) {
          lastRemoteCanvasOverlayRef.current = remoteCanvas;
          applyRemoteCanvas(remoteCanvas);
      }

      // If PDF was removed
      if (!remotePdf && pdfDataUrl) {
        setPdfDataUrl(null);
        setNumPages(null);
        setPdfFileName('');
      }
    };
    
    pdfMap.observe(observer);

    return () => pdfMap.unobserve(observer);
  }, [pdfMap]);  // intentionally only depend on pdfMap reference

  // ─── Upload handler ─────────────────────────────────────────────
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast.error('Please select a valid PDF file');
      return;
    }

    // 15 MB limit
    if (file.size > 15 * 1024 * 1024) {
      toast.error('PDF must be smaller than 15 MB');
      return;
    }

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (typeof dataUrl !== 'string') return;

      setPdfDataUrl(dataUrl);
      setPdfFileName(file.name);

      // Push to Yjs so all room members get it
      if (pdfMap) {
        isSyncingRef.current = true;
        pdfMap.set('pdfData', dataUrl);
        pdfMap.set('fileName', file.name);
        isSyncingRef.current = false;
      }

      // Record to Session History Database
      if (token && roomId) {
        const backendUrl = import.meta.env?.VITE_BACKEND_URL || 'https://vani-backend-mjsl.onrender.com';
        fetch(`${backendUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ roomId, pdfFileName: file.name })
        }).catch(err => console.error("History logging error:", err));
      }

      setLoading(false);
      toast.success(`Uploaded: ${file.name}`);
    };
    reader.onerror = () => {
      setLoading(false);
      toast.error('Failed to read PDF file');
    };
    reader.readAsDataURL(file);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [pdfMap]);

  // ─── PDF loaded callback ────────────────────────────────────────
  const onDocumentLoadSuccess = ({ numPages: n }) => {
    setNumPages(n);
    setLoading(false);
  };

  // ─── Page Navigation ───────────────────────────────────────────
  const changePage = useCallback((offset) => {
    setCurrentPage(prev => {
      const newPage = Math.max(1, Math.min(prev + offset, numPages || 1));
      if (newPage !== prev) {
        if (pdfMap) {
          isSyncingRef.current = true;
          pdfMap.set('currentPage', newPage);
          isSyncingRef.current = false;
        }
        // Apply existing canvas for the new page
        setTimeout(() => {
          const newCanvas = pdfMap?.get(`canvasOverlay_${newPage}`);
          lastRemoteCanvasOverlayRef.current = newCanvas;
          const c = annotationCanvasRef.current;
          if (c) {
             const ctx = c.getContext('2d');
             if (!newCanvas) {
                ctx.clearRect(0, 0, c.width, c.height);
             } else {
                const img = new Image();
                img.onload = () => {
                   ctx.clearRect(0, 0, c.width, c.height);
                   ctx.drawImage(img, 0, 0);
                };
                img.src = newCanvas;
             }
          }
        }, 50);
      }
      return newPage;
    });
  }, [numPages, pdfMap]);

  const prevPage = () => changePage(-1);
  const nextPage = () => changePage(1);

  // ─── Zoom ──────────────────────────────────────────────────────
  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

  // ─── Close / remove PDF ────────────────────────────────────────
  const closePdf = useCallback(() => {
    setPdfDataUrl(null);
    setNumPages(null);
    setPdfFileName('');
    if (pdfMap) {
      isSyncingRef.current = true;
      pdfMap.delete('pdfData');
      pdfMap.delete('fileName');
      pdfMap.delete('currentPage');
      isSyncingRef.current = false;
    }
    toast('PDF removed');
  }, [pdfMap]);

  // ─── Annotation helpers ─────────────────────────────────────────
  const saveAnnotationSnapshot = () => {
    const c = annotationCanvasRef.current;
    if (!c) return;
    if (!annotationHistoryRef.current[currentPageRef.current]) annotationHistoryRef.current[currentPageRef.current] = [];
    annotationHistoryRef.current[currentPageRef.current].push(c.toDataURL());
    redoHistoryRef.current[currentPageRef.current] = []; // Clear redo stack eagerly
  };

  const undoAnnotation = () => {
    const page = currentPageRef.current;
    if (!annotationHistoryRef.current[page]) annotationHistoryRef.current[page] = [];
    if (!redoHistoryRef.current[page]) redoHistoryRef.current[page] = [];
    const stack = annotationHistoryRef.current[page];
    const redoStack = redoHistoryRef.current[page];
    const c = annotationCanvasRef.current;
    if (!c || stack.length === 0) return;
    
    // Save current canvas to redo stack BEFORE reverting
    redoStack.push(c.toDataURL());
    
    // Pop the target snapshot
    const targetDataUrl = stack.pop();
    
    const ctx = c.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      if (pdfMap) {
          isSyncingRef.current = true;
          pdfMap.set(`canvasOverlay_${currentPageRef.current}`, c.toDataURL());
          isSyncingRef.current = false;
      }
    };
    img.src = targetDataUrl;
  };

  const redoAnnotation = () => {
    const page = currentPageRef.current;
    if (!annotationHistoryRef.current[page]) annotationHistoryRef.current[page] = [];
    if (!redoHistoryRef.current[page]) redoHistoryRef.current[page] = [];
    const stack = annotationHistoryRef.current[page];
    const redoStack = redoHistoryRef.current[page];
    const c = annotationCanvasRef.current;
    if (!c || redoStack.length === 0) return;

    // Push current canvas to undo stack
    stack.push(c.toDataURL());

    // Pop the target redo snapshot
    const targetDataUrl = redoStack.pop();

    const ctx = c.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      if (pdfMap) {
          isSyncingRef.current = true;
          pdfMap.set(`canvasOverlay_${currentPageRef.current}`, c.toDataURL());
          isSyncingRef.current = false;
      }
    };
    img.src = targetDataUrl;
  };

  const clearAnnotations = () => {
    saveAnnotationSnapshot(); // Allow undoing the clear
    const c = annotationCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (pdfMap) {
        isSyncingRef.current = true;
        pdfMap.delete(`canvasOverlay_${currentPageRef.current}`);
        isSyncingRef.current = false;
    }
  };

  // Resize annotation canvas to match the rendered PDF page
  useEffect(() => {
    // If not actively panning nor annotating, we don't strictly need to disconnect, 
    // but relying on observer always is safe.
    const container = pageContainerRef.current;
    const c = annotationCanvasRef.current;
    if (!container || !c) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (c.width !== rect.width || c.height !== rect.height) {
        if (c.width > 0 && c.height > 0) {
            // Save & restore so resize doesn't erase drawings, scale the context visually!
            const dataUrl = c.toDataURL();
            c.width = rect.width;
            c.height = rect.height;
            const ctx = c.getContext('2d');
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
            img.src = dataUrl;
        } else {
            c.width = rect.width;
            c.height = rect.height;
        }
      }
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // ─── Annotation pointer handlers ─────────────────────────────
  const getCanvasPos = (e) => {
    const c = annotationCanvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (e) => {
    if (!annotating) {
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.touches ? e.touches[0].clientX : e.clientX,
        y: e.touches ? e.touches[0].clientY : e.clientY,
        sL: scrollContainerRef.current?.scrollLeft || 0,
        sT: scrollContainerRef.current?.scrollTop || 0
      };
      return;
    }
    e.preventDefault();
    isDrawingRef.current = true;
    lastPointRef.current = getCanvasPos(e);
    saveAnnotationSnapshot(); // saves state right before drawing
  };

  const onPointerMove = (e) => {
    if (!annotating && isPanningRef.current) {
        if (!scrollContainerRef.current) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - panStartRef.current.x;
        const dy = clientY - panStartRef.current.y;
        scrollContainerRef.current.scrollLeft = panStartRef.current.sL - dx;
        scrollContainerRef.current.scrollTop = panStartRef.current.sT - dy;
        return;
    }
    if (!annotating || !isDrawingRef.current) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const last = lastPointRef.current;
    if (!pos || !last) return;

    const c = annotationCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = isErasing ? 'rgba(0,0,0,1)' : annotationColor;
    ctx.lineWidth = isErasing ? annotationSize * 4 : annotationSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    lastPointRef.current = pos;
  };

  const onPointerUp = () => {
    isPanningRef.current = false;
    if (isDrawingRef.current) {
        if (pdfMap && annotationCanvasRef.current) {
            isSyncingRef.current = true;
            pdfMap.set(`canvasOverlay_${currentPageRef.current}`, annotationCanvasRef.current.toDataURL());
            isSyncingRef.current = false;
        }
    }
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  // ─── Keyboard navigation ───────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!pdfDataUrl) return;
      if (e.key === '+' || e.key === '=') zoomIn();
      if (e.key === '-') zoomOut();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevPage();
      if (e.key === 'ArrowRight' || e.key === 'PageDown') nextPage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pdfDataUrl]);

  // Handle Loading History Modal
  const loadHistory = async () => {
    try {
      if (token) {
        const backendUrl = import.meta.env?.VITE_BACKEND_URL || 'https://vani-backend-mjsl.onrender.com';
        const res = await fetch(`${backendUrl}/api/sessions`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          setHistoryDocs(await res.json());
        }
      }
    } catch (e) {
      console.error('History Error', e);
    }
    setShowHistory(true);
  };

  const historyModalJSX = showHistory && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b dark:border-zinc-800">
          <h2 className="text-lg font-semibold flex items-center gap-2"><History className="w-5 h-5"/> Session History</h2>
          <button onClick={() => setShowHistory(false)} className="p-1 hover:bg-black/5 rounded text-toolbar-foreground/60 hover:text-red-500"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {historyDocs.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No historical sessions found.</p>
          ) : (
            <div className="space-y-2">
              {historyDocs.map((doc, i) => (
                <a
                  key={i}
                  href={`/pdf?room=${doc.roomId}&readonly=true`}
                  className="flex items-center justify-between p-3 rounded-lg border dark:border-zinc-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <div>
                    <p className="font-medium text-blue-600 dark:text-blue-400">{doc.pdfFileName}</p>
                    <p className="text-xs text-toolbar-foreground/40 mt-1">Room: {doc.roomId} • {new Date(doc.createdAt).toLocaleString()}</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Empty state (no PDF loaded) ─────────────────────────────
  if (!pdfDataUrl) {
    return (
      <div className="h-full flex flex-col relative">
        {/* Header bar */}
        <header className="flex items-center justify-between px-4 py-2 bg-toolbar border-b border-toolbar-foreground/10">
          <h1 className="text-lg font-semibold text-toolbar-foreground flex items-center gap-2">
            <FileText className="h-5 w-5" />
            PDF Editor
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={loadHistory}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-toolbar-foreground/60 hover:bg-toolbar-foreground/10 transition-colors"
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>
            {roomId && (
              <span
                className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2 py-1 rounded cursor-pointer hover:bg-blue-500/20 transition-colors"
                title="Share this URL to collaborate"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  toast.success('URL copied to clipboard!');
                }}
              >
                Room: {roomId}
              </span>
            )}
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                status === 'connected'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {status === 'connected' ? '● Synced' : '○ Offline'}
            </span>
          </div>
        </header>

        {/* Upload prompt */}
        <div className="flex-1 flex items-center justify-center bg-workspace">
          <div
            className="relative group cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            {/* Glow ring */}
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-teal-500 via-blue-500 to-purple-500 opacity-30 blur-lg group-hover:opacity-60 transition-opacity duration-500" />
            <div className="relative flex flex-col items-center gap-6 px-16 py-14 rounded-2xl border-2 border-dashed border-toolbar-foreground/20 bg-card/80 backdrop-blur-sm hover:border-primary/50 transition-all duration-300">
              {loading ? (
                <Loader2 className="h-16 w-16 text-primary animate-spin" />
              ) : (
                <Upload className="h-16 w-16 text-toolbar-foreground/40 group-hover:text-primary transition-colors duration-300" />
              )}
              <div className="text-center">
                <p className="text-lg font-medium text-toolbar-foreground/80 group-hover:text-toolbar-foreground transition-colors">
                  {loading ? 'Loading PDF…' : 'Drop or click to upload a PDF'}
                </p>
                <p className="text-sm text-toolbar-foreground/40 mt-1">
                  All room members will see it instantly
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-toolbar-foreground/30">
                <Users className="h-3.5 w-3.5" />
                <span>Shared with everyone in the room</span>
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
        {historyModalJSX}
      </div>
    );
  }

  // ─── PDF viewer ─────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col relative">
      {/* Toolbar */}
      <header className="flex items-center justify-between px-4 py-2 bg-toolbar border-b border-toolbar-foreground/10">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-toolbar-foreground flex items-center gap-2">
            <FileText className="h-5 w-5" />
            PDF Editor
          </h1>
          {pdfFileName && (
            <span className="text-xs text-toolbar-foreground/50 truncate max-w-[200px]" title={pdfFileName}>
              {pdfFileName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!readonly && (
            <>
              {/* Pan toggle */}
              <button
                onClick={() => { setAnnotating(false); setIsErasing(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  !annotating
                    ? 'bg-blue-500/20 text-blue-600 dark:bg-blue-500/30'
                    : 'bg-toolbar-foreground/10 text-toolbar-foreground/60 hover:text-toolbar-foreground'
                }`}
                title="Pan / Scroll Mode"
              >
                <Hand className="h-3.5 w-3.5" />
                Scroll
              </button>

              {/* Annotation toggle */}
              <button
                onClick={() => { setAnnotating(true); setIsErasing(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  annotating
                    ? 'bg-primary/20 text-primary'
                    : 'bg-toolbar-foreground/10 text-toolbar-foreground/60 hover:text-toolbar-foreground'
                }`}
                title="Toggle annotation drawing"
              >
                <Pencil className="h-3.5 w-3.5" />
                Annotate
              </button>

              {annotating && (
                <>
                  {/* Eraser toggle */}
                  <button
                    onClick={() => setIsErasing(!isErasing)}
                    className={`p-1.5 rounded transition-colors ${
                      isErasing ? 'bg-orange-500/20 text-orange-400' : 'text-toolbar-foreground/50 hover:text-toolbar-foreground'
                    }`}
                    title="Eraser"
                  >
                    <Eraser className="h-4 w-4" />
                  </button>
                  {/* Undo */}
                  <button onClick={undoAnnotation} className="p-1.5 rounded text-toolbar-foreground/50 hover:text-toolbar-foreground transition-colors" title="Undo annotation">
                    <Undo2 className="h-4 w-4" />
                  </button>
                  {/* Redo */}
                  <button onClick={redoAnnotation} className="p-1.5 rounded text-toolbar-foreground/50 hover:text-toolbar-foreground transition-colors" title="Redo annotation">
                    <Redo2 className="h-4 w-4" />
                  </button>
                  {/* Clear */}
                  <button onClick={clearAnnotations} className="p-1.5 rounded text-toolbar-foreground/50 hover:text-toolbar-foreground transition-colors" title="Clear all annotations">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  
                  <div className="w-px h-4 bg-toolbar-foreground/20 mx-1" />
                  
                  {/* Color swatches */}
                  <div className="flex gap-0.5">
                    {ANNOTATION_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`w-5 h-5 rounded-full border-2 transition-transform ${
                          annotationColor === c && !isErasing ? 'border-white scale-125 z-10' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                        onClick={() => { setAnnotationColor(c); setIsErasing(false); }}
                      />
                    ))}
                  </div>

                  <div className="w-px h-4 bg-toolbar-foreground/20 mx-1" />

                  {/* Thickness slider */}
                  <div className="flex items-center gap-2 group relative" title={`Line Thickness: ${annotationSize}`}>
                    <input
                      type="range"
                      min="1"
                      max="15"
                      step="1"
                      value={annotationSize}
                      onChange={(e) => setAnnotationSize(Number(e.target.value))}
                      className="w-16 h-1.5 bg-toolbar-foreground/20 rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                </>
              )}
              <div className="w-px h-5 bg-toolbar-foreground/20 mx-1" />
            </>
          )}

          {/* Room / status */}
          {roomId && (
            <span
              className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2 py-1 rounded cursor-pointer hover:bg-blue-500/20 transition-colors"
              title="Share this URL to collaborate"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.success('URL copied to clipboard!');
              }}
            >
              Room: {roomId}
            </span>
          )}
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              status === 'connected'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {status === 'connected' ? '● Synced' : '○ Offline'}
          </span>

          {/* Upload new */}
          {!readonly && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Close */}
          <button
            onClick={closePdf}
            className="p-1.5 rounded text-toolbar-foreground/50 hover:text-red-400 transition-colors"
            title="Remove PDF"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Page controls */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 bg-toolbar-foreground/5 border-b border-toolbar-foreground/10">
        <button
          onClick={prevPage}
          disabled={currentPage <= 1 || !numPages}
          className="p-1.5 rounded-lg bg-toolbar-foreground/10 text-toolbar-foreground/70 hover:bg-toolbar-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Previous Page (Left Arrow)"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-toolbar-foreground/70 min-w-[60px] text-center">
          {numPages ? `${currentPage} / ${numPages}` : '-'}
        </span>
        <button
          onClick={nextPage}
          disabled={currentPage >= (numPages || 1) || !numPages}
          className="p-1.5 rounded-lg bg-toolbar-foreground/10 text-toolbar-foreground/70 hover:bg-toolbar-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Next Page (Right Arrow)"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="w-px h-5 bg-toolbar-foreground/20 mx-2" />

        <button
          onClick={zoomOut}
          disabled={scale <= 0.5}
          className="p-1.5 rounded-lg bg-toolbar-foreground/10 text-toolbar-foreground/70 hover:bg-toolbar-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-toolbar-foreground/50 min-w-[48px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={zoomIn}
          disabled={scale >= 3}
          className="p-1.5 rounded-lg bg-toolbar-foreground/10 text-toolbar-foreground/70 hover:bg-toolbar-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>

      {/* PDF rendering area */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto bg-workspace flex justify-center p-6"
      >
        <div ref={pageContainerRef} className="relative inline-block shadow-2xl rounded-lg overflow-hidden">
          <Document
            file={pdfDataUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(error) => {
              console.error('PDF load error:', error);
              toast.error('Failed to load PDF');
            }}
            loading={
              <div className="flex items-center gap-3 p-12 text-toolbar-foreground/50">
                <Loader2 className="h-6 w-6 animate-spin" />
                Loading PDF…
              </div>
            }
          >
            <Page
              key={`page_${currentPage}`}
              pageNumber={currentPage}
              scale={scale}
              renderTextLayer={true}
              renderAnnotationLayer={false}
              className="shadow-md"
              loading={
                <div className="flex items-center gap-3 p-12 text-toolbar-foreground/50">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Rendering page…
                </div>
              }
            />
          </Document>

          {/* Annotation overlay (always visible, pointer-events enabled to intercept pan drags) */}
          {!readonly && (
            <canvas
              ref={annotationCanvasRef}
              className="absolute inset-0 z-10"
              style={{ cursor: annotating ? (isErasing ? 'cell' : 'crosshair') : 'grab' }}
              onMouseDown={onPointerDown}
              onMouseMove={onPointerMove}
              onMouseUp={onPointerUp}
              onMouseLeave={onPointerUp}
              onTouchStart={onPointerDown}
              onTouchMove={onPointerMove}
              onTouchEnd={onPointerUp}
            />
          )}
        </div>
      </div>

      {/* Footer status bar */}
      <footer className="flex items-center justify-between px-4 py-1 bg-toolbar text-toolbar-foreground/60 text-xs">
        <span>{pdfFileName} {readonly && "(Read-Only History)"}</span>
        <span>{numPages ? `${numPages} page${numPages > 1 ? 's' : ''}` : ''}</span>
        <span>{Math.round(scale * 100)}% zoom</span>
      </footer>

      {historyModalJSX}
    </div>
  );
};

export default PDFMerged;
