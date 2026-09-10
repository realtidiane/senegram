import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Phone, Video, MoreVertical, ArrowLeft, Pin, MessageCircle, Search, X, ArrowDown } from "lucide-react";
import toast from "react-hot-toast";

import Avatar       from "./Avatar";
import ConversationInfoModal from "./ConversationInfoModal";
import MessageBubble from "./MessageBubble";
import MessageInput  from "./MessageInput";

import api, { fileUrl } from "../services/api";
import { useAuth }    from "../context/AuthContext";
import { useSocket }  from "../context/useSocket";
import { useCall }    from "../context/CallContext";
import { convDisplay } from "../utils/conversation";

function formatDateLabel(d) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (date.toDateString() === yesterday.toDateString()) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export default function ChatWindow({
  conversation,
  onBack,
  onUpdated,
  onConversationDeleted,
  onConversationUpdated,
}) {
  const { user } = useAuth();
  const { socket, onlineUsers } = useSocket();
  const { startCall } = useCall();

  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchFilter, setSearchFilter] = useState("all");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);

  const scrollerRef = useRef(null);
  const typingTimer = useRef(null);
  const typingStopTimers = useRef({});
  const pullStartRef = useRef(null);
  const hasLoadedInitial = useRef(false);
  const loadingRef = useRef(false);

  const d = useMemo(() => convDisplay(conversation, user), [conversation, user]);
  const isGroup = conversation?.type === "group";
  const isOnline =
    !isGroup && d.peer &&
    (onlineUsers[d.peer.id] === "online" || d.peer.is_online || d.peer.status === "online");
  const currentMember = conversation?.members?.find((m) => m.id === user.id);
  const canPin = isGroup && ["owner", "admin"].includes(currentMember?.role);
  const pinnedMessages = messages
    .filter((m) => m.is_pinned && !m.is_deleted)
    .sort((a, b) => new Date(b.pinned_at || 0) - new Date(a.pinned_at || 0));
  const typingText = useMemo(() => {
    const names = Object.values(typingUsers);
    if (!names.length) return null;
    if (!isGroup) return `${names[0]} est en train d'écrire...`;
    if (names.length === 1) return `${names[0]} est en train d'écrire...`;
    return `${names.length} personnes écrivent...`;
  }, [typingUsers, isGroup]);

  // Load messages with pagination
  const loadMessages = useCallback(async (conversationId, beforeId = null, prepend = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (prepend) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = { limit: 50 };
      if (beforeId) params.before_id = beforeId;
      const { data } = await api.get(`/messages/conversation/${conversationId}`, { params });
      const newMessages = data.messages || [];
      if (prepend) {
        setMessages((prev) => [...newMessages, ...prev]);
      } else {
        setMessages(newMessages);
        hasLoadedInitial.current = true;
      }
    } catch (err) {
      toast.error("Impossible de charger les messages");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!conversation) return;
    let live = true;
    loadMessages(conversation.id).then(() => {
      if (live) {
        api.post(`/conversations/${conversation.id}/read`).catch(() => {});
        setTypingUsers({});
        setSearchOpen(false);
        setSearchQ("");
        setSearchResults([]);
        setReplyTo(null);
      }
    });

    return () => {
      live = false;
      clearTimeout(typingTimer.current);
      Object.values(typingStopTimers.current).forEach((timer) => clearTimeout(timer));
      typingStopTimers.current = {};
    };
  }, [conversation?.id, loadMessages]);

  useEffect(() => {
    if (!conversation || !searchOpen) return;
    const q = searchQ.trim();
    if (!q && searchFilter === "all") {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      api.get(`/messages/conversation/${conversation.id}/search`, {
        params: { q, filter: searchFilter },
      })
        .then(({ data }) => {
          if (!cancelled) setSearchResults(data.messages || []);
        })
        .catch(() => {
          if (!cancelled) toast.error("Recherche impossible");
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversation?.id, searchOpen, searchQ, searchFilter]);

  // Socket listeners
  useEffect(() => {
    if (!socket || !conversation) return;
    socket.emit("conversation:join", { conversation_id: conversation.id });

    const onNew = (m) => {
      if (m.conversation_id !== conversation.id) return;
      setMessages((prev) => [...prev, m]);
      if (m.sender_id !== user.id) {
        socket.emit("message:read", {
          conversation_id: conversation.id,
          message_id: m.id,
        });
      }
    };
    const onEdited = (m) => {
      if (m.conversation_id !== conversation.id) return;
      setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
    };
    const onDeleted = ({ id, conversation_id }) => {
      if (conversation_id !== conversation.id) return;
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, is_deleted: 1, content: null } : x)));
      setReplyTo((current) => (current?.id === id ? null : current));
    };
    const setTypingState = ({ conversation_id, user_id, username, is_typing }) => {
      if (conversation_id !== conversation.id || user_id === user.id) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (is_typing) next[user_id] = username;
        else delete next[user_id];
        return next;
      });
      if (is_typing) {
        clearTimeout(typingStopTimers.current[user_id]);
        typingStopTimers.current[user_id] = setTimeout(() => {
          setTypingUsers((prev) => {
            const next = { ...prev };
            delete next[user_id];
            return next;
          });
          delete typingStopTimers.current[user_id];
        }, 3500);
      }
    };
    const onTypingStart = (payload) => setTypingState({ ...payload, is_typing: true });
    const onTypingStop = (payload) => setTypingState({ ...payload, is_typing: false });
    const onDelivered = ({ conversation_id, message_id, delivered_at }) => {
      if (conversation_id !== conversation.id) return;
      setMessages((prev) => prev.map((m) => (
        !message_id || m.id === message_id
          ? { ...m, delivered_at: m.delivered_at || delivered_at || new Date().toISOString() }
          : m
      )));
    };
    const onRead = ({ conversation_id, message_id, last_message_id, read_at }) => {
      if (conversation_id !== conversation.id) return;
      setMessages((prev) => prev.map((m) => {
        const affected = message_id ? m.id === message_id : m.id <= last_message_id;
        return affected ? { ...m, delivered_at: m.delivered_at || read_at, read_at: read_at || new Date().toISOString() } : m;
      }));
    };
    const onReaction = ({ message }) => {
      if (message?.conversation_id !== conversation.id) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };
    const onPinned = (message) => {
      if (message?.conversation_id !== conversation.id) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    };
    const onUnpinned = ({ id, conversation_id }) => {
      if (conversation_id !== conversation.id) return;
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_pinned: 0, pinned_by: null, pinned_at: null } : m)));
    };
    const onGroupUpdated = ({ conversation: next }) => {
      if (next?.id !== conversation.id) return;
      onConversationUpdated?.(next);
    };
    const onGroupDeleted = ({ conversation_id }) => {
      if (conversation_id !== conversation.id) return;
      onConversationDeleted?.(conversation_id);
    };

    socket.on("message:new",     onNew);
    socket.on("message:edited",  onEdited);
    socket.on("message:deleted", onDeleted);
    socket.on("typing",          setTypingState);
    socket.on("typing_start",    onTypingStart);
    socket.on("typing_stop",     onTypingStop);
    socket.on("message_delivered", onDelivered);
    socket.on("message_read", onRead);
    socket.on("message:read", onRead);
    socket.on("reaction_added", onReaction);
    socket.on("reaction_removed", onReaction);
    socket.on("reaction_updated", onReaction);
    socket.on("message_pinned", onPinned);
    socket.on("message_unpinned", onUnpinned);
    socket.on("group:updated", onGroupUpdated);
    socket.on("group:deleted", onGroupDeleted);

    return () => {
      socket.off("message:new", onNew);
      socket.off("message:edited", onEdited);
      socket.off("message:deleted", onDeleted);
      socket.off("typing", setTypingState);
      socket.off("typing_start", onTypingStart);
      socket.off("typing_stop", onTypingStop);
      socket.off("message_delivered", onDelivered);
      socket.off("message_read", onRead);
      socket.off("message:read", onRead);
      socket.off("reaction_added", onReaction);
      socket.off("reaction_removed", onReaction);
      socket.off("reaction_updated", onReaction);
      socket.off("message_pinned", onPinned);
      socket.off("message_unpinned", onUnpinned);
      socket.off("group:updated", onGroupUpdated);
      socket.off("group:deleted", onGroupDeleted);
    };
  }, [socket, conversation?.id, user?.id, onConversationDeleted, onConversationUpdated]);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typingText]);

  // Scroll to bottom on new message
  const scrollToBottom = useCallback(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  async function sendMessage({ content, type, attachments, reply_to_id = null }) {
    try {
      const { data } = await api.post(`/messages/conversation/${conversation.id}`, {
        content, type, attachments, reply_to_id,
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Impossible d'envoyer");
    }
  }

  function onTyping(is) {
    if (!socket || !conversation) return;
    socket.emit("typing", { conversation_id: conversation.id, is_typing: is });
    socket.emit(is ? "typing_start" : "typing_stop", { conversation_id: conversation.id });
    clearTimeout(typingTimer.current);
    if (is) {
      typingTimer.current = setTimeout(() => {
        socket.emit("typing", { conversation_id: conversation.id, is_typing: false });
        socket.emit("typing_stop", { conversation_id: conversation.id });
      }, 2500);
    }
  }

  async function reactToMessage(message, reaction) {
    try {
      const { data } = await api.post(`/messages/${message.id}/reactions`, { reaction });
      setMessages((prev) => prev.map((m) => (m.id === message.id ? data.message : m)));
    } catch (err) {
      toast.error(err.response?.data?.message || "Réaction impossible");
    }
  }

  async function removeReaction(message) {
    try {
      const { data } = await api.delete(`/messages/${message.id}/reactions`);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? data.message : m)));
    } catch (err) {
      toast.error(err.response?.data?.message || "Suppression impossible");
    }
  }

  async function pinMessage(message) {
    try {
      const { data } = await api.post(`/messages/${message.id}/pin`);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? data.message : m)));
    } catch (err) {
      toast.error(err.response?.data?.message || "Épinglage impossible");
    }
  }

  async function unpinMessage(message) {
    try {
      await api.delete(`/messages/${message.id}/pin`);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, is_pinned: 0, pinned_by: null, pinned_at: null } : m)));
    } catch (err) {
      toast.error(err.response?.data?.message || "Désépinglage impossible");
    }
  }

  async function deleteMessage(message) {
    if (!window.confirm("Supprimer ce message pour tout le monde ?")) return;
    try {
      await api.delete(`/messages/${message.id}`);
      setMessages((prev) => prev.map((m) => (
        m.id === message.id ? { ...m, is_deleted: 1, content: null, attachments: [] } : m
      )));
      setReplyTo((current) => (current?.id === message.id ? null : current));
    } catch (err) {
      toast.error(err.response?.data?.message || "Suppression impossible");
    }
  }

  function scrollToMessage(id) {
    document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openSearchResult(message) {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message].sort((a, b) => a.id - b.id);
    });
    setTimeout(() => scrollToMessage(message.id), 80);
  }

  function call(type) {
    if (isGroup) {
      toast("Les appels de groupe arrivent bientôt");
      return;
    }
    if (!d.peer) return;
    startCall(d.peer, conversation.id, type);
  }

  // Pull to refresh handlers
  const handleTouchStart = (e) => {
    if (scrollerRef.current?.scrollTop === 0 && !loadingMore) {
      pullStartRef.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e) => {
    if (!isPulling || !pullStartRef.current) return;
    const distance = e.touches[0].clientY - pullStartRef.current;
    if (distance > 0) {
      setPullDistance(Math.min(distance * 0.5, 100));
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling) return;
    setIsPulling(false);
    if (pullDistance > 60) {
      await loadMessages(conversation.id, messages[0]?.id, true);
    }
    setPullDistance(0);
    pullStartRef.current = null;
  };

  // Group messages by date
  const messagesWithDates = useMemo(() => {
    if (!messages.length) return [];
    const result = [];
    let lastDate = null;
    for (const m of messages) {
      const dateLabel = formatDateLabel(m.created_at);
      if (dateLabel !== lastDate) {
        result.push({ type: "date", label: dateLabel });
        lastDate = dateLabel;
      }
      result.push({ type: "message", data: m });
    }
    return result;
  }, [messages]);

  if (!conversation) {
    return (
      <div className="h-full chat-empty-bg flex flex-col items-center justify-center text-center p-6">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-brand-600 to-senegal-green
                        flex items-center justify-center text-white mb-5 shadow-soft">
          <MessageCircle className="w-11 h-11" />
        </div>
        <h2 className="font-display text-2xl font-bold text-ink-900">Bienvenue sur Senegram</h2>
        <p className="text-ink-500 max-w-md mt-2">
          Sélectionne une discussion ou crée-en une nouvelle pour commencer à échanger.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col chat-surface">
      {/* Header */}
      <div className="h-[72px] flex items-center gap-3 px-4 bg-white/95 backdrop-blur border-b border-ink-100 shadow-bubble">
        <button className="btn-ghost p-2 md:hidden rounded-full" onClick={onBack} title="Retour">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-2xl hover:bg-ink-50 px-1 py-1 -ml-1"
          onClick={() => setInfoOpen(true)}
          title="Voir les infos"
        >
          <Avatar
            user={{ display_name: d.name, avatar_url: d.avatar_url, username: d.name }}
            size={42}
            online={isOnline}
          />
          <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink-900 truncate">{d.name}</div>
          <div className={`text-xs truncate ${typingText ? "text-brand-700 font-medium" : "text-ink-500"}`}>
            {typingText || d.subtitle}
          </div>
          </div>
        </button>
        <button className="btn-ghost p-2 rounded-full shrink-0" onClick={() => call("audio")} title="Appel audio">
          <Phone className="w-5 h-5" />
        </button>
        <button className="btn-ghost p-2 rounded-full shrink-0" onClick={() => call("video")} title="Appel vidéo">
          <Video className="w-5 h-5" />
        </button>
        <button
          className="btn-ghost p-2 rounded-full shrink-0"
          onClick={() => setSearchOpen((v) => !v)}
          title="Rechercher"
        >
          {searchOpen ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
        </button>
        <button className="btn-ghost p-2 rounded-full shrink-0 hidden sm:inline-flex" title="Options">
          <MoreVertical className="w-5 h-5" />
        </button>
      </div>

      {searchOpen && (
        <div className="bg-white/95 border-b border-ink-100 px-3 sm:px-4 py-3 shadow-bubble">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
              <input
                className="input pl-10 bg-ink-50 border-ink-100"
                placeholder="Rechercher messages, photos, médias..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="flex gap-1 mt-2 overflow-x-auto">
            {[
              ["all", "Tout"],
              ["messages", "Messages"],
              ["photos", "Photos"],
              ["media", "Médias"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSearchFilter(value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                  searchFilter === value ? "bg-brand-600 text-white" : "bg-ink-50 text-ink-700 hover:bg-ink-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {(searchQ.trim() || searchFilter !== "all") && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-ink-100 bg-white">
              {searchLoading ? (
                <div className="px-3 py-4 text-sm text-ink-500">Recherche...</div>
              ) : searchResults.length ? (
                searchResults.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => openSearchResult(m)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-50 border-b last:border-b-0 border-ink-100"
                  >
                    <SearchThumb message={m} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-ink-700 truncate">
                        {m.sender_name || m.sender_username}
                      </div>
                      <div className="text-sm text-ink-600 truncate">
                        {m.content || m.attachments?.[0]?.file_name || m.type}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-ink-500">Aucun résultat</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-1.5 chat-pattern touch-scroll"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull to refresh indicator */}
        {isPulling && pullDistance > 0 && (
          <div className="flex items-center justify-center py-2">
            <ArrowDown
              className={`w-5 h-5 text-ink-400 transition-transform ${pullDistance > 60 ? "rotate-180" : ""}`}
              style={{ transform: `rotate(${pullDistance > 60 ? 180 : 0}deg)` }}
            />
            <span className="ml-2 text-xs text-ink-500">
              {pullDistance > 60 ? "Relâchez pour actualiser" : "Tirez pour actualiser"}
            </span>
          </div>
        )}

        {isGroup && pinnedMessages.length > 0 && (
          <div className="sticky top-0 z-10 mb-3 bg-white/95 backdrop-blur border border-brand-100 rounded-xl shadow-soft overflow-hidden">
            {pinnedMessages.slice(0, 3).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => scrollToMessage(m.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-brand-50 border-b last:border-b-0 border-ink-100"
              >
                <Pin className="w-4 h-4 text-brand-700" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink-700 truncate">
                    Message épinglé par {m.pinned_by_name || "un admin"}
                  </div>
                  <div className="text-xs text-ink-500 truncate">{m.content || m.type}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {loading
          ? <div className="mx-auto mt-8 w-fit px-4 py-2 rounded-full bg-white/80 text-ink-500 text-sm shadow-bubble">Chargement...</div>
          : messagesWithDates.length === 0
            ? <div className="mx-auto mt-12 max-w-sm text-center p-6 rounded-2xl bg-white/80 border border-white shadow-soft">
                <MessageCircle className="w-9 h-9 mx-auto text-brand-700 mb-3" />
                <div className="font-semibold text-ink-900">Aucun message</div>
                <div className="text-sm text-ink-500 mt-1">Envoyez le premier message pour démarrer la conversation.</div>
              </div>
            : messagesWithDates.map((item, idx) => {
                if (item.type === "date") {
                  return (
                    <div key={`date-${idx}`} className="date-separator">
                      <span>{item.label}</span>
                    </div>
                  );
                }
                const m = item.data;
                const prev = messagesWithDates[idx - 1];
                const showSender = isGroup
                  && m.sender_id !== user.id
                  && (!prev || prev.type !== "message" || prev.data.sender_id !== m.sender_id);
                return (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    isMe={m.sender_id === user.id}
                    showSender={showSender}
                    canPin={canPin}
                    currentUserId={user.id}
                    onReact={reactToMessage}
                    onRemoveReaction={removeReaction}
                    onReply={setReplyTo}
                    onDelete={deleteMessage}
                    onPin={pinMessage}
                    onUnpin={unpinMessage}
                    onSwipeReply={setReplyTo}
                  />
                );
              })
          }

        {typingText && (
          <div className="w-fit px-3 py-1.5 rounded-full bg-white/80 text-xs text-ink-500 italic shadow-bubble">
            {typingText}
          </div>
        )}

        {loadingMore && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Input */}
      <MessageInput
        onSend={sendMessage}
        onTyping={onTyping}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />

      {infoOpen && (
        <ConversationInfoModal
          conversation={conversation}
          currentUser={user}
          onClose={() => setInfoOpen(false)}
          onConversationDeleted={onConversationDeleted}
          onConversationUpdated={(next) => {
            onConversationUpdated?.(next);
            onUpdated?.();
          }}
        />
      )}
    </div>
  );
}

function SearchThumb({ message }) {
  const first = message.attachments?.[0];
  if (first?.mime_type?.startsWith("image/")) {
    return (
      <img
        src={fileUrl(first.url)}
        alt=""
        className="w-10 h-10 rounded-lg object-cover bg-ink-100"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
      <MessageCircle className="w-5 h-5" />
    </div>
  );
}