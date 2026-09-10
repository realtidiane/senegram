export async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

export async function notifyUser({ title, body, conversationId }) {
  if (!document.hidden) return;
  const allowed = await ensureNotificationPermission();
  if (!allowed) return;

  const notification = new Notification(title, {
    body,
    tag: conversationId ? `conversation:${conversationId}` : undefined,
  });
  notification.onclick = () => {
    window.focus();
    if (conversationId) {
      window.dispatchEvent(new CustomEvent("senegram:open-conversation", {
        detail: { conversationId },
      }));
    }
    notification.close();
  };
}
