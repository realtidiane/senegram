const pool = require("../config/db");
const { ensureMember } = require("./conversationController");
const { getTransactionClient, bulkInsert } = require("../config/pg_helpers");

/**
 * Construit la representation complete d'un message :
 *   - attachments
 *   - sender (extrait)
 *
 * Conversion : [[msg]] -> msg (pg.rows[0])
 */
async function hydrateMessage(msgId) {
  const result = await pool.query(
    `SELECT m.*,
            u.username AS sender_username,
            u.display_name AS sender_name,
            u.avatar_url AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = $1`,
    [msgId],
  );
  const msg = result.rows[0];
  if (!msg) return null;
  const attResult = await pool.query(
    `SELECT id, url, file_name, file_size, mime_type, duration, width, height
     FROM attachments WHERE message_id = $1`,
    [msgId],
  );
  return { ...msg, attachments: attResult.rows };
}

exports.list = async (req, res, next) => {
  try {
    const convId = req.params.id;
    const member = await ensureMember(convId, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const before = req.query.before ? Number(req.query.before) : null;
    const limit = Math.min(Number(req.query.limit) || 40, 100);

    const result = await pool.query(
      `SELECT m.*,
              u.username AS sender_username,
              u.display_name AS sender_name,
              u.avatar_url AS sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
         ${before ? "AND m.id < $2" : ""}
       ORDER BY m.id DESC
       LIMIT $${before ? 3 : 2}`,
      before ? [convId, before, limit] : [convId, limit],
    );
    const rows = result.rows;

    // Attachments en batch via ANY($1)
    const ids = rows.map((r) => r.id);
    let attByMsg = {};
    if (ids.length) {
      const attResult = await pool.query(
        `SELECT * FROM attachments WHERE message_id = ANY($1::bigint[])`,
        [ids],
      );
      attByMsg = attResult.rows.reduce((acc, a) => {
        (acc[a.message_id] = acc[a.message_id] || []).push(a);
        return acc;
      }, {});
    }
    const messages = rows
      .map((m) => ({ ...m, attachments: attByMsg[m.id] || [] }))
      .reverse();

    res.json({ messages });
  } catch (err) { next(err); }
};

exports.send = async (req, res, next) => {
  const conn = await getTransactionClient(pool);
  try {
    const convId = req.params.id;
    const member = await ensureMember(convId, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const {
      content = null,
      type = "text",
      reply_to_id = null,
      attachments = [],
    } = req.body;

    if ((!content || !content.trim()) && (!attachments || !attachments.length)) {
      return conn.release().then(() =>
        res.status(400).json({ message: "Message vide" })
      );
    }

    await conn.beginTransaction();

    // INSERT ... RETURNING id pour recuperer l'ID
    const r = await conn.query(
      `INSERT INTO messages (conversation_id, sender_id, content, type, reply_to_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [convId, req.user.id, content, type, reply_to_id],
    );
    const msgId = r.insertId;

    if (Array.isArray(attachments) && attachments.length) {
      const rows = attachments.map((a) => [
        msgId,
        a.url,
        a.file_name || "fichier",
        a.file_size || 0,
        a.mime_type || "application/octet-stream",
        a.duration || null,
        a.width    || null,
        a.height   || null,
      ]);
      // Bulk insert : convertir VALUES ? en multi-VALUES
      const bulk = bulkInsert(
        `INSERT INTO attachments
           (message_id, url, file_name, file_size, mime_type, duration, width, height)
         VALUES ?`,
        rows,
      );
      await conn.query(bulk.sql, bulk.params);
    }

    // UPDATE conversation.updated_at (pas necessaire en PostgreSQL grace au trigger)
    // Mais on garde la coherence avec l'ancien code (le trigger le fera aussi)
    await conn.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [convId],
    );
    await conn.commit();

    const full = await hydrateMessage(msgId);

    // Broadcast via socket.io
    const io = req.app.get("io");
    io.to(`conv:${convId}`).emit("message:new", full);

    res.status(201).json({ message: full });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    try { await conn._rawRelease(); } catch (_) {}
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`SELECT * FROM messages WHERE id = $1`, [id]);
    const msg = result.rows[0];
    if (!msg) return res.status(404).json({ message: "Message introuvable" });
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ message: "Non autorise" });
    }
    await pool.query(
      `UPDATE messages SET is_deleted = 1, content = NULL WHERE id = $1`,
      [id],
    );
    const io = req.app.get("io");
    io.to(`conv:${msg.conversation_id}`).emit("message:deleted", {
      id: Number(id),
      conversation_id: msg.conversation_id,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.edit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const result = await pool.query(`SELECT * FROM messages WHERE id = $1`, [id]);
    const msg = result.rows[0];
    if (!msg) return res.status(404).json({ message: "Message introuvable" });
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ message: "Non autorise" });
    }
    await pool.query(
      `UPDATE messages SET content = $1, is_edited = 1 WHERE id = $2`,
      [content, id],
    );
    const updated = await hydrateMessage(id);
    const io = req.app.get("io");
    io.to(`conv:${msg.conversation_id}`).emit("message:edited", updated);
    res.json({ message: updated });
  } catch (err) { next(err); }
};

exports.hydrateMessage = hydrateMessage;
