import { useEffect, useMemo, useState } from "react";
import { Edit3, Mail, Phone, Search, Shield, ShieldMinus, Trash2, UserPlus, X } from "lucide-react";
import toast from "react-hot-toast";
import Avatar from "./Avatar";
import api from "../services/api";
import { convDisplay } from "../utils/conversation";

export default function ConversationInfoModal({
  conversation,
  currentUser,
  onClose,
  onConversationDeleted,
  onConversationUpdated,
}) {
  const [name, setName] = useState(conversation.name || "");
  const [description, setDescription] = useState(conversation.description || "");
  const [alias, setAlias] = useState("");
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);

  const isGroup = conversation.type === "group";
  const display = useMemo(() => convDisplay(conversation, currentUser), [conversation, currentUser]);
  const currentMember = conversation.members?.find((m) => m.id === currentUser.id);
  const canManage = isGroup && ["owner", "admin"].includes(currentMember?.role);
  const peer = display.peer;

  useEffect(() => {
    setName(conversation.name || "");
    setDescription(conversation.description || "");
    setAlias(peer?.alias || peer?.display_name || "");
  }, [conversation.id, conversation.name, conversation.description, peer?.alias, peer?.display_name]);

  useEffect(() => {
    if (!isGroup || !canManage) return;
    const t = setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(q)}`)
        .then(({ data }) => {
          const memberIds = new Set((conversation.members || []).map((m) => m.id));
          setUsers(data.users.filter((u) => !memberIds.has(u.id)));
        })
        .catch(() => setUsers([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, isGroup, canManage, conversation.members]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function updateConversation(next) {
    onConversationUpdated?.(next);
  }

  async function refreshConversation() {
    const { data } = await api.get(`/conversations/${conversation.id}`);
    updateConversation(data.conversation);
  }

  async function saveGroup() {
    if (!name.trim()) return toast.error("Le nom du groupe est requis");
    setBusy(true);
    try {
      const { data } = await api.patch(`/groups/${conversation.id}`, {
        name: name.trim(),
        description: description.trim() || null,
      });
      updateConversation(data.conversation);
      toast.success("Groupe mis à jour");
    } catch (err) {
      toast.error(err.response?.data?.message || "Modification impossible");
    } finally {
      setBusy(false);
    }
  }

  async function saveAlias() {
    if (!peer) return;
    setBusy(true);
    try {
      await api.patch(`/users/contacts/${peer.id}`, { alias: alias.trim() || null });
      await refreshConversation();
      toast.success("Nom personnalisé enregistré");
    } catch (err) {
      toast.error(err.response?.data?.message || "Modification impossible");
    } finally {
      setBusy(false);
    }
  }

  async function addMember(user) {
    setBusy(true);
    try {
      const { data } = await api.post(`/groups/${conversation.id}/members`, { member_ids: [user.id] });
      updateConversation(data.conversation);
      setQ("");
      toast.success("Membre ajouté");
    } catch (err) {
      toast.error(err.response?.data?.message || "Ajout impossible");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member) {
    setBusy(true);
    try {
      await api.delete(`/groups/${conversation.id}/members/${member.id}`);
      await refreshConversation();
      toast.success("Membre retiré");
    } catch (err) {
      toast.error(err.response?.data?.message || "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  async function setRole(member, role) {
    setBusy(true);
    try {
      const { data } = await api.patch(`/groups/${conversation.id}/members/${member.id}`, { role });
      updateConversation(data.conversation);
      toast.success(role === "admin" ? "Admin nommé" : "Admin retiré");
    } catch (err) {
      toast.error(err.response?.data?.message || "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    const ok = window.confirm(`Supprimer définitivement le groupe "${conversation.name || "Groupe"}" ?`);
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/groups/${conversation.id}`);
      toast.success("Groupe supprimé");
      onConversationDeleted?.(conversation.id);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 sm:p-4" onMouseDown={onClose}>
      <div
        className="card w-full max-w-xl max-h-[calc(100vh-24px)] overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-ink-100 bg-white">
          <div className="font-semibold text-ink-900">{isGroup ? "Infos du groupe" : "Profil"}</div>
          <button type="button" onClick={onClose} className="btn-ghost p-2 rounded-full" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto">
          <div className="p-6 flex flex-col items-center text-center border-b border-ink-100 bg-gradient-to-b from-brand-50/80 to-white">
            <Avatar
              user={{ display_name: display.name, avatar_url: display.avatar_url, username: display.name }}
              size={88}
              online={!isGroup && (peer?.is_online || peer?.status === "online")}
            />
            <div className="mt-3 font-display text-xl font-bold text-ink-900">{display.name}</div>
            <div className="text-sm text-ink-500">{isGroup ? `${conversation.members?.length || 0} membres` : display.subtitle}</div>
            {!isGroup && peer?.bio && (
              <div className="mt-2 text-sm text-ink-700 italic max-w-md mx-auto break-words">
                {peer.bio}
              </div>
            )}
          </div>

          {isGroup ? (
            <div className="p-4 space-y-4">
              <div className="rounded-2xl border border-ink-100 bg-white p-4 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-ink-900">
                  <Edit3 className="w-4 h-4 text-brand-700" />
                  Détails
                </div>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
                <textarea
                  className="input min-h-20 resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description"
                  disabled={!canManage}
                />
                {canManage && (
                  <button type="button" className="btn-primary w-full" onClick={saveGroup} disabled={busy}>
                    Enregistrer
                  </button>
                )}
              </div>

              {canManage && (
                <div className="rounded-2xl border border-ink-100 bg-white p-4 space-y-3">
                  <div className="flex items-center gap-2 font-semibold text-ink-900">
                    <UserPlus className="w-4 h-4 text-brand-700" />
                    Ajouter des membres
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
                    <input className="input pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher..." />
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => addMember(u)}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-ink-50 text-left"
                      >
                        <Avatar user={u} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{u.display_name}</div>
                          <div className="text-xs text-ink-500 truncate">@{u.username}</div>
                        </div>
                        <UserPlus className="w-4 h-4 text-brand-700" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-ink-100 bg-white p-4">
                <div className="font-semibold text-ink-900 mb-3">Membres</div>
                <div className="space-y-1">
                  {(conversation.members || []).map((member) => {
                    const isSelf = member.id === currentUser.id;
                    const isOwner = member.role === "owner";
                    const isAdmin = member.role === "admin" || isOwner;
                    return (
                      <div key={member.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-ink-50">
                        <Avatar user={member} size={38} online={member.is_online || member.status === "online"} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {member.alias || member.display_name}
                            {isSelf ? " (vous)" : ""}
                          </div>
                          <div className="text-xs text-ink-500 truncate">@{member.username} · {isOwner ? "propriétaire" : member.role}</div>
                        </div>
                        {canManage && !isSelf && !isOwner && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-ghost p-2 rounded-full"
                              title={isAdmin ? "Retirer admin" : "Nommer admin"}
                              onClick={() => setRole(member, isAdmin ? "member" : "admin")}
                              disabled={busy}
                            >
                              {isAdmin ? <ShieldMinus className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost p-2 rounded-full text-senegal-red"
                              title="Supprimer du groupe"
                              onClick={() => removeMember(member)}
                              disabled={busy}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {canManage && (
                <div className="rounded-2xl border border-senegal-red/20 bg-senegal-red/5 p-4 space-y-3">
                  <div>
                    <div className="font-semibold text-senegal-red">Zone dangereuse</div>
                    <div className="text-sm text-ink-500">
                      Supprime le groupe, ses membres, ses messages et ses fichiers liés dans la base.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost w-full text-senegal-red hover:bg-senegal-red/10"
                    onClick={deleteGroup}
                    disabled={busy}
                  >
                    <Trash2 className="w-4 h-4" />
                    Supprimer le groupe
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="rounded-2xl border border-ink-100 bg-white p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-ink-900">Nom personnalisé</div>
                  <div className="text-xs text-ink-500">Visible uniquement pour vous.</div>
                </div>
                <input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} />
                <button type="button" className="btn-primary w-full" onClick={saveAlias} disabled={busy}>
                  Enregistrer
                </button>
              </div>

              <div className="rounded-2xl border border-ink-100 bg-white p-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-ink-500">Username</span>
                  <span className="font-medium">@{peer?.username}</span>
                </div>
                <a
                  href={peer?.email ? `mailto:${peer.email}` : undefined}
                  className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2 text-left"
                >
                  <Mail className="w-4 h-4 text-brand-700" />
                  <div className="min-w-0">
                    <div className="text-xs text-ink-500">Email</div>
                    <div className="font-medium truncate">{peer?.email || "Non renseigné"}</div>
                  </div>
                </a>
                <a
                  href={peer?.phone ? `tel:${peer.phone}` : undefined}
                  className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2 text-left"
                >
                  <Phone className="w-4 h-4 text-brand-700" />
                  <div className="min-w-0">
                    <div className="text-xs text-ink-500">Téléphone</div>
                    <div className="font-medium">{peer?.phone || "Non renseigné"}</div>
                  </div>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
