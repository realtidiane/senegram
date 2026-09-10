import { format, formatDistanceToNowStrict, isYesterday } from "date-fns";
import { fr } from "date-fns/locale";

export function lastSeenText(date) {
  if (!date) return "Hors ligne";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "Hors ligne";
  if (isYesterday(d)) return `Vu hier à ${format(d, "HH:mm", { locale: fr })}`;
  return `Vu il y a ${formatDistanceToNowStrict(d, { locale: fr })}`;
}

/** Renvoie le titre + avatar d'une conversation vue par `currentUser`. */
export function convDisplay(conv, currentUser) {
  if (!conv) return { name: "", avatar_url: null, peer: null };
  if (conv.type === "group") {
    return {
      name: conv.name || "Groupe",
      avatar_url: conv.avatar_url,
      peer: null,
      subtitle: `${conv.members?.length || 0} membres`,
    };
  }
  const other = (conv.members || []).find((m) => m.id !== currentUser?.id);
  return {
    name: other?.alias || other?.display_name || other?.username || "Conversation",
    avatar_url: other?.avatar_url,
    peer: other,
    subtitle: other?.is_online || other?.status === "online" ? "En ligne" : lastSeenText(other?.last_seen),
  };
}
