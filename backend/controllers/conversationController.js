const pool = require("../config/db");
const { getTransactionClient, bulkInsert } = require("../config/pg_helpers");

/**
 * Verifie que l'utilisateur courant est membre de la conversation.
 * Conversion : [[row]] -> row (pg.rows[0])
 */
async function ensureMember(convId, userId) {
  const result = await pool.query(
    `SELECT id, role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 LIMIT 1`,
    [convId, userId],
  );
  return result.rows[0] || null;
}

/**
 * Construit l'objet complet "conversation" avec :
 *   - members (array)
 *   - last_message (objet ou null)
 *   - unread_count pour l'utilisateur courant
 */
async function buildConversation(convId, userId) {
  const convResult = await pool.query(
    `SELECT * FROM conversations WHERE id = $1`,
    [convId],
  );
  const conv = convResult.rows[0];
  if (!conv) return null;

  const membersResult = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, u.last_seen,
            cm.role, cm.is_muted, cm.last_read_message_id
     FROM conversation_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = $1`,
    [convId],
  );
  console.log("[buildConversation] Q2 OK");
  const members = membersResult.rows;

  const lastMsgResult = await pool.query(
    `SELECT m.id, m.sender_id, m.content, m.type, m.created_at,
            u.display_name AS sender_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = $1 AND m.is_deleted = FALSE
     ORDER BY m.id DESC LIMIT 1`,
    [convId],
  );
  const lastMsg = lastMsgResult.rows[0] || null;

  // PostgreSQL strict types: cast $1, $2, $3 to BIGINT explicitly
  const unreadResult = await pool.query(
    `SELECT COUNT(*) AS n
     FROM messages m
     LEFT JOIN conversation_members cm
       ON cm.conversation_id = m.conversation_id AND cm.user_id = $1::bigint
     WHERE m.conversation_id = $2::bigint
       AND m.sender_id <> $3::bigint
       AND m.is_deleted = FALSE
       AND (cm.last_read_message_id IS NULL OR m.id > cm.last_read_message_id)`,
    [userId, convId, userId],
  );
  const unread = unreadResult.rows[0];

  return {
    ...conv,
    members,
    last_message: lastMsg,
    unread_count: unread ? Number(unread.n) : 0,
  };
}

exports.list = async (req, res, next) => {
  try {
    // PostgreSQL: ne pas utiliser DISTINCT avec ORDER BY sur une colonne non-SELECT
    // Solution: utiliser DISTINCT ON ou sous-requete
    const result = await pool.query(
      `SELECT c.id, c.updated_at
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = $1
       GROUP BY c.id, c.updated_at
       ORDER BY c.updated_at DESC`,
      [req.user.id],
    );
    const rows = result.rows;
    const out = [];
    for (const r of rows) {
      const full = await buildConversation(r.id, req.user.id);
      if (full) out.push(full);
    }
    out.sort((a, b) => {
      const ai = a.last_message?.id || 0;
      const bi = b.last_message?.id || 0;
      return bi - ai;
    });
    res.json({ conversations: out });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const member = await ensureMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });
    res.json({ conversation: await buildConversation(req.params.id, req.user.id) });
  } catch (err) { next(err); }
};

/**
 * Ouvre (ou cree) une conversation privee 1-1 avec other_user_id.
 */
exports.openPrivate = async (req, res, next) => {
  console.log('[openPrivate] START');
  const conn = await getTransactionClient(pool);
  console.log('[openPrivate] Got client');
  try {
    const other = Number(req.body.other_user_id);
    console.log('[openPrivate] other =', other);
    if (!other || other === req.user.id) {
      return conn._rawRelease().then(() =>
        res.status(400).json({ message: "other_user_id invalide" })
      );
    }

    const targetResult = await conn.query("SELECT id FROM users WHERE id = $1", [other]);
    if (!targetResult.rows[0]) {
      return conn._rawRelease().then(() =>
        res.status(404).json({ message: "Destinataire introuvable" })
      );
    }

    const existingResult = await conn.query(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
       JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
       WHERE c.type = 'private'
       LIMIT 1`,
      [req.user.id, other],
    );
    if (existingResult.rows.length) {
      await conn._rawRelease();
      return res.json({ conversation: await buildConversation(existingResult.rows[0].id, req.user.id) });
    }

    await conn.beginTransaction();
    const r = await conn.query(
      `INSERT INTO conversations (type, created_by) VALUES ('private', $1) RETURNING id`,
      [req.user.id],
    );
    const convId = r.insertId;
    // Multi-VALUES pour inserer 2 membres
    await conn.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1, $2, 'member'), ($3, $4, 'member')`,
      [convId, req.user.id, convId, other],
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

exports.markRead = async (req, res, next) => {
  try {
    const member = await ensureMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const lastResult = await pool.query(
      `SELECT MAX(id) AS id FROM messages WHERE conversation_id = $1`,
      [req.params.id],
    );
    const last = lastResult.rows[0];
    if (last && last.id) {
      await pool.query(
        `UPDATE conversation_members
         SET last_read_message_id = $1
         WHERE conversation_id = $2 AND user_id = $3`,
        [last.id, req.params.id, req.user.id],
      );
    }
    res.json({ ok: true, last_read_message_id: last ? last.id : null });
  } catch (err) { next(err); }
};

exports.buildConversation = buildConversation;
exports.ensureMember      = ensureMember;
