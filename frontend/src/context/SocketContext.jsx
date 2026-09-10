import { createContext, useEffect, useState } from "react";
import { connectSocket, disconnectSocket } from "../services/socket";
import { useAuth } from "./AuthContext";

export const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, user, loading } = useAuth();
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState({});

  useEffect(() => {
    if (loading) return;
    if (!token || !user) {
      if (socket) {
        disconnectSocket();
        setSocket(null);
      }
      return;
    }
    const s = connectSocket(token);
    setSocket(s);

    s.on("connect", () => console.log("🟢 socket connected", s.id, s.io.engine.transport.name));
    s.on("disconnect", (reason) => console.log("🔴 socket disconnected", reason));
    s.on("connect_error", (err) => console.warn("🟠 socket connect error", err.message));

    const onPresence = ({ user_id, status }) => {
      setOnlineUsers((prev) => ({ ...prev, [user_id]: status }));
    };

    s.on("presence:update", onPresence);
    s.on("user_online", onPresence);
    s.on("user_offline", onPresence);

    return () => {
      s.off("presence:update", onPresence);
      s.off("user_online", onPresence);
      s.off("user_offline", onPresence);
      s.off("connect");
      s.off("disconnect");
      s.off("connect_error");
      disconnectSocket();
      setSocket(null);
    };
  }, [token, user, loading]);

  return (
    <SocketContext.Provider value={{ socket, onlineUsers }}>
      {children}
    </SocketContext.Provider>
  );
}
