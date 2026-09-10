import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { useSocket } from "./useSocket";
import api from "../services/api";

const PushContext = createContext(null);

export function PushProvider({ children }) {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState(import.meta.env.VITE_VAPID_PUBLIC_KEY || "");

  const pushSupported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  // Convert base64 string to Uint8Array for push subscription
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  // Register service worker
  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      console.log("[Push] SW registered:", reg.scope);
      reg.update?.();
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }).catch((err) => {
      console.error("[Push] SW registration failed:", err);
    });
  }, [pushSupported]);

  useEffect(() => {
    if (publicKey) return;
    api.get("/push/public-key")
      .then(({ data }) => {
        if (data.publicKey) setPublicKey(data.publicKey);
      })
      .catch((err) => {
        console.warn("[Push] VAPID public key unavailable:", err.response?.data?.message || err.message);
      });
  }, [publicKey]);

  // Update permission state
  useEffect(() => {
    if (!pushSupported) return;
    setPermission(Notification.permission);
  }, [pushSupported]);

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!pushSupported) {
      console.warn("[Push] Push notifications not supported by this browser");
      return;
    }
    if (!user || !token) return;
    if (!publicKey) {
      console.warn("[Push] VAPID public key not configured");
      return;
    }
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      console.log("[Push] Permission requested:", perm);
      if (perm !== "granted") return;
    }

    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      console.log("[Push] SW ready:", reg.scope);
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        console.log("[Push] Existing subscription found:", existingSub.endpoint);
        setSubscription(existingSub);
        await sendSubscriptionToServer(existingSub);
        return;
      }

      console.log("[Push] Creating new subscription...");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      console.log("[Push] New subscription created:", sub.endpoint);
      setSubscription(sub);
      await sendSubscriptionToServer(sub);
    } catch (err) {
      console.error("[Push] Subscribe failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user, token, publicKey, pushSupported]);

  useEffect(() => {
    if (!user || !token || !publicKey || permission === "denied") return;
    subscribe();
  }, [user, token, publicKey, permission, subscribe]);

  // Send subscription to backend
  async function sendSubscriptionToServer(sub) {
    try {
      await api.post("/push/subscribe", {
        endpoint: sub.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(sub.getKey("p256dh")),
          auth: arrayBufferToBase64(sub.getKey("auth")),
        },
      });
    } catch (err) {
      console.error("[Push] Failed to send subscription to server:", err);
    }
  }

  // Unsubscribe
  const unsubscribe = useCallback(async () => {
    if (!subscription) return;
    try {
      await subscription.unsubscribe();
      await api.post("/push/unsubscribe", { endpoint: subscription.endpoint });
      setSubscription(null);
    } catch (err) {
      console.error("[Push] Unsubscribe failed:", err);
    }
  }, [subscription]);

  // Listen for socket events to trigger local notifications (when app is open)
  useEffect(() => {
    if (!socket) return;
    
    const onMessage = (data) => {
      // Only show notification if document is not focused
      if (document.visibilityState === "visible") return;
      
      const message = data?.message || data;
      const conversation_id = data?.conversation_id || message?.conversation_id;
      const from = data?.from || {
        display_name: message?.sender_name,
        username: message?.sender_username,
      };
      if (message?.sender_id === user?.id) return; // Don't notify for own messages
      
      if (pushSupported && Notification.permission === "granted") {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(from?.display_name || from?.username || "Senegram", {
            body: message?.content || "Nouveau message",
            icon: "/favicon.svg",
            badge: "/favicon.svg",
            tag: `msg-${conversation_id}`,
            data: { url: `/conversation/${conversation_id}`, conversation_id },
            requireInteraction: true,
          });
        });
      }
    };

    socket.on("message:new", onMessage);
    return () => socket.off("message:new", onMessage);
  }, [socket, user?.id, pushSupported]);

  // Handle notification click from service worker
  useEffect(() => {
    if (!pushSupported) return;
    const handleMessage = (event) => {
      if (event.data?.type === "NOTIFICATION_CLICK") {
        window.location.href = event.data.url;
      } else if (event.data?.type === "APP_CACHE_RESET") {
        const key = "senegram_cache_reset_reloaded";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [pushSupported]);

  function arrayBufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }

  return (
    <PushContext.Provider value={{ permission, subscription, loading, subscribe, unsubscribe, publicKey, pushSupported }}>
      {children}
    </PushContext.Provider>
  );
}

export function usePush() {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error("usePush must be used within PushProvider");
  return ctx;
}
