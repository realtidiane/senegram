import { useEffect, useState } from "react";
import { fileUrl } from "../services/api";

/**
 * Avatar universel : image si dispo, sinon initiales colorées.
 */
export default function Avatar({ user, size = 40, online = false, className = "" }) {
  const src    = user?.avatar_url ? fileUrl(user.avatar_url) : null;
  const [failed, setFailed] = useState(false);
  const name   = user?.display_name || user?.name || user?.username || "?";
  const init   = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Couleur pseudo-aléatoire basée sur le username
  const colors = ["#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % colors.length;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden
                  flex-none text-white font-semibold ${className}`}
      style={{ width: size, height: size, background: colors[idx] }}
    >
      {src && !failed
        ? <img src={src} alt={name} className="w-full h-full object-cover" onError={() => setFailed(true)} />
        : <span style={{ fontSize: size * 0.4 }}>{init}</span>}
      {online && (
        <span className="presence-dot" style={{ width: size * 0.28, height: size * 0.28 }} />
      )}
    </div>
  );
}
