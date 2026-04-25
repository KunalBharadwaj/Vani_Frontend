import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";

// Global cache to prevent multiple WebSocket connections per room
const roomConnections = new Map();

export function useCollaboration(roomId, token) {
  const [ydoc, setYdoc] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const [roomState, setRoomState] = useState({ hostId: null, ownerId: null, users: [] });
  const wsRef = useRef(null);

  useEffect(() => {
    if (!roomId || !token) return;

    let connection = roomConnections.get(roomId);
    
    if (!connection) {
      const doc = new Y.Doc();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://vani-backend-mjsl.onrender.com';
      const wsUrl = backendUrl.replace('http', 'ws');
      const ws = new WebSocket(`${wsUrl}/?token=${token}`);
      ws.binaryType = "arraybuffer";
      
      connection = {
        doc,
        ws,
        status: "disconnected",
        roomState: { hostId: null, ownerId: null, users: [] },
        refs: 0,
        listeners: new Set()
      };
      roomConnections.set(roomId, connection);

      ws.onopen = () => {
        connection.status = "connected";
        connection.listeners.forEach(l => l("connected", connection.roomState));
        ws.send(JSON.stringify({ type: "join", roomId }));
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const raw = new Uint8Array(event.data);
          try {
            if (raw[0] === 0 || raw[0] === 2) {
              // Wrapped protocol: 0 = Normal Update, 2 = Sync Update Output
              Y.applyUpdate(doc, raw.slice(1), "remote");
            } else {
              // Fallback for un-wrapped legacy protocol
              Y.applyUpdate(doc, raw, "remote");
            }
          } catch(err) {
            console.error("Yjs update parsing error:", err);
          }
        } else if (typeof event.data === "string") {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "room:state") {
              connection.roomState = { hostId: data.hostId, ownerId: data.ownerId, users: data.users || [] };
              connection.listeners.forEach(l => l(connection.status, connection.roomState));
            }
          } catch (e) {
            console.error("Failed to parse websocket message", e);
          }
        }
      };

      ws.onclose = () => {
        if (connection.heartbeatInterval) clearInterval(connection.heartbeatInterval);
        connection.status = "disconnected";
        connection.roomState = { hostId: null, ownerId: null, users: [] };
        connection.listeners.forEach(l => l("disconnected", connection.roomState));
        roomConnections.delete(roomId);
      };

      const handleUpdate = (update, origin) => {
        if (origin !== "remote" && ws.readyState === WebSocket.OPEN) {
          const payload = new Uint8Array(update.length + 1);
          payload[0] = 0; // 0 = Normal Update
          payload.set(update, 1);
          ws.send(payload);
        }
      };
      
      // Heartbeat Sync Protocol - 10s interval
      // Requests minimal diffs strictly missing from local state vector
      connection.heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const sv = Y.encodeStateVector(doc);
          const payload = new Uint8Array(sv.length + 1);
          payload[0] = 1; // 1 = Sync Request Vector
          payload.set(sv, 1);
          ws.send(payload);
        }
      }, 10000);
      doc.on("update", handleUpdate);
    } // -- end of initialization --

    // Increment ref count
    connection.refs++;

    wsRef.current = connection.ws;
    setYdoc(connection.doc);
    setStatus(connection.status);
    setRoomState(connection.roomState);

    const statusListener = (newStatus, newState) => {
      setStatus(newStatus);
      if (newState) setRoomState(newState);
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
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
        }
    }
  };
}
