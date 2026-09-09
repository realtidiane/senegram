const bcrypt = require("bcryptjs");
const pool = require("../config/db");

const SELECT_PUBLIC = `
  id, username, email, display_name, avatar_url, bio, phone, status, is_online, last_seen, created_at
`;

exports.search = async (req, res, next) => {
  try {
    const q = `%${(req.query.q || "").toLowerCase()}%`;
    const result = await pool.query(
      `SELECT ${SELECT_PUBLIC}
       FROM users
       WHERE (LOWER(username) LIKE $1 OR LOWER(display_name) LIKE $1 OR LOWER(email) LIKE $1)
         AND id <> $2
       ORDER BY display_name
       LIMIT 25`,
      [q, req.user.id],
    );
    res.json({ users: result.rows });
  } catch (err) { next(err); }
};

exports.getById = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_PUBLIC} FROM users WHERE id = $1`,
      [req.params.id],
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    res.json({ user });
  } catch (err) { next(err); }
};

exports.updateMe = async (req, res, next) => {
  try {
    const { display_name, bio, phone, avatar_url } = req.body;
    await pool.query(
      `UPDATE users
       SET display_name = COALESCE($1, display_name),
           bio          = COALESCE($2, bio),
           phone        = COALESCE($3, phone),
           avatar_url   = COALESCE($4, avatar_url)
       WHERE id = $5`,
      [display_name || null, bio || null, phone || null, avatar_url || null, req.user.id],
    );
    const result = await pool.query(
      `SELECT ${SELECT_PUBLIC} FROM users WHERE id = $1`,
      [req.user.id],
    );
    res.json({ user: result.rows[0] });
  } catch (err) { next(err); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password || new_password.length < 6) {
      return res.status(400).json({ message: "Mot de passe invalide (min 6)" });
    }
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = result.rows[0];
    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Mot de passe actuel incorrect" });

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.listContacts = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.status, u.last_seen
       FROM contacts c
       JOIN users u ON u.id = c.contact_user_id
       WHERE c.user_id = $1 AND c.is_blocked = 0
       ORDER BY u.display_name`,
      [req.user.id],
    );
    res.json({ contacts: result.rows });
  } catch (err) { next(err); }
};

exports.addContact = async (req, res, next) => {
  try {
    const contactUserId = Number(req.params.id);
    if (contactUserId === req.user.id) {
      return res.status(400).json({ message: "Impossible de s'ajouter soi-meme" });
    }
    const targetResult = await pool.query("SELECT id FROM users WHERE id = $1", [contactUserId]);
    if (!targetResult.rows[0]) return res.status(404).json({ message: "Utilisateur introuvable" });

    // ON CONFLICT DO NOTHING = equivalent MySQL INSERT IGNORE
    await pool.query(
      `INSERT INTO contacts (user_id, contact_user_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, contact_user_id) DO NOTHING`,
      [req.user.id, contactUserId],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.updateContact = async (req, res, next) => {
  try {
    const contactUserId = Number(req.params.id);
    if (contactUserId === req.user.id) {
      return res.status(400).json({ message: "Contact invalide" });
    }
    const alias = typeof req.body.alias === "string" ? req.body.alias.trim() : null;
    // ON CONFLICT DO UPDATE = equivalent MySQL ON DUPLICATE KEY UPDATE
    await pool.query(
      `INSERT INTO contacts (user_id, contact_user_id, alias)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, contact_user_id) DO UPDATE
         SET alias = EXCLUDED.alias`,
      [req.user.id, contactUserId, alias || null],
    );
    res.json({ ok: true, alias: alias || null });
  } catch (err) { next(err); }
};

exports.removeContact = async (req, res, next) => {
  try {
    await pool.query(
      `DELETE FROM contacts WHERE user_id = $1 AND contact_user_id = $2`,
      [req.user.id, req.params.id],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};
