import React, { useState, useEffect, useRef, useCallback, useContext } from "react";
import { MessageSquare, X, Send, Mic, MicOff, Bell, GripHorizontal } from "lucide-react";
import { toast } from "sonner";
import { AuthContext } from "@/App";
import { computePanelStyle as computePanelStyle_ } from "@/lib/panelPosition";

export const AssistantWidget = () => {
  const token = useContext(AuthContext);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { text: "Hello! I am Chanakya, your AI assistant. How can I help you?", sender: "bot" }
  ]);
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [alarms, setAlarms] = useState([]);
  const [triggeredAlarms, setTriggeredAlarms] = useState(new Set());
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);

  // ── Drag state ─────────────────────────────────────────────────────────────
  // We track position as distance from RIGHT and BOTTOM edges of the viewport.
  // This keeps the button anchored at its visual position regardless of panel open/close.
  const btnRef = useRef(null);
  const [btnPos, setBtnPos] = useState({ right: 24, bottom: 96 }); // default: above toolbar
  const dragState = useRef({ dragging: false, startClientX: 0, startClientY: 0, startRight: 0, startBottom: 0 });

  const onBtnPointerDown = useCallback((e) => {
    // Allow the drag to start anywhere on the button wrapper div (not the inner <button>)
    dragState.current = {
      dragging: true,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRight: btnPos.right,
      startBottom: btnPos.bottom,
    };
    btnRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [btnPos]);

  const onBtnPointerMove = useCallback((e) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startClientX;
    const dy = e.clientY - dragState.current.startClientY;
    // Moving right decreases right, moving down decreases bottom
    const newRight = Math.max(8, Math.min(window.innerWidth - 64, dragState.current.startRight - dx));
    const newBottom = Math.max(8, Math.min(window.innerHeight - 64, dragState.current.startBottom - dy));
    setBtnPos({ right: newRight, bottom: newBottom });
  }, []);

  const onBtnPointerUp = useCallback((e) => {
    if (!dragState.current.dragging) return;
    const dx = Math.abs(e.clientX - dragState.current.startClientX);
    const dy = Math.abs(e.clientY - dragState.current.startClientY);
    dragState.current.dragging = false;
    // Only toggle open if it was a click (barely moved)
    if (dx < 5 && dy < 5) setIsOpen(v => !v);
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        sendMessage(transcript);
      };
      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setAlarms(prevAlarms => {
        const remaining = [];
        for (const alarm of prevAlarms) {
          if (alarm.triggerTime <= now) {
            if (!triggeredAlarms.has(alarm.id)) {
              setTriggeredAlarms(prev => { const next = new Set(prev); next.add(alarm.id); return next; });
              setTimeout(() => {
                toast.info(`⏰ Reminder: ${alarm.message}`, { duration: 10000 });
                speak(`Reminder: ${alarm.message}`);
              }, 0);
            }
          } else { remaining.push(alarm); }
        }
        return remaining;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [triggeredAlarms]);

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };

  const toggleListen = () => {
    if (!recognitionRef.current) { toast.error("Speech recognition not supported in this browser."); return; }
    if (isListening) { recognitionRef.current.stop(); setIsListening(false); }
    else { recognitionRef.current.start(); setIsListening(true); }
  };

  const sendMessage = async (text = input) => {
    if (!text.trim()) return;
    setMessages(prev => [...prev, { text, sender: "user" }]);
    setInput("");
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
      const currentTime = new Date().toLocaleString("en-US", {
        hour: "numeric", minute: "numeric", hour12: true,
        weekday: "long", day: "numeric", month: "long", year: "numeric", timeZoneName: "short"
      });
      const res = await fetch(`${backendUrl}/api/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ text, currentTime })
      });
      const data = await res.json();
      if (data.action?.type === "open_url") window.open(data.action.url, "_blank");
      setMessages(prev => [...prev, { text: data.response, sender: "bot", hotels: data.hotels }]);
      speak(data.response);
      if (data.alarms?.length > 0) {
        const newAlarms = data.alarms.map(a => ({ id: Math.random().toString(36).substr(2, 9), message: a.message, triggerTime: Date.now() + a.seconds * 1000 }));
        setAlarms(prev => [...prev, ...newAlarms]);
        toast.success(`Set reminder for ${data.alarms[0].seconds} seconds from now`);
      }
    } catch {
      setMessages(prev => [...prev, { text: "Sorry, I couldn't connect to the server.", sender: "bot" }]);
    }
  };

  // Position the panel relative to the button. See lib/panelPosition for the
  // geometry (extracted so it can be unit-tested without the DOM).
  const computePanelStyle = () => computePanelStyle_(btnPos, window.innerWidth, window.innerHeight);

  return (
    <>
      {/* ── Chat Panel — smart-positioned relative to button ── */}
      {isOpen && (
        <div style={computePanelStyle()} className="glass-panel-strong animate-glass-in rounded-2xl overflow-hidden">

          {/* Header */}
          <div className="bg-gradient-to-r from-primary to-[hsl(var(--glow-violet))] p-4 flex justify-between items-center flex-shrink-0">
            <div className="flex items-center gap-2">
              <GripHorizontal className="w-4 h-4 text-white/60" />
              <div>
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" /> Chanakya
                </h3>
                <p className="text-white/80 text-xs">AI Assistant</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white transition-all duration-150 hover:scale-110">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Alarm badge */}
          {alarms.length > 0 && (
            <div className="flex-shrink-0 mx-3 mt-2 bg-yellow-500 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1 shadow-[0_2px_10px_rgba(234,179,8,0.4)]">
              <Bell size={12} /> {alarms.length} Active Reminder{alarms.length > 1 ? "s" : ""}
            </div>
          )}

          {/* Messages — scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex flex-col animate-glass-in ${msg.sender === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                  msg.sender === "user"
                    ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-br-sm shadow-[0_4px_14px_hsl(var(--primary)/0.3)]"
                    : "glass-card text-foreground rounded-bl-sm"
                }`}>{msg.text}</div>
                {msg.hotels?.length > 0 && (
                  <div className="mt-2 w-[85%] space-y-2">
                    {msg.hotels.map((h, i) => (
                      <div key={i} className="glass-card p-2 rounded-lg text-xs">
                        <p className="font-bold">{h.name}</p>
                        <div className="flex justify-between text-muted-foreground mt-1">
                          <span>{h.price}</span><span>⭐ {h.rating}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-toolbar-foreground/10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                type="text" value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
                placeholder="Ask Chanakya..."
                className="flex-1 bg-toolbar-hover/60 text-foreground text-sm rounded-full px-4 py-2 outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-150"
              />
              <button onClick={toggleListen}
                className={`p-2 rounded-full transition-all duration-150 hover:scale-105 ${isListening ? "bg-red-500 text-white animate-pulse" : "bg-toolbar-hover/60 text-foreground hover:bg-toolbar-hover"}`}
                title="Voice Input">
                {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
              <button onClick={() => sendMessage()} className="p-2 bg-gradient-to-br from-primary to-[hsl(var(--glow-violet))] text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-150 shadow-[0_4px_14px_hsl(var(--primary)/0.35)]">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Draggable Floating Button ── */}
      <div
        ref={btnRef}
        style={{ position: "fixed", right: btnPos.right, bottom: btnPos.bottom, zIndex: 51 }}
        className="cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onBtnPointerDown}
        onPointerMove={onBtnPointerMove}
        onPointerUp={onBtnPointerUp}
        title={isOpen ? "Close · drag to move" : "Open Chanakya AI · drag to move"}
      >
        <div className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 bg-gradient-to-br ${isOpen ? "from-primary/80 to-[hsl(var(--glow-violet))]/80" : "from-primary to-[hsl(var(--glow-violet))]"} text-white shadow-[0_8px_24px_hsl(var(--primary)/0.4)]`}>
          {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        </div>
        {alarms.length > 0 && !isOpen && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-[0_2px_8px_rgba(234,179,8,0.6)]">
            {alarms.length}
          </div>
        )}
      </div>
    </>
  );
};


