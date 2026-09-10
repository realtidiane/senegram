import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useSocket } from "./useSocket";
import { useAuth }   from "./AuthContext";
import { buildIceServers, getMediaStream, stopStream } from "../utils/webrtc";
import { notifyUser } from "../utils/notifications";

const CallContext = createContext(null);
export const useCall = () => useContext(CallContext);

function sessionDescription(desc) {
  if (!desc?.type || !desc?.sdp) throw new Error("Description WebRTC invalide");
  return new RTCSessionDescription({ type: desc.type, sdp: desc.sdp });
}

function iceCandidate(candidate) {
  return candidate instanceof RTCIceCandidate ? candidate : new RTCIceCandidate(candidate);
}

function callErrorMessage(err, fallback) {
  if (err?.name === "NotAllowedError") return "Autorise la caméra et le micro pour répondre";
  if (err?.name === "NotFoundError") return "Caméra ou micro introuvable";
  if (err?.name === "NotReadableError") return "Caméra ou micro déjà utilisé par une autre application";
  if (err?.name === "OverconstrainedError") return "Caméra incompatible avec les contraintes demandées";
  return fallback;
}

/**
 * Gère tout le cycle de vie d'un appel 1-1 (audio ou vidéo) :
 *   - startCall(peer, type)
 *   - answerCall() / rejectCall()
 *   - endCall()
 *
 * Expose les streams local et distant pour que l'UI les peigne dans
 * <video>.srcObject.
 */
export function CallProvider({ children }) {
  const { socket } = useSocket();
  const { user }   = useAuth();

  const [call, setCall] = useState(null);
  /**
   * call = {
   *   id, type: 'audio'|'video', direction: 'outgoing'|'incoming',
   *   state: 'ringing'|'ongoing'|'ended',
   *   peer: { id, username, display_name, avatar_url },
   *   conversation_id,
   * }
   */
  const [localStream,  setLocalStream]  = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const pcRef       = useRef(null);
  const offerRef    = useRef(null);    // SDP offer reçu en entrant
  const startedAt   = useRef(null);
  const localRef    = useRef(null);    // local stream (pour cleanup)
  const remoteRef   = useRef(null);
  const closingRef  = useRef(false);
  const answeringRef = useRef(false);
  const facingModeRef = useRef("user");
  const iceQueueRef = useRef([]);      // ICE reçus avant que la PC n'existe

  const cleanup = useCallback(() => {
    closingRef.current = true;
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    stopStream(localRef.current);
    stopStream(remoteRef.current);
    localRef.current = null;
    remoteRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setCall(null);
    offerRef.current = null;
    startedAt.current = null;
    answeringRef.current = false;
    iceQueueRef.current = [];
  }, []);

  const createPeer = useCallback((peerUserId) => {
    closingRef.current = false;
    const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket?.emit("call:ice", { to_user_id: peerUserId, candidate: e.candidate });
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      console.log('[CallContext] ontrack - stream:', stream.id, 'tracks:', stream.getTracks().map(t => `${t.kind}:${t.enabled}`));
      stream.getAudioTracks().forEach(t => { t.enabled = true; console.log('[CallContext] Enabled audio track'); });
      remoteRef.current = stream;
      setRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      if (closingRef.current) return;
      if (pc.connectionState === "connected") {
        setCall((c) => (c ? { ...c, state: "ongoing" } : c));
      }
      if (["failed", "closed"].includes(pc.connectionState)) {
        toast.error("Appel interrompu");
        cleanup();
      }
    };
    pcRef.current = pc;
    return pc;
  }, [socket, cleanup]);

  async function drainIceQueue() {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    while (iceQueueRef.current.length) {
      const c = iceQueueRef.current.shift();
      try { await pc.addIceCandidate(iceCandidate(c)); } catch (err) { console.error(err); }
    }
  }

  // -------- Actions publiques --------
  const startCall = useCallback(async (peer, conversation_id, type = "audio") => {
    if (!socket) return;
    try {
      const stream = await getMediaStream(type === "video", facingModeRef.current);
      localRef.current = stream;
      setLocalStream(stream);

      const pc = createPeer(peer.id);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setCall({
        id: null,
        type,
        direction: "outgoing",
        state: "ringing",
        peer,
        conversation_id,
      });

      socket.emit("call:invite", {
        conversation_id,
        to_user_id: peer.id,
        type,
        sdp_offer: offer,
      });
    } catch (err) {
      console.error(err);
      toast.error(callErrorMessage(err, "Impossible d'accéder à la caméra/micro"));
      cleanup();
    }
  }, [socket, createPeer, cleanup]);

  const answerCall = useCallback(async () => {
    if (!socket || !call || call.direction !== "incoming") return;
    if (answeringRef.current) return;
    answeringRef.current = true;
    setCall((c) => (c ? { ...c, state: "answering" } : c));
    try {
      let stream;
      try {
        stream = await getMediaStream(call.type === "video", facingModeRef.current);
      } catch (err) {
        if (call.type !== "video" || err?.name === "NotAllowedError") throw err;
        toast("Caméra indisponible, réponse en audio seulement");
        stream = await getMediaStream(false);
      }
      localRef.current = stream;
      setLocalStream(stream);

      const pc = createPeer(call.peer.id);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription(sessionDescription(offerRef.current));
      await drainIceQueue();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("call:accept", {
        call_id: call.id,
        to_user_id: call.peer.id,
        sdp_answer: answer,
      });
      startedAt.current = Date.now();
      setCall((c) => ({ ...c, state: "ongoing" }));
    } catch (err) {
      console.error(err);
      toast.error(callErrorMessage(err, "Impossible de répondre à l'appel"));
      cleanup();
    } finally {
      answeringRef.current = false;
    }
  }, [socket, call, createPeer, cleanup]);

  const rejectCall = useCallback(() => {
    if (!socket || !call) return;
    socket.emit("call:reject", { call_id: call.id, to_user_id: call.peer.id });
    cleanup();
  }, [socket, call, cleanup]);

  const endCall = useCallback(() => {
    if (!socket) return cleanup();
    const duration = startedAt.current
      ? Math.round((Date.now() - startedAt.current) / 1000)
      : 0;
    if (call) {
      socket.emit("call:end", {
        call_id: call.id,
        to_user_id: call.peer.id,
        duration,
      });
    }
    cleanup();
  }, [socket, call, cleanup]);

  const switchCamera = useCallback(async () => {
    const pc = pcRef.current;
    const currentStream = localRef.current;
    if (!pc || !currentStream) return;
    const currentTrack = currentStream.getVideoTracks()[0];
    if (!currentTrack) return;

    const nextFacingMode = facingModeRef.current === "user" ? "environment" : "user";
    try {
      const nextStream = await getMediaStream(true, nextFacingMode);
      const nextTrack = nextStream.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (!nextTrack || !sender) {
        stopStream(nextStream);
        return;
      }
      await sender.replaceTrack(nextTrack);
      currentTrack.stop();
      currentStream.getVideoTracks().forEach((track) => currentStream.removeTrack(track));
      currentStream.addTrack(nextTrack);
      nextStream.getAudioTracks().forEach((track) => track.stop());
      facingModeRef.current = nextFacingMode;
      setLocalStream(new MediaStream(currentStream.getTracks()));
    } catch (err) {
      console.error(err);
      toast.error("Impossible de changer de caméra");
    }
  }, []);

  // -------- Réception des events socket --------
  useEffect(() => {
    if (!socket) return;

    const onIncoming = ({ call_id, conversation_id, type, from, sdp_offer }) => {
      if (call) return; // un autre appel est déjà en cours
      offerRef.current = sdp_offer;
      setCall({
        id: call_id,
        type,
        direction: "incoming",
        state: "ringing",
        peer: from,
        conversation_id,
      });
      toast(`📞 Appel ${type === "video" ? "vidéo" : "audio"} de ${from.display_name || from.username}`);
      notifyUser({
        title: `Appel ${type === "video" ? "vidéo" : "audio"} entrant`,
        body: from.display_name || from.username || "Senegram",
        conversationId: conversation_id,
      });
    };

    const onCreated = ({ call_id }) => {
      setCall((c) => (c ? { ...c, id: call_id } : c));
    };

    const onAccepted = async ({ sdp_answer }) => {
      try {
        await pcRef.current?.setRemoteDescription(sessionDescription(sdp_answer));
        await drainIceQueue();
        startedAt.current = Date.now();
        setCall((c) => (c ? { ...c, state: "ongoing" } : c));
      } catch (err) {
        console.error(err);
      }
    };

    const onRejected = () => {
      toast("Appel refusé");
      cleanup();
    };

    const onUnavailable = ({ message }) => {
      toast.error(message || "Utilisateur indisponible");
      cleanup();
    };

    const onIce = async ({ candidate }) => {
      if (!candidate) return;
      if (pcRef.current && pcRef.current.remoteDescription) {
        try { await pcRef.current.addIceCandidate(iceCandidate(candidate)); } catch (err) { console.error(err); }
      } else {
        iceQueueRef.current.push(candidate);
      }
    };

    const onEnded = () => {
      cleanup();
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:created",  onCreated);
    socket.on("call:accepted", onAccepted);
    socket.on("call:rejected", onRejected);
    socket.on("call:unavailable", onUnavailable);
    socket.on("call:ice",      onIce);
    socket.on("call:ended",    onEnded);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:created",  onCreated);
      socket.off("call:accepted", onAccepted);
      socket.off("call:rejected", onRejected);
      socket.off("call:unavailable", onUnavailable);
      socket.off("call:ice",      onIce);
      socket.off("call:ended",    onEnded);
    };
  }, [socket, call, cleanup]);

  // Nettoyage si l'utilisateur se déconnecte
  useEffect(() => { if (!user) cleanup(); }, [user, cleanup]);

  const value = {
    call, localStream, remoteStream,
    startCall, answerCall, rejectCall, endCall, switchCamera,
  };
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
