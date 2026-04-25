// PDF Viewer with collaborative sharing via Yjs.
// When a user uploads a PDF, the file data is stored in a shared Yjs map
// so all room members instantly see and can navigate the same document.
import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
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
  Eraser,
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
  const readonly = searchParams.get('readonly') === 'true';
  const token = localStorage.getItem('auth_token');

  // Stable room ID mapped directly from URL
  const roomId = searchParams.get('room');

  const [showHistory, setShowHistory] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [historyDocs, setHistoryDocs] = useState([]);

  // Generate a room if none exists, but only if we are actively viewing the PDF section
  useEffect(() => {
    if (!roomId && window.location.pathname === '/pdf') {
      const newRoom = Math.random().toString(36).substring(2, 8);
      searchParams.set('room', newRoom);
      setSearchParams(searchParams, { replace: true });
    }
  }, [roomId, searchParams, setSearchParams]);

  const { pdfMap, status, roomState, sendWsMessage } = useCollaboration(roomId, token);

  const userId = token ? (function(){ try { return JSON.parse(atob(token.split('.')[1]))?.id } catch(e) { return null; } })() : null;
  const isOwner = roomState?.ownerId === userId;
  const isOwnerRef = useRef(isOwner);
  useEffect(() => { isOwnerRef.current = isOwner; }, [isOwner]);
  const isHost = roomState?.hostId === userId;
  const lastScrollBroadcastRef = useRef(0);

  // PDF state
  const [pdfDataUrl, setPdfDataUrl] = useState(null);
  const pdfDataUrlRef = useRef(null); // Always-fresh ref for use in Yjs observer (avoids stale closures)
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
  const canvasRefs = useRef({});
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const activeCanvasPageRef = useRef(1);
  const annotationHistoryRef = useRef([]);   // stack of {page, data} for undo
  const redoHistoryRef = useRef([]);         // stack of {page, data} for redo
  const pageContainerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, sL: 0, sT: 0 });
  const [containerWidth, setContainerWidth] = useState(null);

  const fileInputRef = useRef(null);
  const isSyncingRef = useRef(false);  // prevent echo loops
  const lastRemoteCanvasOverlayRef = useRef({});

  // Measure the scroll container width so PDF pages can fit responsively
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        // Subtract padding (p-6 = 24px each side = 48px total)
        setContainerWidth(Math.floor(entry.contentRect.width) - 48);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Block all scroll input (wheel, touch, scrollbar drag) for non-owners
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const blockScroll = (e) => {
      if (!isOwnerRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // passive: false is required to allow preventDefault on wheel/touch events
    el.addEventListener('wheel', blockScroll, { passive: false });
    el.addEventListener('touchmove', blockScroll, { passive: false });
    return () => {
      el.removeEventListener('wheel', blockScroll);
      el.removeEventListener('touchmove', blockScroll);
    };
  }, []);

  // ─── Yjs observation: react to remote changes ───────────────────
  useEffect(() => {
    if (!pdfMap) return;

    // Initial load from Yjs state (e.g. late joiner)
    const existingPdf = pdfMap.get('pdfData');
    const existingName = pdfMap.get('fileName');
    const existingPage = pdfMap.get('currentPage') || 1;
    if (existingPage !== currentPageRef.current) setCurrentPage(existingPage);

    if (existingPdf && !pdfDataUrlRef.current) {
      setPdfDataUrl(existingPdf);
      pdfDataUrlRef.current = existingPdf;
      if (existingName) setPdfFileName(existingName);
    }
    
    const applyRemoteCanvas = (c, remoteCanvas) => {
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
    
    // We rely on the observer firing for the initial canvas paints

    const observer = (event) => {
      if (isSyncingRef.current) return;

      const remotePdf = pdfMap.get('pdfData');
      const remoteName = pdfMap.get('fileName');

      if (remotePdf && remotePdf !== pdfDataUrlRef.current) {
        setPdfDataUrl(remotePdf);
        pdfDataUrlRef.current = remotePdf;
      }
      if (remoteName) {
        setPdfFileName(remoteName);
      }
      
      // We expect numPages to be rendered and sized soon
      // For any canvas changes available from Yjs:
      for (let i = 1; i <= 50; i++) { // arbitrary upper reasonable limit to sync safely
          const rc = pdfMap.get(`canvasOverlay_${i}`);
          if (rc !== undefined && rc !== lastRemoteCanvasOverlayRef.current[i]) {
              lastRemoteCanvasOverlayRef.current[i] = rc;
              const c = canvasRefs.current[i];
              if (c) {
                  applyRemoteCanvas(c, rc);
              } else {
                  // Canvas might not be mounted yet; queue it or let subsequent renders pick it up
                  setTimeout(() => {
                      if (canvasRefs.current[i]) applyRemoteCanvas(canvasRefs.current[i], rc);
                  }, 100);
              }
          }
      }

      // Detect explicit remote PDF removal: only clear if the 'pdfData' key
      // was actually deleted in THIS transaction (not just missing on first load).
      if (event && event.keysChanged && event.keysChanged.has('pdfData') && !remotePdf) {
        setPdfDataUrl(null);
        setNumPages(null);
        setPdfFileName('');
      }

      // Sync scroll for non-owners (overflow is hidden, but direct assignment still works)
      if (!isOwnerRef.current && scrollContainerRef.current) {
          const remoteTop = pdfMap.get('scrollTop');
          const remoteLeft = pdfMap.get('scrollLeft');
          if (remoteTop !== undefined) {
              scrollContainerRef.current.scrollTop = remoteTop;
              scrollContainerRef.current.scrollLeft = remoteLeft || 0;
          }
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
    if (!isOwnerRef.current) {
       toast.error("Only the owner can scroll or change pages");
       return;
    }
    setCurrentPage(prev => {
      const newPage = Math.max(1, Math.min(prev + offset, numPages || 1));
      if (newPage !== prev) {
        if (pdfMap) {
          isSyncingRef.current = true;
          pdfMap.set('currentPage', newPage);
          isSyncingRef.current = false;
        }
        // Native scrolling has eliminated the need to swap static overlays here. 
        // Canvases are now persisted on the DOM alongside their respective pages.
      }
      return newPage;
    });
  }, [numPages, pdfMap]);

  const prevPage = () => changePage(-1);
  const nextPage = () => changePage(1);

  // ─── Zoom ──────────────────────────────────────────────────────
  const zoomIn = () => {
      if (!isOwnerRef.current) return toast.error("Only the owner can zoom");
      setScale((s) => Math.min(s + 0.25, 3));
  };
  const zoomOut = () => {
      if (!isOwnerRef.current) return toast.error("Only the owner can zoom");
      setScale((s) => Math.max(s - 0.25, 0.5));
  };

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
  const saveAnnotationSnapshot = (page) => {
    const c = canvasRefs.current[page];
    if (!c) return;
    annotationHistoryRef.current.push({ page, data: c.toDataURL() });
    redoHistoryRef.current = []; // Clear redo stack eagerly
  };

  const undoAnnotation = () => {
    if (annotationHistoryRef.current.length === 0) return;
    const { page, data } = annotationHistoryRef.current.pop();
    const c = canvasRefs.current[page];
    if (!c) return;
    
    // Save current canvas to redo stack BEFORE reverting
    redoHistoryRef.current.push({ page, data: c.toDataURL() });
    
    const targetDataUrl = data;
    const ctx = c.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      if (pdfMap) {
          isSyncingRef.current = true;
          pdfMap.set(`canvasOverlay_${page}`, c.toDataURL());
          isSyncingRef.current = false;
      }
    };
    img.src = targetDataUrl;
  };

  const redoAnnotation = () => {
    if (redoHistoryRef.current.length === 0) return;
    const { page, data } = redoHistoryRef.current.pop();
    const c = canvasRefs.current[page];
    if (!c) return;

    // Push current canvas to undo stack
    annotationHistoryRef.current.push({ page, data: c.toDataURL() });

    const targetDataUrl = data;
    const ctx = c.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      if (pdfMap) {
          isSyncingRef.current = true;
          pdfMap.set(`canvasOverlay_${page}`, c.toDataURL());
          isSyncingRef.current = false;
      }
    };
    img.src = targetDataUrl;
  };

  const clearAnnotations = () => {
    for (let i = 1; i <= (numPages || 1); i++) {
        const c = canvasRefs.current[i];
        if (c) {
            saveAnnotationSnapshot(i); // Allow undoing the clear for each page
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, c.width, c.height);
            if (pdfMap) {
                isSyncingRef.current = true;
                pdfMap.delete(`canvasOverlay_${i}`);
                isSyncingRef.current = false;
            }
        }
    }
  };

  // Resize annotation canvas to match the rendered PDF page
  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      window.requestAnimationFrame(() => {
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
          const wrap = entry.target;
          const c = wrap.querySelector('canvas');
          if (!c) continue;
          const rect = entry.contentRect;
          // only resize if significant change (avoiding subpixel loop issues)
          if (Math.abs(c.width - rect.width) > 2 || Math.abs(c.height - rect.height) > 2) {
            if (c.width > 0 && c.height > 0) {
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
        }
      });
    });

    // Observe all canvases' parent elements to size precisely over the actual PDF document page
    const timer = setTimeout(() => {
        Object.values(canvasRefs.current).forEach(c => {
            if (c && c.parentElement) {
                resizeObserver.observe(c.parentElement);
            }
        });
    }, 500);

    return () => {
        clearTimeout(timer);
        resizeObserver.disconnect();
    };
  }, [numPages]);

  // ─── Annotation pointer handlers ─────────────────────────────
  const getCanvasPos = (e, c) => {
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (e) => {
    if (!annotating) return; // Native scroll handles non-annotation interaction
    const targetCanvas = e.target;
    if (targetCanvas.tagName !== 'CANVAS') return;
    e.preventDefault();
    isDrawingRef.current = true;
    lastPointRef.current = getCanvasPos(e, targetCanvas);
    const pageNum = Number(targetCanvas.dataset.page);
    activeCanvasPageRef.current = pageNum;
    saveAnnotationSnapshot(pageNum);
  };

  const onPointerMove = (e) => {
    if (!annotating || !isDrawingRef.current) return;
    e.preventDefault();
    const c = canvasRefs.current[activeCanvasPageRef.current];
    if (!c) return;
    const pos = getCanvasPos(e, c);
    const last = lastPointRef.current;
    if (!pos || !last) return;

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
        const c = canvasRefs.current[activeCanvasPageRef.current];
        if (pdfMap && c) {
            isSyncingRef.current = true;
            pdfMap.set(`canvasOverlay_${activeCanvasPageRef.current}`, c.toDataURL());
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
      if (!isOwnerRef.current) return; // Only owner can navigate with keyboard
      if (e.key === '+' || e.key === '=') zoomIn();
      if (e.key === '-') zoomOut();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevPage();
      if (e.key === 'ArrowRight' || e.key === 'PageDown') nextPage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pdfDataUrl, isOwner]);

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

  const dashboardModalJSX = showDashboard && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b dark:border-zinc-800">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="w-5 h-5"/> Room Dashboard</h2>
          <button onClick={() => setShowDashboard(false)} className="p-1 hover:bg-black/5 rounded text-toolbar-foreground/60 hover:text-red-500"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
           {roomState?.users?.map(u => (
              <div key={u.id} className="flex items-center justify-between p-3 border dark:border-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-sm transition-colors">
                <div className="flex items-center gap-3">
                   <img src={u.picture || 'https://www.gravatar.com/avatar/?d=mp'} className="w-8 h-8 rounded-full shadow-sm" />
                   <div>
                     <span className="block font-medium truncate max-w-[150px]" title={u.name}>{u.name}</span>
                     <div className="flex gap-1 mt-0.5">
                       {roomState?.hostId === u.id && <span className="text-[10px] bg-yellow-500/20 text-yellow-600 px-1.5 py-0.5 rounded border border-yellow-500/30">Host</span>}
                       {roomState?.ownerId === u.id && <span className="text-[10px] bg-green-500/20 text-green-600 px-1.5 py-0.5 rounded border border-green-500/30">Owner</span>}
                       {roomState?.hostId !== u.id && roomState?.ownerId !== u.id && <span className="text-[10px] bg-gray-500/20 text-gray-500 px-1.5 py-0.5 rounded border border-gray-500/30">Participant</span>}
                     </div>
                   </div>
                </div>
                {isHost && roomState?.ownerId !== u.id && (
                    <button onClick={() => sendWsMessage({ type: "assign_owner", targetUserId: u.id })} className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded transition-colors shadow-sm">Make Owner</button>
                )}
              </div>
           ))}
           {(!roomState?.users || roomState.users.length === 0) && (
              <div className="text-center text-sm text-toolbar-foreground/40 py-8">No members connected</div>
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
            <button
              onClick={() => setShowDashboard(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-toolbar-foreground/60 hover:bg-toolbar-foreground/10 transition-colors"
            >
              <Users className="h-3.5 w-3.5" />
              Dashboard
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
            onClick={() => {
               if (isOwner) fileInputRef.current?.click();
               else toast.error("Only the room owner can upload a PDF.");
            }}
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
              onClick={() => {
                 if (isOwner) fileInputRef.current?.click();
                 else toast.error("Only the room owner can upload.");
              }}
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

          {/* Dashboard button */}
          <button
            onClick={() => setShowDashboard(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-toolbar-foreground/60 hover:bg-toolbar-foreground/10 transition-colors"
          >
            <Users className="h-3.5 w-3.5" />
            Dashboard
          </button>

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
        className={`flex-1 min-h-0 bg-workspace p-6 ${isOwner ? 'overflow-auto' : 'overflow-hidden'}`}
        onScroll={(e) => {
           if (isOwnerRef.current && pdfMap && !isPanningRef.current) {
               const now = Date.now();
               if (now - lastScrollBroadcastRef.current > 50) {
                   lastScrollBroadcastRef.current = now;
                   isSyncingRef.current = true;
                   pdfMap.set("scrollTop", e.target.scrollTop);
                   pdfMap.set("scrollLeft", e.target.scrollLeft);
                   isSyncingRef.current = false;
               }
           }
        }}
        style={{ overscrollBehavior: 'contain' }}
      >
        <div ref={pageContainerRef} className="flex flex-col items-center gap-4">
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
            {Array.from(new Array(numPages || 1), (el, index) => (
              <div key={`page_${index + 1}`} className="relative shadow-2xl rounded-lg mb-4">
                <Page
                  pageNumber={index + 1}
                  scale={scale}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={
                    <div className="flex items-center justify-center p-12 text-toolbar-foreground/50">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  }
                />
                {!readonly && (
                  <canvas
                    ref={(c) => {
                       if (c) {
                         canvasRefs.current[index + 1] = c;
                         // Size canvas drawing surface to match display size
                         requestAnimationFrame(() => {
                           const parent = c.parentElement;
                           if (parent) {
                             const w = parent.offsetWidth;
                             const h = parent.offsetHeight;
                             if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) {
                               c.width = w;
                               c.height = h;
                             }
                           }
                         });
                       }
                    }}
                    data-page={index + 1}
                    className="absolute inset-0 z-10"
                    style={{
                      width: '100%',
                      height: '100%',
                      cursor: annotating ? (isErasing ? 'cell' : 'crosshair') : 'default',
                      pointerEvents: annotating ? 'auto' : 'none',
                    }}
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
            ))}
          </Document>
        </div>
      </div>

      {/* Footer status bar */}
      <footer className="flex items-center justify-between px-4 py-1 bg-toolbar text-toolbar-foreground/60 text-xs">
        <span>{pdfFileName} {readonly && "(Read-Only History)"}</span>
        <span>{numPages ? `${numPages} page${numPages > 1 ? 's' : ''}` : ''}</span>
        <span>{Math.round(scale * 100)}% zoom</span>
      </footer>

      {historyModalJSX}
      {dashboardModalJSX}
    </div>
  );
};

export default PDFMerged;
