const pool = require("../config/db");
const { buildConversation, ensureMember } = require("./conversationController");
const { getTransactionClient, bulkInsert } = require("../config/pg_helpers");

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
    // Bulk insert avec multi-VALUES
    const bulk = bulkInsert(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ?`,
      rows,
    );
    await conn.query(bulk.sql, bulk.params);

    // Message systeme
    await conn.query(
      `INSERT INTO messages (conversation_id, sender_id, content, type)
       VALUES ($1, $2, $3, 'system')`,
      [convId, req.user.id, `Groupe "${name}" cree`],
    );

    await conn.commit();
    await conn._rawRelease();
    res.status(201).json({ conversation: await buildConversation(convId, req.user.id) });
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
    res.json({ conversation: await buildConversation(req.params.id, req.user.id) });
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
    // INSERT ... ON CONFLICT (equivalent MySQL INSERT IGNORE)
    const bulk = bulkInsert(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ?
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      rows,
    );
    await pool.query(bulk.sql, bulk.params);
    res.json({ conversation: await buildConversation(req.params.id, req.user.id) });
  } catch (err) { next(err); }
};

exports.removeMember = async (req, res, next) => {
  try {
    const self = req.user.id === Number(req.params.userId);
    if (!self && !(await isGroupAdmin(req.params.id, req.user.id))) {
      return res.status(403).json({ message: "Admin requis" });
    }
    await pool.query(
      `DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId],
    );
    res.json({ ok: true });
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
