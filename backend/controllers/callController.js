const pool = require("../config/db");
const { ensureMember } = require("./conversationController");

/** Historique des appels pour une conversation. */
exports.history = async (req, res, next) => {
  try {
    const member = await ensureMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const result = await pool.query(
      `SELECT c.*, u.display_name AS caller_name, u.avatar_url AS caller_avatar
       FROM calls c
       JOIN users u ON u.id = c.caller_id
       WHERE c.conversation_id = $1
       ORDER BY c.started_at DESC
       LIMIT 50`,
      [req.params.id],
    );
    res.json({ calls: result.rows });
  } catch (err) { next(err); }
};

/** Cree un enregistrement d'appel (le signaling est gere via socket). */
exports.start = async (req, res, next) => {
  try {
    const { conversation_id, type = "audio" } = req.body;
    const member = await ensureMember(conversation_id, req.user.id);
    if (!member) return res.status(403).json({ message: "Acces refuse" });

    const r = await pool.query(
      `INSERT INTO calls (conversation_id, caller_id, type, status)
       VALUES ($1, $2, $3, 'ringing')
       RETURNING id`,
      [conversation_id, req.user.id, type],
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
};

/** Termine l'appel (rejet, timeout, raccrochage). */
exports.end = async (req, res, next) => {
  try {
    const { status = "ended", duration = 0 } = req.body;
    await pool.query(
      `UPDATE calls SET status = $1, duration = $2, ended_at = NOW() WHERE id = $3`,
      [status, duration, req.params.id],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};
