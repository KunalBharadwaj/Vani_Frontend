import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";

// Global cache to prevent multiple WebSocket connections per room
const roomConnections = new Map();

export function useCollaboration(roomId, token, onMessage = null) {
  const [ydoc, setYdoc] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const [roomState, setRoomState] = useState({ hostId: null, ownerId: null, users: [] });
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
     onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!roomId || !token) return;

    let connection = roomConnections.get(roomId);
    
    if (!connection) {
      const doc = new Y.Doc();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://vanibackend-production.up.railway.app';
      const wsUrl = backendUrl.replace('http', 'ws');
      
      connection = {
        doc,
        ws: null,
        status: "disconnected",
        roomState: { hostId: null, ownerId: null, users: [] },
        refs: 0,
        listeners: new Set(),
        reconnectAttempts: 0,
        heartbeatInterval: null,
      };
      roomConnections.set(roomId, connection);

      const connectWs = () => {
        // A-2: Do not send token in URL
        const ws = new WebSocket(`${wsUrl}`);
        ws.binaryType = "arraybuffer";
        connection.ws = ws;

        ws.onopen = () => {
          connection.reconnectAttempts = 0;
          // Send explicit auth payload first
          ws.send(JSON.stringify({ type: "auth", token }));
        };

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            const raw = new Uint8Array(event.data);
            try { Y.applyUpdate(doc, raw, "remote"); } catch(e) {}
          } else if (typeof event.data === "string") {
            try {
              const data = JSON.parse(event.data);
              if (data.type === "auth_success") {
                connection.status = "connected";
                connection.listeners.forEach(l => l("connected", connection.roomState));
                ws.send(JSON.stringify({ type: "join", roomId }));
              }
              else if (data.type === "room:state") {
                connection.roomState = { hostId: data.hostId, ownerId: data.ownerId, users: data.users || [] };
                connection.listeners.forEach(l => l(connection.status, connection.roomState, data));
              } else if (data.type === "sync_step_2") {
                const buffer = Uint8Array.from(atob(data.updateBase64), c => c.charCodeAt(0));
                Y.applyUpdate(doc, buffer, "remote");
              } else {
                // Pass arbitrary signals to listeners
                connection.listeners.forEach(l => l(connection.status, connection.roomState, data));
              }
            } catch (e) { console.error("Failed to parse websocket message", e); }
          }
        };

        ws.onclose = () => {
          if (connection.heartbeatInterval) clearInterval(connection.heartbeatInterval);
          if (connection.refs > 0) {
            // B-1: Exponential backoff reconnect
            connection.status = "reconnecting";
            connection.listeners.forEach(l => l("reconnecting", connection.roomState));
            const delay = Math.min(1000 * Math.pow(1.5, connection.reconnectAttempts), 10000);
            connection.reconnectAttempts++;
            setTimeout(connectWs, delay);
          } else {
            connection.status = "disconnected";
            connection.listeners.forEach(l => l("disconnected", connection.roomState));
            roomConnections.delete(roomId);
          }
        };

        const handleUpdate = (update, origin) => {
          if (origin !== "remote" && ws.readyState === WebSocket.OPEN) {
            ws.send(update);
          }
        };
        doc.on("update", handleUpdate);

        connection.heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && connection.status === "connected") {
            const sv = Y.encodeStateVector(doc);
            let binary = '';
            for (let i = 0; i < sv.length; i++) binary += String.fromCharCode(sv[i]);
            ws.send(JSON.stringify({ type: "sync_step_1", svBase64: btoa(binary) }));
          }
        }, 10000);
      };

      connectWs();
    } // -- end of initialization --

    // Increment ref count
    connection.refs++;

    wsRef.current = connection;
    setYdoc(connection.doc);
    setStatus(connection.status);
    setRoomState(connection.roomState);

    const statusListener = (newStatus, newState, data) => {
      setStatus(newStatus);
      if (newState) setRoomState(newState);
      if (data && onMessageRef.current) {
          onMessageRef.current(data);
      }
    };
    connection.listeners.add(statusListener);

    return () => {
      connection.listeners.delete(statusListener);
      connection.refs--;
      if (connection.refs <= 0) {
        connection.ws.close();
        connection.doc.destroy();
        roomConnections.delete(roomId);
      }
    };
  }, [roomId, token]);

  return { 
    provider: null, 
    ydoc, 
    pagesMap: ydoc ? ydoc.getMap("pages") : null, 
    pdfMap: ydoc ? ydoc.getMap("pdf") : null,
    isSynced: status === "connected", 
    status,
    roomState,
    sendWsMessage: (msg) => {
        if (wsRef.current && wsRef.current.ws && wsRef.current.ws.readyState === WebSocket.OPEN) {
            wsRef.current.ws.send(JSON.stringify(msg));
        }
    }
  };
}
