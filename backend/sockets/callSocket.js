const pool = require("../config/db");

/**
 * Signaling WebRTC.
 * Events :
 *   call:invite   { conversation_id, to_user_id, type, sdp_offer }
 *   call:accept   { call_id, to_user_id, sdp_answer }
 *   call:reject   { call_id, to_user_id }
 *   call:ice      { to_user_id, candidate }
 *   call:end      { call_id, to_user_id, duration }
 *
 * On utilise la room `user:<id>` pour router vers un utilisateur specifique.
 *
 * Conversion MySQL -> PostgreSQL :
 *   - INSERT ... RETURNING id (au lieu de result.insertId)
 *   - pool.query wrapper adapte automatiquement les placeholders
 */
module.exports = function callSocket(io, socket) {
  const userId = socket.user.id;

  socket.on("call:invite", async ({ conversation_id, to_user_id, type, sdp_offer }) => {
    if (!conversation_id || !to_user_id) return;
    try {
      const r = await pool.query(
        `INSERT INTO calls (conversation_id, caller_id, type, status)
         VALUES ($1, $2, $3, 'ringing')
         RETURNING id`,
        [conversation_id, userId, type || "audio"],
      );
      const callId = r.insertId;
      io.to(`user:${to_user_id}`).emit("call:incoming", {
        call_id: callId,
        conversation_id,
        type: type || "audio",
        from: {
          id:          userId,
          username:    socket.user.username,
        },
        sdp_offer,
      });
      socket.emit("call:created", { call_id: callId });
    } catch (err) {
      console.error("call:invite", err.message);
    }
  });

  socket.on("call:accept", async ({ call_id, to_user_id, sdp_answer }) => {
    if (!call_id || !to_user_id) return;
    await pool.query(
      `UPDATE calls SET status = 'ongoing' WHERE id = $1`,
      [call_id],
    );
    io.to(`user:${to_user_id}`).emit("call:accepted", {
      call_id,
      sdp_answer,
      from_user_id: userId,
    });
  });

  socket.on("call:reject", async ({ call_id, to_user_id }) => {
    if (!call_id) return;
    await pool.query(
      `UPDATE calls SET status = 'rejected', ended_at = NOW() WHERE id = $1`,
      [call_id],
    );
    io.to(`user:${to_user_id}`).emit("call:rejected", {
      call_id,
      by_user_id: userId,
    });
  });

  socket.on("call:ice", ({ to_user_id, candidate }) => {
    if (!to_user_id) return;
    io.to(`user:${to_user_id}`).emit("call:ice", {
      from_user_id: userId,
      candidate,
    });
  });

  socket.on("call:end", async ({ call_id, to_user_id, duration = 0 }) => {
    if (call_id) {
      await pool.query(
        `UPDATE calls SET status = 'ended', ended_at = NOW(), duration = $1 WHERE id = $2`,
        [duration, call_id],
      );
    }
    if (to_user_id) {
      io.to(`user:${to_user_id}`).emit("call:ended", {
        call_id,
        by_user_id: userId,
      });
    }
  });
};
