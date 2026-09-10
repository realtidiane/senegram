import { useEffect, useRef, useState } from "react";
import { Camera, Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from "lucide-react";
import { useCall } from "../context/CallContext";
import Avatar from "./Avatar";

function fmt(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function CallOverlay() {
  const { call, localStream, remoteStream, answerCall, rejectCall, endCall, switchCamera } = useCall();
  const localRef       = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const [micOn,  setMicOn]  = useState(true);
  const [camOn,  setCamOn]  = useState(true);
  const [timer,  setTimer]  = useState(0);

  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
      console.log('[CallOverlay] Remote stream tracks:', remoteStream.getTracks().map(t => `${t.kind}:${t.enabled}`));
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [localStream, remoteStream]);

  useEffect(() => {
    setMicOn(true); setCamOn(true); setTimer(0);
  }, [call?.id]);

  useEffect(() => {
    if (call?.state !== "ongoing") return;
    const t = setInterval(() => setTimer((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [call?.state]);

  if (!call) return null;

  const isVideo = call.type === "video";

  function toggleMic() {
    if (!localStream) return;
    const next = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }
  function toggleCam() {
    if (!localStream) return;
    const next = !camOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-ink-950 via-ink-900 to-brand-900 text-white flex flex-col">
      {/* Streams */}
      <div className="flex-1 relative overflow-hidden">
        {isVideo && remoteStream && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover bg-black"
          />
        )}

        {!isVideo && remoteStream && (
          <audio ref={remoteAudioRef} autoPlay playsInline controls={false} />
        )}

        {/* État : appel entrant / sortant / en cours */}
        {(call.state === "ringing" || !remoteStream || !isVideo) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
            <div className="relative mb-6">
              <Avatar user={call.peer} size={140} />
              {(call.state === "ringing" || call.state === "answering") && (
                <span className="absolute inset-0 rounded-full bg-white/10 animate-pulse-ring" />
              )}
            </div>
            <h2 className="font-display text-3xl font-bold">
              {call.peer?.display_name || call.peer?.username}
            </h2>
            <p className="mt-2 text-white/70">
              {call.state === "answering"
                ? "Réponse en cours…"
                : call.state === "ringing"
                ? call.direction === "outgoing"
                  ? `Appel ${isVideo ? "vidéo" : "audio"} en cours…`
                  : `Appel ${isVideo ? "vidéo" : "audio"} entrant`
                : remoteStream
                  ? "Connecté"
                  : "Connexion…"}
            </p>
          </div>
        )}

        {/* En cours : HUD + timer */}
        {call.state === "ongoing" && (
          <div className="absolute top-4 left-0 right-0 flex justify-center">
            <div className="px-4 py-1.5 rounded-full bg-black/40 backdrop-blur text-sm">
              {call.peer?.display_name} · {fmt(timer)}
            </div>
          </div>
        )}

        {/* Mini vue locale */}
        {isVideo && localStream && (
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-6 right-6 w-40 md:w-56 aspect-video rounded-xl border-2 border-white/20 bg-black object-cover shadow-2xl"
          />
        )}
      </div>

      {/* Contrôles */}
      <div className="p-6 flex items-center justify-center gap-4 bg-black/30 backdrop-blur">
        {call.state === "ringing" && call.direction === "incoming" ? (
          <>
            <button onClick={rejectCall}
                    className="w-16 h-16 rounded-full bg-senegal-red hover:bg-red-700 flex items-center justify-center">
              <PhoneOff className="w-7 h-7" />
            </button>
            <button onClick={answerCall}
                    className="w-16 h-16 rounded-full bg-brand-500 hover:bg-brand-600 flex items-center justify-center">
              <Phone className="w-7 h-7" />
            </button>
          </>
        ) : (
          <>
            <button onClick={toggleMic}
                    className={`w-14 h-14 rounded-full flex items-center justify-center
                                ${micOn ? "bg-white/15 hover:bg-white/25" : "bg-white text-ink-900"}`}>
              {micOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>

            {isVideo && (
              <>
              <button onClick={toggleCam}
                      className={`w-14 h-14 rounded-full flex items-center justify-center
                                  ${camOn ? "bg-white/15 hover:bg-white/25" : "bg-white text-ink-900"}`}>
                {camOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
              </button>
              <button
                onClick={switchCamera}
                disabled={!localStream?.getVideoTracks().length}
                className="w-14 h-14 rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-40 disabled:hover:bg-white/15 flex items-center justify-center"
                title="Changer de caméra"
              >
                <Camera className="w-6 h-6" />
              </button>
              </>
            )}

            <button onClick={endCall}
                    className="w-16 h-16 rounded-full bg-senegal-red hover:bg-red-700 flex items-center justify-center">
              <PhoneOff className="w-7 h-7" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
