const jwt = require("jsonwebtoken");

/**
 * Middleware JWT : vérifie l'entête Authorization: Bearer <token>
 * Ajoute req.user = { id (integer), username, email } en cas de succès.
 *
 * Note: PostgreSQL est strict sur les types (BIGINT != TEXT).
 * On force req.user.id à être un Number pour éviter les erreurs SQL.
 */
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Token manquant" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Force id to be an integer (JWT may parse it as string)
    if (payload.id !== undefined) {
      payload.id = Number(payload.id);
      if (isNaN(payload.id) || payload.id <= 0) {
        return res.status(401).json({ message: "Token invalide" });
      }
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token invalide ou expiré" });
  }
}

module.exports = auth;
