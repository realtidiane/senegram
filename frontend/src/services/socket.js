import { io } from "socket.io-client";

let socket = null;
let disconnectTimer = null;
let socketToken = null;

function socketBaseUrl() {
  // En production, socket.io passe par Caddy (meme origine)
  // On calcule le base URL a partir de window.location
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin;
  }
  return "";
}

export function connectSocket(token) {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (socket && socketToken === token) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socketToken = token;
  const isProd = import.meta.env.PROD;
  socket = io(socketBaseUrl(), {
    path: "/socket.io/", // chemin gere par Caddy reverse_proxy
    auth: { token },
    transports: isProd ? ["polling"] : ["polling", "websocket"],
    reconnection: true,
    upgrade: false,
    withCredentials: true,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;

  const closeSocket = () => {
    if (!socket) return;
    socket.disconnect();
    socket = null;
    socketToken = null;
    disconnectTimer = null;
  };

  disconnectTimer = setTimeout(closeSocket, 500);
}
