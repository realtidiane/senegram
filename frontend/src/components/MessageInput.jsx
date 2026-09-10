import { useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Mic,
  Paperclip,
  Pause,
  Play,
  Send,
  Smile,
  Square,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";
import { compressImage, formatBytes } from "../utils/imageCompression";

const EMOJIS = ["😀","😂","🥰","😍","🔥","👍","🙏","🎉","❤️","🇸🇳","😎","🙌","💪","😢","😮"];
const MAX_VOICE_SECONDS = 300;

export default function MessageInput({ onSend, onTyping, replyTo, onCancelReply }) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [pending, setPending] = useState(null);
  const [compression, setCompression] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState(null);
  const [playingDraft, setPlayingDraft] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const audioRef = useRef(null);
  const typingStartRef = useRef(0);
  const recordSecondsRef = useRef(0);
  const sendAfterStopRef = useRef(false);
  const textRef = useRef("");
  const replyToRef = useRef(null);

  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    if (voiceDraft?.url) URL.revokeObjectURL(voiceDraft.url);
  }, [voiceDraft?.url]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    replyToRef.current = replyTo;
  }, [replyTo]);

  function onChange(e) {
    const value = e.target.value;
    setText(value);
    if (!value.trim()) {
      typingStartRef.current = 0;
      onTyping?.(false);
      return;
    }
    const now = Date.now();
    if (now - typingStartRef.current > 1200) {
      typingStartRef.current = now;
      onTyping?.(true);
    }
  }

  async function pickAndUpload(file) {
    if (!file) return;
    setUploading(true);
    setCompression(null);
    try {
      const result = await compressImage(file);
      setCompression(result.stats);

      const fd = new FormData();
      fd.append("file", result.file);
      const { data } = await api.post("/upload/file", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPending(data.file);
    } catch (err) {
      toast.error(err.response?.data?.message || "Upload impossible");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (imageRef.current) imageRef.current.value = "";
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast.error("Enregistrement audio non supporté par ce navigateur");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Safari supports audio/mp4, Chrome/Firefox support audio/webm
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : MediaRecorder.isTypeSupported("audio/mpeg")
              ? "audio/mpeg"
              : "";
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blobType = recorder.mimeType || "audio/webm";
        const ext = blobType.includes("mp4") ? "m4a" : blobType.includes("mpeg") ? "mp3" : "webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        if (blob.size > 10 * 1024 * 1024) {
          toast.error("Note vocale trop lourde (max 10 MB)");
          sendAfterStopRef.current = false;
          return;
        }
        const duration = recordSecondsRef.current || 1;
        const fileName = `note-vocale-${Date.now()}.${ext}`;

        if (sendAfterStopRef.current) {
          sendAfterStopRef.current = false;
          setUploading(true);
          try {
            const voiceFile = await uploadVoiceBlob(blob, duration, fileName);
            await onSend({
              content: textRef.current.trim() || null,
              type: "audio",
              attachments: [voiceFile],
              reply_to_id: replyToRef.current?.id || null,
            });
            setText("");
            setPending(null);
            setCompression(null);
            setVoiceDraft(null);
            setShowEmoji(false);
            onCancelReply?.();
            onTyping?.(false);
          } catch (err) {
            toast.error(err.response?.data?.message || "Impossible d'envoyer la note vocale");
          } finally {
            setUploading(false);
          }
          return;
        }

        setVoiceDraft({
          blob,
          url: URL.createObjectURL(blob),
          duration,
          fileName,
        });
      };

      setRecordSeconds(0);
      recordSecondsRef.current = 0;
      setRecording(true);
      recorder.start();
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          recordSecondsRef.current = s + 1;
          if (s + 1 >= MAX_VOICE_SECONDS) {
            stopRecording();
            return MAX_VOICE_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error("Impossible d'accéder au micro");
    }
  }

  function stopRecording({ send = false } = {}) {
    sendAfterStopRef.current = send;
    clearInterval(recordTimerRef.current);
    setRecording(false);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    } else {
      sendAfterStopRef.current = false;
    }
  }

  function removeVoiceDraft() {
    if (voiceDraft?.url) URL.revokeObjectURL(voiceDraft.url);
    setVoiceDraft(null);
    setPlayingDraft(false);
  }

  async function uploadVoiceBlob(blob, duration, fileName) {
    const fd = new FormData();
    fd.append("file", new File([blob], fileName, { type: blob.type || "audio/webm" }));
    fd.append("duration", String(duration));
    const { data } = await api.post("/upload/voice", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data.file;
  }

  async function uploadVoiceDraft() {
    if (!voiceDraft) return null;
    return uploadVoiceBlob(voiceDraft.blob, voiceDraft.duration, voiceDraft.fileName);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (recording) {
      stopRecording({ send: true });
      return;
    }
    if (!text.trim() && !pending && !voiceDraft) return;

    setUploading(true);
    try {
      let type = "text";
      const attachments = [];

      if (voiceDraft) {
        const voiceFile = await uploadVoiceDraft();
        attachments.push(voiceFile);
        type = "audio";
      } else if (pending) {
        attachments.push(pending);
        if (pending.mime_type?.startsWith("image/")) type = "image";
        else if (pending.mime_type?.startsWith("video/")) type = "video";
        else if (pending.mime_type?.startsWith("audio/")) type = "audio";
        else type = "file";
      }

      await onSend({
        content: text.trim() || null,
        type,
        attachments,
        reply_to_id: replyTo?.id || null,
      });
      setText("");
      setPending(null);
      setCompression(null);
      removeVoiceDraft();
      setShowEmoji(false);
      onCancelReply?.();
      onTyping?.(false);
    } catch (err) {
      toast.error(err.response?.data?.message || "Impossible d'envoyer");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-3 sm:p-4 bg-white/95 backdrop-blur border-t border-ink-100 relative">
      {replyTo && (
        <div className="flex items-center gap-3 p-3 mb-3 rounded-2xl bg-brand-50 border border-brand-100">
          <div className="w-1 self-stretch rounded-full bg-brand-500" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-brand-800 truncate">
              Réponse à {replyTo.sender_name || replyTo.sender_username || "un message"}
            </div>
            <div className="text-sm text-ink-600 truncate">
              {replyTo.content || replyTo.attachments?.[0]?.file_name || replyTo.type}
            </div>
          </div>
          <button type="button" onClick={onCancelReply} className="btn-ghost p-2 rounded-full" title="Annuler la réponse">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-3 p-3 mb-3 rounded-2xl bg-ink-50 border border-ink-100">
          <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{pending.file_name}</div>
            {compression && (
              <div className="text-xs text-ink-500">
                {formatBytes(compression.originalSize)} → {formatBytes(compression.compressedSize)}
                {" "}({compression.reduction}% de réduction)
              </div>
            )}
          </div>
          <button onClick={() => { setPending(null); setCompression(null); }} className="p-2 hover:bg-ink-200 rounded-full" title="Retirer le fichier">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {voiceDraft && (
        <div className="flex items-center gap-3 p-3 mb-3 rounded-2xl bg-brand-50 border border-brand-100">
          <button
            type="button"
            className="btn-primary p-2 rounded-full"
            onClick={() => {
              if (!audioRef.current) return;
              if (playingDraft) audioRef.current.pause();
              else audioRef.current.play();
            }}
          >
            {playingDraft ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <audio
            ref={audioRef}
            src={voiceDraft.url}
            onPlay={() => setPlayingDraft(true)}
            onPause={() => setPlayingDraft(false)}
            onEnded={() => setPlayingDraft(false)}
            className="hidden"
          />
          <div className="flex-1 text-sm font-medium text-brand-900">Note vocale · {Math.max(1, voiceDraft.duration)}s</div>
          <button type="button" onClick={removeVoiceDraft} className="btn-ghost p-2 rounded-full" title="Supprimer">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {recording && (
        <div className="flex items-center gap-2 text-sm text-senegal-red mb-2 px-2">
          <span className="w-2 h-2 rounded-full bg-senegal-red animate-pulse" />
          Enregistrement {recordSeconds}s / {MAX_VOICE_SECONDS}s
        </div>
      )}

      {showEmoji && (
        <div className="absolute bottom-full mb-2 left-3 p-2 card grid grid-cols-5 gap-1 z-20 border border-ink-100">
          {EMOJIS.map((emoji) => (
            <button key={emoji} onClick={() => setText((t) => t + emoji)} className="text-xl hover:bg-ink-100 rounded p-1">
              {emoji}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 rounded-2xl bg-ink-50 border border-ink-100 p-2 shadow-bubble">
        <button type="button" className="btn-ghost p-2 rounded-full" onClick={() => setShowEmoji((v) => !v)} title="Emojis">
          <Smile className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost p-2 rounded-full" onClick={() => fileRef.current?.click()} disabled={uploading || recording} title="Joindre un fichier">
          <Paperclip className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost p-2 rounded-full" onClick={() => imageRef.current?.click()} disabled={uploading || recording} title="Joindre une image ou vidéo">
          <ImageIcon className="w-5 h-5" />
        </button>
        <button
          type="button"
          className={recording ? "btn-primary p-2 rounded-full bg-senegal-red hover:bg-senegal-red" : "btn-ghost p-2 rounded-full"}
          onClick={recording ? () => stopRecording() : startRecording}
          disabled={uploading || !!pending || !!voiceDraft}
          title={recording ? "Arrêter l'enregistrement" : "Note vocale"}
        >
          {recording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
        <input type="file" ref={fileRef} hidden onChange={(e) => pickAndUpload(e.target.files?.[0])} />
        <input type="file" ref={imageRef} hidden accept="image/*,video/*" onChange={(e) => pickAndUpload(e.target.files?.[0])} />

        <textarea
          rows={1}
          className="flex-1 resize-none max-h-32 bg-transparent border-0 px-2 py-2.5 focus:outline-none focus:ring-0 placeholder:text-ink-500 text-sm sm:text-base"
          placeholder="Écris un message…"
          value={text}
          onChange={onChange}
          disabled={recording}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        <button
          type="submit"
          className="btn-primary p-3 rounded-full"
          disabled={uploading || (!recording && !text.trim() && !pending && !voiceDraft)}
          title={recording ? "Arrêter et envoyer" : "Envoyer"}
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
