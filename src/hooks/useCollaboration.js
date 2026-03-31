import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";

// Global cache to prevent multiple WebSocket connections per room
const roomConnections = new Map();

export function useCollaboration(roomId, token) {
  const [ydoc, setYdoc] = useState(null);
  const [status, setStatus] = useState("disconnected");

  useEffect(() => {
    if (!roomId || !token) return;

    let connection = roomConnections.get(roomId);
    
    if (!connection) {
      const doc = new Y.Doc();
      const ws = new WebSocket(`ws://vani-backend-mjsl.onrender.com/?token=${token}`);
      ws.binaryType = "arraybuffer";
      
      connection = {
        doc,
        ws,
        status: "disconnected",
        refs: 0,
        listeners: new Set()
      };
      roomConnections.set(roomId, connection);

      ws.onopen = () => {
        connection.status = "connected";
        connection.listeners.forEach(l => l("connected"));
        ws.send(JSON.stringify({ type: "join", roomId }));
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const update = new Uint8Array(event.data);
          Y.applyUpdate(doc, update);
        }
      };

      ws.onclose = () => {
        connection.status = "disconnected";
        connection.listeners.forEach(l => l("disconnected"));
        roomConnections.delete(roomId);
      };

      const handleUpdate = (update, origin) => {
        if (origin !== "remote" && ws.readyState === WebSocket.OPEN) {
          ws.send(update);
        }
      };
      doc.on("update", handleUpdate);
    } // -- end of initialization --

    // Increment ref count
    connection.refs++;

    setYdoc(connection.doc);
    setStatus(connection.status);

    const statusListener = (newStatus) => setStatus(newStatus);
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
    status 
  };
}
