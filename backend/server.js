/**
 * Senegram - serveur Express + Socket.IO.
 *
 * Expose:
 *   REST     : /api/auth, /api/users, /api/conversations, /api/messages,
 *              /api/groups, /api/upload, /api/calls
 *   Socket   : chat temps-réel, présence, typing, signaling WebRTC.
 */
require("dotenv").config();

const fs      = require("fs");
const path    = require("path");
const http    = require("http");
const https   = require("https");
const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const morgan  = require("morgan");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const { Server: SocketServer } = require("socket.io");

const authRoutes         = require("./routes/authRoutes");
const userRoutes         = require("./routes/userRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const messageRoutes      = require("./routes/messageRoutes");
const groupRoutes        = require("./routes/groupRoutes");
const uploadRoutes       = require("./routes/uploadRoutes");
const callRoutes         = require("./routes/callRoutes");

const socketHandler = require("./sockets");

const app = express();

/**
 * HTTPS automatique si on trouve `certs/cert.pem` + `certs/key.pem`.
 * Indispensable pour que les téléphones Android puissent acceder au micro
 * et à la camera en WebRTC (contexte sécurisé exigé).
 *
 * Pour (re)générer les certs :
 *     cd backend && npm run gen-cert
 */
const CERT_DIR = path.join(__dirname, "certs");
const certPath = path.join(CERT_DIR, "cert.pem");
const keyPath  = path.join(CERT_DIR, "key.pem");
const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);

const server = useHttps
  ? https.createServer({
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
    }, app)
  : http.createServer(app);

/**
 * Stratégie CORS sécurisée :
 *   - Production : UNIQUEMENT les origines déclarées dans CLIENT_URL
 *   - Développement : localhost + LAN privé uniquement (PAS toutes les origines)
 *   - Toujours valider (pas de "allow all" implicite)
 */
const allowed = (process.env.CLIENT_URL || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// En developpement, ajouter automatiquement localhost et 127.0.0.1
if (process.env.NODE_ENV !== "production") {
  const devOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
  ];
  devOrigins.forEach(o => {
    if (!allowed.includes(o)) allowed.push(o);
  });
}

const corsOrigin = (origin, cb) => {
  // Pas d'origine (curl, serveur) = autoriser
  if (!origin) return cb(null, true);

  // Vérifier strictement
  if (allowed.includes(origin)) return cb(null, true);

  // Sinon REFUSER
  cb(new Error(`Origine non autorisée : ${origin}`));
};

// ---------- Rate Limiting ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives par IP par 15min
  message: { message: "Trop de tentatives, reessayez dans 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Ne pas compter les succes
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requetes par IP par minute
  message: { message: "Trop de requetes, veuillez patienter" },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5, // 5 creations par IP par heure (register, group create)
  message: { message: "Limite de creation atteinte, reessayez dans 1 heure" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------- Socket.IO ----------
const io = new SocketServer(server, {
  cors: { origin: corsOrigin, credentials: true },
  maxHttpBufferSize: 1e8, // 100 Mo (pour les petits fichiers)
});
socketHandler(io);
app.set("io", io);

// ---------- Middlewares globaux ----------
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

// Fichiers statiques (uploads)
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");
    next();
  },
  express.static(path.join(__dirname, process.env.UPLOAD_DIR || "uploads")),
);

// ---------- Routes ----------
app.get("/", (_req, res) =>
  res.json({
    app: "🇸🇳 Senegram API",
    version: "1.0.0",
    status: "ok",
    docs: "/api",
  }),
);

app.use("/api/auth",          authLimiter, authRoutes);
app.use("/api/users",         generalLimiter, userRoutes);
app.use("/api/conversations", generalLimiter, conversationRoutes);
app.use("/api/messages",      generalLimiter, messageRoutes);
app.use("/api/groups",        strictLimiter, groupRoutes);
app.use("/api/upload",        uploadRoutes);
app.use("/api/calls",         callRoutes);

// ---------- Force HTTPS (only in production, behind Caddy) ----------
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    // Caddy already terminates HTTPS and passes X-Forwarded-Proto
    if (req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// ---------- 404 + handler global ----------
app.use((req, res) =>
  res.status(404).json({ message: `Route introuvable : ${req.method} ${req.originalUrl}` }),
);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error("Erreur serveur :", err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Erreur interne",
    code:    err.code    || "SERVER_ERROR",
  });
});

// ---------- Start ----------
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  const proto = useHttps ? "https" : "http";
  console.log(`Senegram API lancée sur ${proto}://localhost:${PORT}`);
  if (useHttps) {
    console.log("   HTTPS actif (certificat auto-signé). Accepte l'alerte du");
    console.log("      navigateur la 1re fois en visitant directement l'URL du backend.");
  } else {
    console.log("   HTTP seulement. Pour activer HTTPS (appels depuis mobile) :");
    console.log("      npm run gen-cert");
  }
});
