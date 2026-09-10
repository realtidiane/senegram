import { useEffect, useRef, useState } from "react";
import { ArrowLeft, X, Camera, LogOut } from "lucide-react";
import toast from "react-hot-toast";
import Avatar from "./Avatar";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import PushTest from "./PushTest";

export default function ProfileModal({ onClose }) {
  const { user, updateProfile, logout } = useAuth();
  const [display, setDisplay] = useState(user.display_name || "");
  const [bio, setBio]         = useState(user.bio || "");
  const [phone, setPhone]     = useState(user.phone || "");
  const [busy, setBusy]       = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function save() {
    setBusy(true);
    try {
      await updateProfile({ display_name: display, bio, phone });
      toast.success("Profil mis à jour");
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/upload/avatar", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await updateProfile({ avatar_url: data.avatar_url });
      toast.success("Avatar mis à jour");
    } catch (err) {
      toast.error(err.response?.data?.message || "Upload impossible");
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="card w-full max-w-md max-h-[calc(100vh-24px)] overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-ink-100 bg-white">
          <button onClick={onClose} className="btn-ghost p-2 md:hidden" aria-label="Retour">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h3 className="font-semibold text-ink-900 flex-1 md:flex-none">Mon profil</h3>
          <button onClick={onClose} className="btn-ghost p-2" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto">
          <div className="p-6 flex flex-col items-center">
            <div className="relative">
              <Avatar user={user} size={96} />
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 p-2 rounded-full bg-brand-600 text-white shadow-soft"
              >
                <Camera className="w-4 h-4" />
              </button>
              <input type="file" hidden ref={fileRef} accept="image/*"
                     onChange={(e) => uploadAvatar(e.target.files?.[0])} />
            </div>
            <div className="mt-4 font-semibold text-ink-900">@{user.username}</div>
            <div className="text-xs text-ink-500">{user.email}</div>
          </div>

          <div className="px-6 pb-6 space-y-3">
            <label className="block text-sm text-ink-700">Nom affiché
              <input className="input mt-1" value={display} onChange={(e) => setDisplay(e.target.value)} />
            </label>
            <label className="block text-sm text-ink-700">Bio
              <input className="input mt-1" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={255} />
            </label>
            <label className="block text-sm text-ink-700">Téléphone
              <input className="input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 flex gap-2 p-4 border-t border-ink-100 bg-white">
          <button onClick={logout} className="btn-ghost text-senegal-red flex items-center gap-2">
            <LogOut className="w-4 h-4" /> Déconnexion
          </button>
          <div className="flex-1" />
          <button onClick={onClose}  className="btn-ghost">Annuler</button>
          <button onClick={save}     className="btn-primary" disabled={busy}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
