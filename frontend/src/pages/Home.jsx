import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Plus, Search, Settings, LogOut, Wifi } from "lucide-react";
import toast from "react-hot-toast";

import Avatar         from "../components/Avatar";
import ChatList       from "../components/ChatList";
import ChatWindow     from "../components/ChatWindow";
import NewChatModal   from "../components/NewChatModal";
import NewGroupModal  from "../components/NewGroupModal";
import ProfileModal   from "../components/ProfileModal";

import api            from "../services/api";
import { useAuth }    from "../context/AuthContext";
import { useSocket }  from "../context/useSocket";
import { notifyUser } from "../utils/notifications";

export default function Home() {
  const { user, logout } = useAuth();
  const { socket, onlineUsers } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [active,        setActive]        = useState(null);
  const [q,             setQ]             = useState("");

  const [modalNew,      setModalNew]      = useState(false);
  const [modalGroup,    setModalGroup]    = useState(false);
  const [modalProfile,  setModalProfile]  = useState(false);
  const pendingOpenConversationId = useRef(null);
  const typingTimers = useRef({});
  const [typingByConversation, setTypingByConversation] = useState({});

  const load = useCallback(() => {
    api.get("/conversations")
      .then(({ data }) => setConversations(data.conversations))
      .catch(() => toast.error("Impossible de charger les discussions"));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Rafraîchir la liste quand un nouveau message arrive partout
  useEffect(() => {
    if (!socket) return;
    const onNew = (message) => {
      load();
      if (document.hidden && message?.sender_id !== user.id) {
        notifyUser({
          title: message.sender_name || "Nouveau message",
          body: message.content || "Nouveau fichier reçu",
          conversationId: message.conversation_id,
        });
      }
    };
    const onGroupAdded = ({ conversation }) => {
      setConversations((prev) => (
        prev.some((c) => c.id === conversation.id) ? prev : [conversation, ...prev]
      ));
      socket.emit("conversation:join", { conversation_id: conversation.id });
      notifyUser({
        title: "Nouveau groupe",
        body: `Tu as été ajouté à ${conversation.name || "un groupe"}`,
        conversationId: conversation.id,
      });
    };
    const onGroupRemoved = ({ conversation_id }) => {
      removeConversation(conversation_id);
      toast("Tu as été retiré du groupe");
    };
    const onPresence = ({ user_id, status, last_seen }) => {
      setConversations((prev) => prev.map((c) => ({
        ...c,
        members: (c.members || []).map((m) => (
          m.id === user_id
            ? { ...m, status, is_online: status === "online", last_seen: last_seen || m.last_seen }
            : m
        )),
      })));
    };
    const setTypingState = ({ conversation_id, user_id, username, is_typing }) => {
      if (!conversation_id || user_id === user.id) return;
      setTypingByConversation((prev) => {
        const next = { ...prev };
        const current = { ...(next[conversation_id] || {}) };
        if (is_typing) current[user_id] = username;
        else delete current[user_id];
        if (Object.keys(current).length) next[conversation_id] = current;
        else delete next[conversation_id];
        return next;
      });

      const timerKey = `${conversation_id}:${user_id}`;
      clearTimeout(typingTimers.current[timerKey]);
      if (is_typing) {
        typingTimers.current[timerKey] = setTimeout(() => {
          setTypingByConversation((prev) => {
            const next = { ...prev };
            const current = { ...(next[conversation_id] || {}) };
            delete current[user_id];
            if (Object.keys(current).length) next[conversation_id] = current;
            else delete next[conversation_id];
            return next;
          });
          delete typingTimers.current[timerKey];
        }, 3500);
      } else {
        delete typingTimers.current[timerKey];
      }
    };
    const onTypingStart = (payload) => setTypingState({ ...payload, is_typing: true });
    const onTypingStop = (payload) => setTypingState({ ...payload, is_typing: false });

    socket.on("message:new", onNew);
    socket.on("group:added", onGroupAdded);
    socket.on("group:removed", onGroupRemoved);
    socket.on("user_online", onPresence);
    socket.on("user_offline", onPresence);
    socket.on("presence:update", onPresence);
    socket.on("typing_start", onTypingStart);
    socket.on("typing_stop", onTypingStop);
    return () => {
      socket.off("message:new", onNew);
      socket.off("group:added", onGroupAdded);
      socket.off("group:removed", onGroupRemoved);
      socket.off("user_online", onPresence);
      socket.off("user_offline", onPresence);
      socket.off("presence:update", onPresence);
      socket.off("typing_start", onTypingStart);
      socket.off("typing_stop", onTypingStop);
      Object.values(typingTimers.current).forEach((timer) => clearTimeout(timer));
      typingTimers.current = {};
    };
  }, [socket, load, user?.id]);

  useEffect(() => {
    const openFromNotification = (event) => {
      const id = Number(event.detail?.conversationId);
      if (!id) return;
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        setActive(conv);
        return;
      }
      pendingOpenConversationId.current = id;
      load();
    };
    window.addEventListener("senegram:open-conversation", openFromNotification);
    return () => window.removeEventListener("senegram:open-conversation", openFromNotification);
  }, [conversations, load]);

  useEffect(() => {
    if (!pendingOpenConversationId.current) return;
    const conv = conversations.find((c) => c.id === pendingOpenConversationId.current);
    if (conv) {
      setActive(conv);
      pendingOpenConversationId.current = null;
    }
  }, [conversations]);

  async function openPrivate(target) {
    try {
      const { data } = await api.post("/conversations/private", { other_user_id: target.id });
      setModalNew(false);
      setActive(data.conversation);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Impossible d'ouvrir la discussion");
    }
  }

  function onGroupCreated(conv) {
    setModalGroup(false);
    setModalNew(false);
    setActive(conv);
    load();
  }

  function updateConversation(next) {
    setConversations((prev) => prev.map((c) => (c.id === next.id ? next : c)));
    setActive((current) => (current?.id === next.id ? next : current));
  }

  function removeConversation(id) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setActive((current) => (current?.id === id ? null : current));
  }

  const filtered = conversations.filter((c) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    const name = c.type === "group"
      ? c.name
      : (c.members || []).find((m) => m.id !== user.id)?.display_name || "";
    return name?.toLowerCase().includes(needle);
  });

  return (
    <div className="h-screen flex bg-ink-100 text-ink-900">
      {/* Sidebar */}
      <aside className={`${active ? "hidden md:flex" : "flex"} flex-col w-full md:w-[380px] lg:w-[400px] bg-white/95 backdrop-blur border-r border-ink-200/80`}>
        <div className="h-[72px] flex items-center gap-3 px-4 border-b border-ink-100 bg-gradient-to-r from-white to-brand-50/70">
          <button onClick={() => setModalProfile(true)} className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar user={user} size={40} online />
            <div className="min-w-0 text-left">
              <div className="font-semibold text-ink-900 truncate">{user.display_name}</div>
              <div className="text-xs text-brand-700 flex items-center gap-1">
                <Wifi className="w-3 h-3" />
                en ligne
              </div>
            </div>
          </button>
          <button onClick={() => setModalNew(true)} className="btn-primary p-2.5 rounded-full" title="Nouvelle discussion">
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 pt-4 pb-3">
          <div className="flex items-end justify-between gap-3 mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-brand-700 font-semibold">Messages</div>
              <div className="text-xl font-display font-bold text-ink-900">Discussions</div>
            </div>
            <div className="text-xs text-ink-500">{conversations.length} conversation{conversations.length > 1 ? "s" : ""}</div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              className="input pl-10 bg-ink-50 border-ink-100"
              placeholder="Rechercher…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ChatList
            conversations={filtered}
            currentUser={user}
            activeId={active?.id}
            onSelect={(c) => setActive(c)}
            onlineUsers={onlineUsers}
            typingByConversation={typingByConversation}
          />
        </div>

        <div className="p-3 border-t border-ink-100 flex items-center gap-2 bg-white">
          <button onClick={() => setModalProfile(true)} className="btn-ghost p-2 rounded-full" title="Paramètres">
            <Settings className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center font-display text-brand-800 font-bold">
            <MessageCircle className="w-4 h-4 inline -mt-1" /> Senegram
          </div>
          <button onClick={logout} className="btn-ghost p-2 text-senegal-red rounded-full" title="Déconnexion">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main chat area */}
      <main className={`${active ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
        <ChatWindow
          conversation={active}
          onBack={() => setActive(null)}
          onUpdated={load}
          onConversationDeleted={removeConversation}
          onConversationUpdated={updateConversation}
        />
      </main>

      {/* Modales */}
      {modalNew && (
        <NewChatModal
          onClose={() => setModalNew(false)}
          onOpenPrivate={openPrivate}
          onOpenNewGroup={() => { setModalNew(false); setModalGroup(true); }}
        />
      )}
      {modalGroup && (
        <NewGroupModal
          onClose={() => setModalGroup(false)}
          onCreated={onGroupCreated}
        />
      )}
      {modalProfile && (
        <ProfileModal onClose={() => setModalProfile(false)} />
      )}
    </div>
  );
}
