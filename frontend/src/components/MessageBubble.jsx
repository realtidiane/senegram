import { useEffect, useRef, useState, useCallback } from "react";
import { format } from "date-fns";
import { Check, CheckCheck, Download, FileText, Pause, Pin, PinOff, Play, Reply, SmilePlus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { fileUrl } from "../services/api";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function timeHHMM(d) {
  try { return format(new Date(d), "HH:mm"); } catch { return ""; }
}

function fmtDuration(seconds = 0) {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60).toString().padStart(2, "0");
  const s = (safe % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function messageStatus(message) {
  if (message.read_at) return "read";
  if (message.delivered_at) return "delivered";
  return "sent";
}

function groupedReactions(reactions = []) {
  return reactions.reduce((acc, r) => {
    acc[r.reaction] = acc[r.reaction] || [];
    acc[r.reaction].push(r);
    return acc;
  }, {});
}

export default function MessageBubble({
  message,
  isMe,
  showSender = false,
  canPin = false,
  onReact,
  onRemoveReaction,
  onReply,
  onDelete,
  onPin,
  onUnpin,
  currentUserId,
  onSwipeReply,
}) {
  const cls = clsx(
    "bubble group",
    isMe ? "bubble-me" : "bubble-them",
    isMe ? "ml-auto" : "mr-auto",
  );
  const status = messageStatus(message);
  const reactionGroups = groupedReactions(message.reactions);
  const myReaction = (message.reactions || []).find((r) => r.user_id === currentUserId);
  const [showPicker, setShowPicker] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const bubbleRef = useRef(null);
  const startXRef = useRef(0);

  useEffect(() => {
    if (!showPicker) return;
    function onPointerDown(e) {
      if (!bubbleRef.current?.contains(e.target)) setShowPicker(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setShowPicker(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showPicker]);

  function react(reaction) {
    if (myReaction?.reaction === reaction) onRemoveReaction?.(message);
    else onReact?.(message, reaction);
    setShowPicker(false);
  }

  // Touch swipe handlers
  const handleTouchStart = useCallback((e) => {
    startXRef.current = e.touches[0].clientX;
    setIsSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isSwiping) return;
    const delta = e.touches[0].clientX - startXRef.current;
    if ((isMe && delta < 0) || (!isMe && delta > 0)) {
      setSwipeX(Math.max(-100, Math.min(100, delta)));
    }
  }, [isSwiping, isMe]);

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping) return;
    setIsSwiping(false);
    if (Math.abs(swipeX) > 60) {
      onSwipeReply?.(message);
      setSwipeX(0);
    } else {
      setSwipeX(0);
    }
  }, [isSwiping, swipeX, onSwipeReply]);

  return (
    <div id={`message-${message.id}`} className={clsx("w-full flex", isMe ? "justify-end" : "justify-start")}>
      <div
        ref={bubbleRef}
        className={cls}
        onDoubleClick={() => message.type !== "system" && setShowPicker((v) => !v)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(${swipeX}px)`, transition: isSwiping ? 'none' : 'transform 0.2s ease' }}
      >
        {showPicker && message.type !== "system" && !message.is_deleted && (
          <div
            className={clsx(
              "absolute z-20 bottom-full mb-1 flex items-center gap-1 rounded-full bg-white px-1.5 py-1 shadow-soft border border-ink-100",
              isMe ? "right-0" : "left-0",
            )}
          >
            {REACTIONS.map((reaction) => (
              <button
                type="button"
                key={reaction}
                onClick={() => react(reaction)}
                className={clsx(
                  "w-8 h-8 rounded-full text-base hover:bg-ink-100 transition",
                  myReaction?.reaction === reaction && "bg-brand-50 ring-1 ring-brand-200",
                )}
              >
                {reaction}
              </button>
            ))}
          </div>
        )}

        {!isMe && showSender && (
          <div className="text-[11px] font-semibold text-brand-700 mb-0.5 leading-none">
            {message.sender_name}
          </div>
        )}

        {message.is_deleted ? (
          <div className="italic text-sm opacity-75">Message supprimé</div>
        ) : message.type === "system" ? (
          <div className="italic text-sm">{message.content}</div>
        ) : (
          <>
            {message.reply_to_id && (
              <button
                type="button"
                className={clsx(
                  "w-full text-left mb-1.5 px-2.5 py-1.5 rounded-xl border-l-4 bg-black/5",
                  isMe ? "border-white/70" : "border-brand-500",
                )}
                title="Message cité"
              >
                <div className="text-[11px] font-semibold truncate">
                  {message.reply_sender_name || message.reply_sender_username || "Message"}
                </div>
                <div className="text-xs opacity-75 truncate">
                  {message.reply_content || message.reply_type || "Pièce jointe"}
                </div>
              </button>
            )}
            {message.attachments?.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
            {message.content && (
              <div className="whitespace-pre-wrap break-words leading-snug text-[15px]">
                {message.content}
              </div>
            )}
          </>
        )}

        {Object.keys(reactionGroups).length > 0 && (
        <div className={clsx("flex items-center gap-1 mt-0.5 flex-wrap", isMe ? "justify-end" : "justify-start")}>
          {Object.entries(reactionGroups).map(([reaction, users]) => (
            <button
              key={reaction}
              type="button"
              title={users.map((u) => u.display_name || u.username).join(", ")}
              onClick={() => react(reaction)}
              className={clsx(
                "text-[11px] leading-none px-1.5 py-0.5 rounded-full border",
                isMe ? "bg-white/15 border-white/20" : "bg-ink-50 border-ink-200",
              )}
            >
              {reaction} {users.length}
            </button>
          ))}
        </div>
        )}

        {message.type !== "system" && !message.is_deleted && (
          <div className={clsx(
            "absolute top-1/2 -translate-y-1/2 flex gap-1 transition-opacity opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
            isMe ? "justify-end" : "justify-start",
            isMe ? "-left-9" : "-right-9",
          )}>
            <button
              type="button"
              className="w-7 h-7 rounded-full bg-white text-ink-700 border border-ink-100 shadow-bubble flex items-center justify-center hover:bg-ink-50"
              title="Réagir"
              onClick={() => setShowPicker((v) => !v)}
            >
              <SmilePlus className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="w-7 h-7 rounded-full bg-white text-ink-700 border border-ink-100 shadow-bubble flex items-center justify-center hover:bg-ink-50"
              title="Répondre"
              onClick={() => onReply?.(message)}
            >
              <Reply className="w-4 h-4" />
            </button>
            {isMe && (
              <button
                type="button"
                className="w-7 h-7 rounded-full bg-white text-senegal-red border border-ink-100 shadow-bubble flex items-center justify-center hover:bg-ink-50"
                title="Supprimer pour tout le monde"
                onClick={() => onDelete?.(message)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {canPin && (
              <button
                type="button"
                className="w-7 h-7 rounded-full bg-white text-ink-700 border border-ink-100 shadow-bubble flex items-center justify-center hover:bg-ink-50"
                title={message.is_pinned ? "Désépingler" : "Épingler"}
                onClick={() => (message.is_pinned ? onUnpin?.(message) : onPin?.(message))}
              >
                {message.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        )}

        <div className={clsx(
          "flex items-center gap-1 text-[10px] mt-0 leading-none",
          isMe ? "text-white/70 justify-end" : "text-ink-500 justify-end",
        )}>
          {message.is_edited && <span>modifié ·</span>}
          {message.is_pinned ? <Pin className="w-3 h-3" /> : null}
          {timeHHMM(message.created_at)}
          {isMe && (
            status === "read"
              ? <CheckCheck className="w-3.5 h-3.5 text-sky-300" />
              : status === "delivered"
                ? <CheckCheck className="w-3.5 h-3.5" />
                : <Check className="w-3.5 h-3.5" />
          )}
        </div>
      </div>
    </div>
  );
}

function Attachment({ a }) {
  const url = fileUrl(a.url);
  if (a.mime_type?.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mb-1">
        <img src={url} alt={a.file_name} className="rounded-xl max-h-72 object-cover" />
      </a>
    );
  }
  if (a.mime_type?.startsWith("video/")) {
    return <video src={url} controls className="rounded-xl max-h-72 mb-1" />;
  }
  if (a.mime_type?.startsWith("audio/")) {
    return <VoiceAttachment url={url} file={a} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer"
       className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 mb-1">
      <FileText className="w-5 h-5" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{a.file_name}</div>
        <div className="text-xs opacity-80">{Math.round((a.file_size || 0) / 1024)} Ko</div>
      </div>
      <Download className="w-4 h-4 opacity-70" />
    </a>
  );
}

function VoiceAttachment({ url, file }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(file.duration ? file.duration / 1000 : 0);
  const [speed, setSpeed] = useState(1);
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;

  function toggle() {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
  }

  function changeSpeed() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  function seek(e) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
    setCurrent(audioRef.current.currentTime);
  }

  return (
    <div className="min-w-[230px] max-w-[300px] mb-1 rounded-2xl bg-black/5 px-2.5 py-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || duration)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="w-9 h-9 rounded-full bg-white/90 text-ink-900 flex items-center justify-center shadow-bubble"
          title={playing ? "Pause" : "Lire"}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={seek}
          className="flex-1 h-7 flex items-center"
          title="Avancer dans la note vocale"
        >
          <span className="w-full h-1.5 rounded-full bg-black/10 overflow-hidden">
            <span className="block h-full rounded-full bg-brand-500" style={{ width: `${progress}%` }} />
          </span>
        </button>
        <button
          type="button"
          onClick={changeSpeed}
          className="text-[11px] font-semibold px-2 py-1 rounded-full bg-white/70 text-ink-800"
          title="Vitesse de lecture"
        >
          {speed}x
        </button>
      </div>
      <div className="mt-1 flex justify-between text-[10px] opacity-70">
        <span>{fmtDuration(current)}</span>
        <span>{fmtDuration(duration)}</span>
      </div>
    </div>
  );
}