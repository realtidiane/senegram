const pool = require("../config/db");
const { getTransactionClient, bulkInsert } = require("../config/pg_helpers");
const { buildConversation, ensureMember } = require("./conversationController");

async function isGroupAdmin(convId, userId) {
  const result = await pool.query(
    `SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId],
  );
  const row = result.rows[0];
  return row && (row.role === "owner" || row.role === "admin");
}

exports.create = async (req, res, next) => {
  const conn = await getTransactionClient(pool);
  try {
    const { name, description, avatar_url, member_ids = [] } = req.body;
    if (!name || !name.trim()) {
      return conn._rawRelease().then(() =>
        res.status(400).json({ message: "name requis" })
      );
    }

    const members = Array.from(new Set([...member_ids, req.user.id].map(Number)));
    if (members.length < 2) {
      return conn._rawRelease().then(() =>
        res.status(400).json({ message: "Au moins 1 autre membre requis" })
      );
    }

    await conn.beginTransaction();
    const r = await conn.query(
      `INSERT INTO conversations (type, name, description, avatar_url, created_by)
       VALUES ('group', $1, $2, $3, $4)
       RETURNING id`,
      [name.trim(), description || null, avatar_url || null, req.user.id],
    );
    const convId = r.insertId;

    const rows = members.map((uid) => [convId, uid, uid === req.user.id ? "owner" : "member"]);
    const bulk = bulkInsert(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ?`,
      rows,
    );
    await conn.query(bulk.sql, bulk.params);

    await conn.query(
      `INSERT INTO messages (conversation_id, sender_id, content, type)
       VALUES ($1, $2, $3, 'system')`,
      [convId, req.user.id, `Groupe "${name}" cree`],
    );

    await conn.commit();
    await conn._rawRelease();

    const conversation = await buildConversation(convId, req.user.id);
    const io = req.app.get("io");
    members
      .filter((uid) => uid !== req.user.id)
      .forEach((uid) => io.to(`user:${uid}`).emit("group:added", { conversation }));

    res.status(201).json({ conversation });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    try { await conn._rawRelease(); } catch (_) {}
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    if (!(await isGroupAdmin(req.params.id, req.user.id))) {
      return res.status(403).json({ message: "Admin requis" });
    }
    const { name, description, avatar_url } = req.body;
    await pool.query(
      `UPDATE conversations
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           avatar_url = COALESCE($3, avatar_url)
       WHERE id = $4 AND type = 'group'`,
      [name || null, description || null, avatar_url || null, req.params.id],
    );
    const conversation = await buildConversation(req.params.id, req.user.id);
    req.app.get("io").to(`conv:${req.params.id}`).emit("group:updated", { conversation });
    res.json({ conversation });
  } catch (err) { next(err); }
};

exports.addMembers = async (req, res, next) => {
  try {
    if (!(await isGroupAdmin(req.params.id, req.user.id))) {
      return res.status(403).json({ message: "Admin requis" });
    }
    const ids = (req.body.member_ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ message: "member_ids vide" });

    const rows = ids.map((uid) => [req.params.id, uid, "member"]);
    const bulk = bulkInsert(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ?
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      rows,
    );
    await pool.query(bulk.sql, bulk.params);

    const conversation = await buildConversation(req.params.id, req.user.id);
    const io = req.app.get("io");
    ids.forEach((uid) => io.to(`user:${uid}`).emit("group:added", { conversation }));
    io.to(`conv:${req.params.id}`).emit("group:updated", { conversation });
    res.json({ conversation });
  } catch (err) { next(err); }
};

exports.removeMember = async (req, res, next) => {
  try {
    const self = req.user.id === Number(req.params.userId);
    if (!self && !(await isGroupAdmin(req.params.id, req.user.id))) {
      return res.status(403).json({ message: "Admin requis" });
    }
    const targetResult = await pool.query(
      `SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId],
    );
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ message: "Membre introuvable" });
    if (target.role === "owner") {
      return res.status(403).json({ message: "Impossible de retirer le proprietaire du groupe" });
    }

    await pool.query(
      `DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId],
    );
    const conversation = await buildConversation(req.params.id, req.user.id);
    const io = req.app.get("io");
    const removedUserId = Number(req.params.userId);
    io.to(`user:${removedUserId}`).emit("group:removed", {
      conversation_id: Number(req.params.id),
    });
    io.to(`conv:${req.params.id}`).emit("group:updated", { conversation });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.updateMemberRole = async (req, res, next) => {
  try {
    if (!(await isGroupAdmin(req.params.id, req.user.id))) {
      return res.status(403).json({ message: "Admin requis" });
    }
    const role = req.body.role;
    if (!["admin", "member"].includes(role)) {
      return res.status(400).json({ message: "Role invalide" });
    }
    if (Number(req.params.userId) === req.user.id) {
      return res.status(400).json({ message: "Impossible de modifier son propre role" });
    }

    const targetResult = await pool.query(
      `SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId],
    );
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ message: "Membre introuvable" });
    if (target.role === "owner") {
      return res.status(403).json({ message: "Impossible de modifier le proprietaire" });
    }

    await pool.query(
      `UPDATE conversation_members SET role = $1 WHERE conversation_id = $2 AND user_id = $3`,
      [role, req.params.id, req.params.userId],
    );
    const conversation = await buildConversation(req.params.id, req.user.id);
    req.app.get("io").to(`conv:${req.params.id}`).emit("group:updated", { conversation });
    res.json({ conversation });
  } catch (err) { next(err); }
};

exports.leave = async (req, res, next) => {
  try {
    const member = await ensureMember(req.params.id, req.user.id);
    if (!member) return res.status(404).json({ message: "Non membre" });
    await pool.query(
      `DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    if (!(await isGroupAdmin(req.params.id, req.user.id))) {
      return res.status(403).json({ message: "Admin requis" });
    }
    const convResult = await pool.query(
      `SELECT id, type FROM conversations WHERE id = $1`,
      [req.params.id],
    );
    const conv = convResult.rows[0];
    if (!conv || conv.type !== "group") {
      return res.status(404).json({ message: "Groupe introuvable" });
    }

    const io = req.app.get("io");
    io.to(`conv:${req.params.id}`).emit("group:deleted", {
      conversation_id: Number(req.params.id),
    });
    await pool.query(`DELETE FROM conversations WHERE id = $1 AND type = 'group'`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.isGroupAdmin = isGroupAdmin;
