const webpush = require("web-push");
const pool = require("../config/db");

/**
 * Configure web-push with VAPID keys.
 * Ported from fsarr10/senegram (MySQL) -> PostgreSQL.
 */
function initWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:sarrfallou267@gmail.com";

  if (!publicKey || !privateKey) {
    console.warn("[Push] VAPID keys not configured - push notifications disabled");
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

const webPushEnabled = initWebPush();

function publicKey(_req, res) {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ message: "Push notifications not configured" });
  res.json({ publicKey: key });
}

/**
 * Save push subscription for user (PostgreSQL upsert via ON CONFLICT).
 */
async function subscribe(req, res) {
  if (!webPushEnabled) {
    return res.status(503).json({ message: "Push notifications not configured" });
  }

  try {
    const userId = req.user.id;
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: "Invalid subscription data" });
    }

    console.log("[Push] Subscribe request for user:", userId, "endpoint:", endpoint);

    // PostgreSQL: ON CONFLICT pour upsert
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth`,
      [userId, endpoint, keys.p256dh, keys.auth],
    );

    console.log("[Push] Subscription saved for user:", userId);
    res.json({ success: true });
  } catch (err) {
    console.error("[Push] Subscribe error:", err);
    res.status(500).json({ message: "Failed to save subscription" });
  }
}

async function unsubscribe(req, res) {
  if (!webPushEnabled) {
    return res.status(503).json({ message: "Push notifications not configured" });
  }

  try {
    const userId = req.user.id;
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ message: "Endpoint required" });
    }

    console.log("[Push] Unsubscribe request for user:", userId, "endpoint:", endpoint);

    await pool.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [userId, endpoint],
    );

    console.log("[Push] Subscription removed for user:", userId);
    res.json({ success: true });
  } catch (err) {
    console.error("[Push] Unsubscribe error:", err);
    res.status(500).json({ message: "Failed to remove subscription" });
  }
}

/**
 * Send push notification to user.
 */
async function sendToUser(userId, payload) {
  if (!webPushEnabled) return { sent: 0, failed: 0 };

  try {
    const result = await pool.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId],
    );

    let sent = 0;
    let failed = 0;
    for (const sub of result.rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err) {
        console.error("[Push] Send to", sub.endpoint, "failed:", err.message);
        failed++;
        // Remove expired subscriptions (status 410 = Gone)
        if (err.statusCode === 410) {
          await pool.query(
            `DELETE FROM push_subscriptions WHERE endpoint = $1`,
            [sub.endpoint],
          );
        }
      }
    }
    return { sent, failed };
  } catch (err) {
    console.error("[Push] sendToUser error:", err);
    return { sent: 0, failed: 0 };
  }
}

async function testPush(req, res) {
  if (!webPushEnabled) {
    return res.status(503).json({ message: "Push notifications not configured" });
  }

  try {
    const result = await sendToUser(req.user.id, {
      title: "Test Senegram",
      body: "Vos notifications push fonctionnent!",
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  publicKey,
  subscribe,
  unsubscribe,
  testPush,
  sendToUser,
};
