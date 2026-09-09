const pool = require("../config/db");

/**
 * Events cote chat :
 *   conversation:join          { conversation_id }
 *   conversation:leave         { conversation_id }
 *   typing                     { conversation_id, is_typing }
 *   message:read               { conversation_id, message_id }
 *
 * Les events "message:new / edited / deleted" sont emis depuis le controller
 * REST pour que la source de verite reste la DB.
 *
 * Conversion MySQL -> PostgreSQL :
 *   - INSERT IGNORE -> ON CONFLICT (col) DO NOTHING
 *   - GREATEST(COALESCE(...,0), ?) reste compatible PG
 *   - pool.query wrapper adapte automatiquement les placeholders
 */
module.exports = function chatSocket(io, socket) {
  const userId = socket.user.id;

  socket.on("conversation:join", ({ conversation_id }) => {
    if (!conversation_id) return;
    socket.join(`conv:${conversation_id}`);
  });

  socket.on("conversation:leave", ({ conversation_id }) => {
    if (!conversation_id) return;
    socket.leave(`conv:${conversation_id}`);
  });

  socket.on("typing", ({ conversation_id, is_typing }) => {
    if (!conversation_id) return;
    socket.to(`conv:${conversation_id}`).emit("typing", {
      conversation_id,
      user_id: userId,
      username: socket.user.username,
      is_typing: !!is_typing,
    });
  });

  socket.on("message:read", async ({ conversation_id, message_id }) => {
    if (!conversation_id || !message_id) return;
    try {
      await pool.query(
        `UPDATE conversation_members
         SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $1)
         WHERE conversation_id = $2 AND user_id = $3`,
        [message_id, conversation_id, userId],
      );
      await pool.query(
        `INSERT INTO message_reads (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [message_id, userId],
      );
      io.to(`conv:${conversation_id}`).emit("message:read", {
        conversation_id,
        message_id,
        user_id: userId,
      });
    } catch (err) {
      console.error("message:read error", err.message);
    }
  });
};
