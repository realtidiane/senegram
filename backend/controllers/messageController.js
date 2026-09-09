const pool = require("../config/db");
const { getTransactionClient, bulkInsert } = require("../config/pg_helpers");
const { ensureMember } = require("./conversationController");
const pushController = require("./pushController");

const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "🔥"]);

/**
 * Construit la representation complete d'un message :
 *   - attachments
 *   - reactions
 *   - sender (extrait)
 *   - reply_to (extrait)
 *
 * Conversion: [[msg]] -> msg (pg.rows[0])
 */
async function hydrateMessage(msgId) {
  const result = await pool.query(
    `SELECT m.*,
            rm.content AS reply_content,
            rm.type AS reply_type,
            ru.username AS reply_sender_username,
            ru.display_name AS reply_sender_name,
            u.username AS sender_username,
            u.display_name AS sender_name,
            u.avatar_url AS sender_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     LEFT JOIN messages rm ON rm.id = m.reply_to_id
     LEFT JOIN users ru ON ru.id = rm.sender_id
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

  const reactResult = await pool.query(
    `SELECT mr.id, mr.message_id, mr.user_id, mr.reaction, mr.created_at,
            u.username, u.display_name
     FROM message_reactions mr
     JOIN users u ON u.id = mr.user_id
     WHERE mr.message_id = $1
     ORDER BY mr.created_at ASC`,
    [msgId],
  );

  return { ...msg, attachments: attResult.rows, reactions: reactResult.rows };
}

async function hydrateManyMessages(rows) {
  const ids = rows.map((r) => r.id);
  let attByMsg = {};
  let reactByMsg = {};

  if (ids.length) {
    // ANY($1::bigint[]) au lieu de IN (?)
    const attResult = await pool.query(
      `SELECT * FROM attachments WHERE message_id = ANY($1::bigint[])`,
      [ids],
    );
    attByMsg = attResult.rows.reduce((acc, a) => {
      (acc[a.message_id] = acc[a.message_id] || []).push(a);
      return acc;
    }, {});

    const reactResult = await pool.query(
      `SELECT mr.id, mr.message_id, mr.user_id, mr.reaction, mr.created_at,
              u.username, u.display_name
       FROM message_reactions mr
       JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ANY($1::bigint[])
       ORDER BY mr.created_at ASC`,
      [ids],
    );
    reactByMsg = reactResult.rows.reduce((acc, r) => {
      (acc[r.message_id] = acc[r.message_id] || []).push(r);
      return acc;
    }, {});
  }

  return rows.map((m) => ({
    ...m,
    attachments: attByMsg[m.id] || [],
    reactions: reactByMsg[m.id] || [],
  }));
}

async function updateReadTimestamps(conn, conversationId) {
  await conn.query(
    `UPDATE messages m
     SET read_at = NOW()
     WHERE m.conversation_id = $1
       AND m.read_at IS NULL
       AND m.is_deleted = FALSE
       AND NOT EXISTS (
         SELECT 1
         FROM conversation_members cm
         WHERE cm.conversation_id = m.conversation_id
           AND cm.user_id <> m.sender_id
           AND NOT EXISTS (
             SELECT 1
             FROM message_reads mr
             WHERE mr.message_id = m.id AND mr.user_id = cm.user_id
           )
       )`,
    [conversationId],
  );
}

async function markConversationRead(conversationId, userId) {
  const conn = await getTransactionClient(pool);
  try {
    await conn.beginTransaction();
    const lastResult = await conn.query(
      `SELECT MAX(id) AS id FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    const last = lastResult.rows[0];

    if (last && last.id) {
      await conn.query(
        `UPDATE conversation_members
         SET last_read_message_id = $1
         WHERE conversation_id = $2 AND user_id = $3`,
        [last.id, conversationId, userId],
      );
      await conn.query(
        `INSERT INTO message_reads (message_id, user_id)
         SELECT id, $1
         FROM messages
         WHERE conversation_id = $2
           AND sender_id <> $3
           AND is_deleted = FALSE
           AND id <= $4
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [userId, conversationId, userId, last.id],
      );
      await conn.query(
        `UPDATE messages
         SET delivered_at = COALESCE(delivered_at, NOW())
         WHERE conversation_id = $1
           AND sender_id <> $2
           AND delivered_at IS NULL
           AND is_deleted = FALSE
           AND id <= $3`,
        [conversationId, userId, last.id],
      );
      await updateReadTimestamps(conn, conversationId);
    }

    await conn.commit();
    return last && last.id ? last.id : null;
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    try { await conn._rawRelease(); } catch (_) {}
  }
}

exports.list = async (req, res, next) => {
  try {
    const convId = req.params.id;
    const member = await ensureMember(convId, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const before = req.query.before ? Number(req.query.before) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const result = await pool.query(
      `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.type,
              m.reply_to_id, m.is_edited, m.is_deleted, m.created_at,
              m.sent_at, m.delivered_at, m.read_at, m.is_pinned, m.pinned_by, m.pinned_at,
              u.username AS sender_username, u.display_name AS sender_name,
              u.avatar_url AS sender_avatar,
              rm.content AS reply_content, rm.type AS reply_type,
              ru.username AS reply_sender_username, ru.display_name AS reply_sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages rm ON rm.id = m.reply_to_id
       LEFT JOIN users ru ON ru.id = rm.sender_id
       WHERE m.conversation_id = $1
         AND m.is_deleted = FALSE
         ${before ? "AND m.id < $2" : ""}
       ORDER BY m.id DESC
       LIMIT $${before ? 3 : 2}`,
      before ? [convId, before, limit] : [convId, limit],
    );

    const messages = (await hydrateManyMessages(result.rows)).reverse();
    res.json({ messages });
  } catch (err) { next(err); }
};

exports.search = async (req, res, next) => {
  try {
    const convId = req.params.id;
    const member = await ensureMember(convId, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const q = String(req.query.q || "").trim();
    const filter = ["all", "messages", "photos", "media"].includes(req.query.filter)
      ? req.query.filter
      : "all";
    const limit = Math.min(Number(req.query.limit) || 60, 100);
    const where = ["m.conversation_id = $1", "m.is_deleted = FALSE"];
    const params = [convId];
    const like = `%${q}%`;

    if (filter === "messages") {
      where.push("m.content LIKE $2");
      params.push(like);
    } else if (filter === "photos") {
      where.push(`EXISTS (
        SELECT 1 FROM attachments a
        WHERE a.message_id = m.id AND a.mime_type LIKE 'image/%'
          ${q ? "AND (a.file_name LIKE $3 OR m.content LIKE $4)" : ""}
      )`);
      if (q) params.push(like, like);
    } else if (filter === "media") {
      where.push(`EXISTS (
        SELECT 1 FROM attachments a
        WHERE a.message_id = m.id
          AND (a.mime_type LIKE 'image/%' OR a.mime_type LIKE 'video/%' OR a.mime_type LIKE 'audio/%')
          ${q ? "AND (a.file_name LIKE $3 OR m.content LIKE $4)" : ""}
      )`);
      if (q) params.push(like, like);
    } else if (q) {
      where.push(`(
        m.content LIKE $2
        OR EXISTS (
          SELECT 1 FROM attachments a
          WHERE a.message_id = m.id AND a.file_name LIKE $3
        )
      )`);
      params.push(like, like);
    }

    const limitParam = `$${params.length + 1}`;
    const result = await pool.query(
      `SELECT m.*,
              rm.content AS reply_content,
              rm.type AS reply_type,
              ru.username AS reply_sender_username,
              ru.display_name AS reply_sender_name,
              u.username AS sender_username,
              u.display_name AS sender_name,
              u.avatar_url AS sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages rm ON rm.id = m.reply_to_id
       LEFT JOIN users ru ON ru.id = rm.sender_id
       WHERE ${where.join(" AND ")}
       ORDER BY m.id DESC
       LIMIT ${limitParam}`,
      [...params, limit],
    );

    const messages = await hydrateManyMessages(result.rows);
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
      return conn._rawRelease().then(() =>
        res.status(400).json({ message: "Message vide" })
      );
    }
    if (Array.isArray(attachments) && attachments.some((a) => !a?.url)) {
      return conn._rawRelease().then(() =>
        res.status(400).json({ message: "Fichier invalide : URL manquante" })
      );
    }

    await conn.beginTransaction();
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
      const bulk = bulkInsert(
        `INSERT INTO attachments
           (message_id, url, file_name, file_size, mime_type, duration, width, height)
         VALUES ?`,
        rows,
      );
      await conn.query(bulk.sql, bulk.params);
    }

    await conn.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [convId],
    );
    await conn.commit();
    await conn._rawRelease();

    const io = req.app.get("io");
    const membersResult = await pool.query(
      `SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2`,
      [convId, req.user.id],
    );
    const members = membersResult.rows;

    const hasOnlineRecipient = members.some((m) =>
      io.onlineUsers?.has(Number(m.user_id))
    );
    if (hasOnlineRecipient) {
      await pool.query(
        `UPDATE messages SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = $1`,
        [msgId],
      );
    }

    const full = await hydrateMessage(msgId);
    io.to(`conv:${convId}`).emit("message_sent", full);
    io.to(`conv:${convId}`).emit("message:new", full);
    if (full.delivered_at) {
      io.to(`conv:${convId}`).emit("message_delivered", {
        conversation_id: Number(convId),
        message_id: msgId,
        delivered_at: full.delivered_at,
      });
    }

    // Push notifications aux membres hors ligne
    const offlineMemberIds = members
      .filter((m) => !io.onlineUsers?.has(Number(m.user_id)))
      .map((m) => m.user_id);
    if (offlineMemberIds.length && pushController.sendToUser) {
      const payload = {
        title: req.user.display_name || req.user.username,
        body: type === "text" ? content : `[${type}]`,
        icon: "/icons/icon-192.svg",
        badge: "/icons/badge-72.svg",
        tag: `msg-${convId}`,
        data: {
          url: `/conversation/${convId}`,
          conversation_id: Number(convId),
          message_id: msgId,
        },
        requireInteraction: true,
      };
      // Envoi parallele (fire-and-forget)
      Promise.all(
        offlineMemberIds.map((uid) =>
          pushController.sendToUser(uid, payload).catch((err) =>
            console.error(`Push send error for ${uid}:`, err)
          )
        )
      );
    }

    res.status(201).json({ message: full });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    try { await conn._rawRelease(); } catch (_) {}
    next(err);
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
      `UPDATE messages SET is_deleted = TRUE, content = NULL WHERE id = $1`,
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
      `UPDATE messages SET content = $1, is_edited = TRUE WHERE id = $2`,
      [content, id],
    );
    const updated = await hydrateMessage(id);
    const io = req.app.get("io");
    io.to(`conv:${msg.conversation_id}`).emit("message:edited", updated);
    res.json({ message: updated });
  } catch (err) { next(err); }
};

exports.markRead = async (req, res, next) => {
  try {
    const convId = req.params.id;
    const member = await ensureMember(convId, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const lastMessageId = await markConversationRead(convId, req.user.id);
    const io = req.app.get("io");
    io.to(`conv:${convId}`).emit("message:read", {
      conversation_id: Number(convId),
      user_id: req.user.id,
      last_message_id: lastMessageId,
    });

    res.json({ ok: true, last_read_message_id: lastMessageId });
  } catch (err) { next(err); }
};

exports.pin = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.*, cm.role
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
       WHERE m.id = $2 AND c.type = 'group'`,
      [req.user.id, req.params.id],
    );
    const msg = result.rows[0];
    if (!msg) return res.status(404).json({ message: "Message de groupe introuvable" });
    if (!["owner", "admin"].includes(msg.role)) return res.status(403).json({ message: "Admin requis" });

    await pool.query(
      `UPDATE messages SET is_pinned = TRUE, pinned_by = $1, pinned_at = NOW() WHERE id = $2`,
      [req.user.id, req.params.id],
    );
    const full = await hydrateMessage(req.params.id);
    req.app.get("io").to(`conv:${msg.conversation_id}`).emit("message_pinned", full);
    res.json({ message: full });
  } catch (err) { next(err); }
};

exports.unpin = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.*, cm.role
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
       WHERE m.id = $2 AND c.type = 'group'`,
      [req.user.id, req.params.id],
    );
    const msg = result.rows[0];
    if (!msg) return res.status(404).json({ message: "Message de groupe introuvable" });
    if (!["owner", "admin"].includes(msg.role)) return res.status(403).json({ message: "Admin requis" });

    await pool.query(
      `UPDATE messages SET is_pinned = FALSE, pinned_by = NULL, pinned_at = NULL WHERE id = $1`,
      [req.params.id],
    );
    req.app.get("io").to(`conv:${msg.conversation_id}`).emit("message_unpinned", {
      id: Number(req.params.id),
      conversation_id: msg.conversation_id,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.react = async (req, res, next) => {
  try {
    const reaction = req.body.reaction;
    if (!ALLOWED_REACTIONS.has(reaction)) {
      return res.status(400).json({ message: "Reaction invalide" });
    }
    const result = await pool.query(`SELECT * FROM messages WHERE id = $1`, [req.params.id]);
    const msg = result.rows[0];
    if (!msg) return res.status(404).json({ message: "Message introuvable" });
    const member = await ensureMember(msg.conversation_id, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const existingResult = await pool.query(
      `SELECT reaction FROM message_reactions WHERE message_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    const existing = existingResult.rows[0];

    await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, reaction)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id) DO UPDATE
         SET reaction = EXCLUDED.reaction, created_at = NOW()`,
      [req.params.id, req.user.id, reaction],
    );
    const full = await hydrateMessage(req.params.id);
    req.app.get("io").to(`conv:${msg.conversation_id}`).emit(
      existing ? "reaction_updated" : "reaction_added",
      { message: full, user_id: req.user.id, reaction },
    );
    res.json({ message: full });
  } catch (err) { next(err); }
};

exports.removeReaction = async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT * FROM messages WHERE id = $1`, [req.params.id]);
    const msg = result.rows[0];
    if (!msg) return res.status(404).json({ message: "Message introuvable" });
    const member = await ensureMember(msg.conversation_id, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    await pool.query(
      `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    const full = await hydrateMessage(req.params.id);
    req.app.get("io").to(`conv:${msg.conversation_id}`).emit("reaction_removed", {
      message: full,
      user_id: req.user.id,
    });
    res.json({ message: full });
  } catch (err) { next(err); }
};

exports.hydrateMessage = hydrateMessage;
exports.markConversationRead = markConversationRead;
