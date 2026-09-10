/**
 * Helpers WebRTC.
 * Les serveurs TURN (si nécessaires) peuvent être ajoutés via variables
 * d'environnement : VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_PASSWORD.
 */
export function buildIceServers() {
  const ice = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ];
  const turn = import.meta.env.VITE_TURN_URL;
  if (turn) {
    ice.push({
      urls: turn,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_PASSWORD,
    });
  }
  return ice;
}

export async function getMediaStream(video, facingMode = "user") {
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: video
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode,
        }
      : false,
  });
}

export function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}
