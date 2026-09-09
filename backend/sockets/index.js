const jwt  = require("jsonwebtoken");
const pool = require("../config/db");

const chatSocket = require("./chatSocket");
const callSocket = require("./callSocket");

/**
 * Attache les handlers Socket.IO apres authentification JWT.
 * Le frontend envoie le token via `auth: { token }` dans io().
 *
 * Conversion MySQL -> PostgreSQL :
 *   - pool.query(sql, [params]) : OK (wrappateur transparent)
 *   - [rows] -> rows (pg.rows = array direct)
 */
module.exports = function socketHandler(io) {
  // Middleware d'auth
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("Token manquant"));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch {
      next(new Error("Token invalide"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user.id;
    console.log(`[socket] ${socket.user.username} connecte (${socket.id})`);

    // Room personnelle pour les notifications
    socket.join(`user:${userId}`);

    // Joindre automatiquement toutes les conversations dont il est membre
    try {
      const result = await pool.query(
        `SELECT conversation_id FROM conversation_members WHERE user_id = $1`,
        [userId],
      );
      result.rows.forEach((r) => socket.join(`conv:${r.conversation_id}`));
    } catch (err) {
      console.error("Erreur join rooms:", err.message);
    }

    // Statut = online
    await pool.query(
      `UPDATE users SET status = 'online' WHERE id = $1`,
      [userId],
    );
    io.emit("presence:update", { user_id: userId, status: "online" });

    // Handlers
    chatSocket(io, socket);
    callSocket(io, socket);

    socket.on("disconnect", async () => {
      await pool.query(
        `UPDATE users SET status = 'offline', last_seen = NOW() WHERE id = $1`,
        [userId],
      );
      io.emit("presence:update", {
        user_id: userId,
        status: "offline",
        last_seen: new Date(),
      });
      console.log(`[socket] ${socket.user.username} deconnecte`);
    });
  });
};
