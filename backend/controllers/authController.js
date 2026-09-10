const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const pool   = require("../config/db");
const weakPasswords = require("../config/weak_passwords");

// Helper: set JWT in httpOnly cookie (XSS-safe)
function setAuthCookie(res, token) {
  res.cookie("senegram_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookie(res) {
  res.clearCookie("senegram_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );
}

function publicUser(u) {
  return {
    id:           u.id,
    username:     u.username,
    email:        u.email,
    display_name: u.display_name,
    avatar_url:   u.avatar_url,
    bio:          u.bio,
    phone:        u.phone,
    status:       u.status,
    last_seen:    u.last_seen,
    created_at:   u.created_at,
  };
}

exports.register = async (req, res, next) => {
  try {
    const { username, email, password, display_name, phone } = req.body;

    if (!username || !email || !password || !display_name) {
      return res.status(400).json({ message: "Champs requis: username, email, password, display_name" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Mot de passe trop court (min 6)" });
    }
    if (password.length > 128) {
      return res.status(400).json({ message: "Mot de passe trop long (max 128)" });
    }
    if (weakPasswords.has(password.toLowerCase())) {
      return res.status(400).json({
        message: "Mot de passe trop commun. Choisissez un mot de passe plus securise",
      });
    }
    const categories = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /[0-9]/.test(password),
      /[^a-zA-Z0-9]/.test(password),
    ].filter(Boolean).length;
    if (categories < 2 && password.length < 12) {
      return res.status(400).json({
        message: "Mot de passe faible. Utilisez au moins 2 categories ou 12+ caracteres",
      });
    }

    // PostgreSQL: LOWER() pour case-insensitive search (username/email stockes en lowercase)
    const checkResult = await pool.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1`,
      [username, email],
    );
    if (checkResult.rows.length) {
      return res.status(409).json({ message: "Username ou email deja utilise" });
    }

    const hash = await bcrypt.hash(password, 10);
    // RETURNING id pour recuperer le nouvel ID
    const insertResult = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [username.toLowerCase(), email.toLowerCase(), hash, display_name, phone || null],
    );
    const newId = insertResult.insertId;

    const userResult = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [newId],
    );
    const user = userResult.rows[0];

    const token = signToken(user);
    setAuthCookie(res, token);
    res.status(201).json({
      token,
      user:  publicUser(user),
    });
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;   // identifier = username OU email
    if (!identifier || !password) {
      return res.status(400).json({ message: "identifier & password requis" });
    }

    const userResult = await pool.query(
      `SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1`,
      [identifier, identifier],
    );
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ message: "Identifiants invalides" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Identifiants invalides" });

    await pool.query(
      `UPDATE users SET status = 'online', last_seen = NOW() WHERE id = $1`,
      [user.id],
    );

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({
      token,
      user:  publicUser({ ...user, status: "online" }),
    });
  } catch (err) { next(err); }
};

exports.me = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [req.user.id],
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
};

exports.logout = async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE users SET status = 'offline', last_seen = NOW() WHERE id = $1`,
      [req.user.id],
    );
    clearAuthCookie(res);
    res.json({ ok: true });
  } catch (err) { next(err); }
};
