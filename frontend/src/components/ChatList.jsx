import { formatDistanceToNowStrict } from "date-fns";
import { fr } from "date-fns/locale";
import { MessageCircle } from "lucide-react";
import Avatar from "./Avatar";
import { convDisplay } from "../utils/conversation";

function timeShort(d) {
  if (!d) return "";
  try {
    return formatDistanceToNowStrict(new Date(d), { addSuffix: false, locale: fr });
  } catch { return ""; }
}

function typingPreview(users = {}) {
  const names = Object.values(users);
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} est en train d'écrire...`;
  return `${names.length} personnes écrivent...`;
}

export default function ChatList({
  conversations,
  currentUser,
  activeId,
  onSelect,
  onlineUsers,
  typingByConversation = {},
}) {
  if (!conversations.length) {
    return (
      <div className="m-4 p-8 text-center text-ink-500 text-sm rounded-2xl border border-dashed border-ink-200 bg-ink-50">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center">
          <MessageCircle className="w-6 h-6" />
        </div>
        Aucune discussion pour le moment.
      </div>
    );
  }
  return (
    <ul className="px-2 pb-3 space-y-1">
      {conversations.map((c) => {
        const d = convDisplay(c, currentUser);
        const isActive = c.id === activeId;
        const isOnline =
          c.type === "private" &&
          d.peer &&
          (onlineUsers[d.peer.id] === "online" || d.peer.is_online || d.peer.status === "online");
        const typingText = typingPreview(typingByConversation[c.id]);

        const last = c.last_message;
        const lastPreview = last
          ? last.type === "text"
            ? last.content
            : last.type === "image" ? "📷 Photo"
            : last.type === "video" ? "🎥 Vidéo"
            : last.type === "audio" ? "🎙 Audio"
            : last.type === "file"  ? "📎 Fichier"
            : last.type === "call"  ? "📞 Appel"
            : last.content
          : "Démarrez la conversation";

        return (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c)}
              className={`group relative w-full flex items-center gap-3 px-3 py-3 text-left transition rounded-2xl
                ${isActive ? "bg-brand-50 shadow-bubble ring-1 ring-brand-100" : "hover:bg-ink-100/70"}`}
            >
              {isActive && <span className="absolute left-0 top-4 bottom-4 w-1 rounded-full bg-brand-600" />}
              <Avatar
                user={{ display_name: d.name, avatar_url: d.avatar_url, username: d.name }}
                size={48}
                online={isOnline}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <div className={`truncate font-semibold ${isActive ? "text-brand-900" : "text-ink-900"}`}>
                    {d.name}
                  </div>
                  <div className="text-[11px] text-ink-500 flex-none">
                    {timeShort(last?.created_at || c.updated_at)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className={`truncate text-sm ${typingText ? "text-brand-700 font-semibold" : c.unread_count > 0 ? "text-ink-800 font-medium" : "text-ink-500"}`}>
                    {typingText || lastPreview}
                  </div>
                  {c.unread_count > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5
                                     text-xs font-semibold rounded-full bg-brand-600 text-white shadow-bubble">
                      {c.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
