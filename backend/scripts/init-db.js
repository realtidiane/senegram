require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function sslConfig() {
  if (process.env.DB_SSL !== "true") return undefined;
  if (process.env.DB_CA_CERT) {
    return { ca: process.env.DB_CA_CERT.replace(/\\n/g, "\n") };
  }
  if (process.env.DB_CA_PATH && fs.existsSync(process.env.DB_CA_PATH)) {
    return { ca: fs.readFileSync(process.env.DB_CA_PATH, "utf8") };
  }
  return { rejectUnauthorized: true };
}

function configFromUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || process.env.DB_NAME || "senegram",
  };
}

function splitSql(schema) {
  return schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
}

async function currentDatabase(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS db");
  return row.db;
}

async function tableExists(connection, db, table) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [db, table],
  );
  return Number(row.count) > 0;
}

async function columnExists(connection, db, table, column) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [db, table, column],
  );
  return Number(row.count) > 0;
}

async function indexExists(connection, db, table, indexName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [db, table, indexName],
  );
  return Number(row.count) > 0;
}

async function ensureColumn(connection, db, table, column, definition) {
  if (!(await tableExists(connection, db, table))) return;
  if (await columnExists(connection, db, table, column)) return;
  await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`  + colonne ${table}.${column}`);
}

async function ensureIndex(connection, db, table, indexName, ddl) {
  if (!(await tableExists(connection, db, table))) return;
  if (await indexExists(connection, db, table, indexName)) return;
  await connection.query(ddl);
  console.log(`  + index ${table}.${indexName}`);
}

async function ensureExistingSchema(connection) {
  const db = await currentDatabase(connection);
  console.log("🔁 Vérification des migrations idempotentes...");

  await ensureColumn(connection, db, "users", "phone", "VARCHAR(30) DEFAULT NULL");
  await ensureColumn(connection, db, "users", "bio", "VARCHAR(255) DEFAULT NULL");
  await ensureColumn(connection, db, "users", "is_online", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn(connection, db, "users", "last_seen", "DATETIME DEFAULT NULL");

  await ensureColumn(connection, db, "conversations", "description", "VARCHAR(500) DEFAULT NULL");
  await ensureColumn(connection, db, "conversations", "avatar_url", "VARCHAR(500) DEFAULT NULL");

  await ensureColumn(connection, db, "conversation_members", "last_read_message_id", "BIGINT UNSIGNED DEFAULT NULL");
  await ensureColumn(connection, db, "conversation_members", "is_muted", "BOOLEAN NOT NULL DEFAULT FALSE");

  await ensureColumn(connection, db, "messages", "reply_to_id", "BIGINT UNSIGNED DEFAULT NULL");
  await ensureColumn(connection, db, "messages", "is_edited", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn(connection, db, "messages", "is_deleted", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn(connection, db, "messages", "sent_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await ensureColumn(connection, db, "messages", "delivered_at", "DATETIME DEFAULT NULL");
  await ensureColumn(connection, db, "messages", "read_at", "DATETIME DEFAULT NULL");
  await ensureColumn(connection, db, "messages", "is_pinned", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn(connection, db, "messages", "pinned_by", "BIGINT UNSIGNED DEFAULT NULL");
  await ensureColumn(connection, db, "messages", "pinned_at", "DATETIME DEFAULT NULL");
  await ensureColumn(connection, db, "messages", "updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

  await ensureColumn(connection, db, "attachments", "duration", "INT DEFAULT NULL");
  await ensureColumn(connection, db, "attachments", "width", "INT DEFAULT NULL");
  await ensureColumn(connection, db, "attachments", "height", "INT DEFAULT NULL");

  await ensureIndex(connection, db, "users", "idx_users_online_last_seen",
    "CREATE INDEX idx_users_online_last_seen ON users(is_online, last_seen)");
  await ensureIndex(connection, db, "messages", "idx_messages_conv_id_desc",
    "CREATE INDEX idx_messages_conv_id_desc ON messages(conversation_id, id DESC)");
  await ensureIndex(connection, db, "messages", "idx_messages_status",
    "CREATE INDEX idx_messages_status ON messages(conversation_id, sender_id, delivered_at, read_at)");
  await ensureIndex(connection, db, "messages", "idx_messages_pinned",
    "CREATE INDEX idx_messages_pinned ON messages(conversation_id, is_pinned, pinned_at)");
  await ensureIndex(connection, db, "messages", "idx_messages_sender",
    "CREATE INDEX idx_messages_sender ON messages(sender_id, conversation_id)");
  await ensureIndex(connection, db, "conversation_members", "idx_conversation_members_user_conv",
    "CREATE INDEX idx_conversation_members_user_conv ON conversation_members(user_id, conversation_id)");
  await ensureIndex(connection, db, "conversations", "idx_conversations_updated_type",
    "CREATE INDEX idx_conversations_updated_type ON conversations(updated_at, type)");
}

async function initDatabase() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  const dbName = process.env.DB_NAME || "senegram";
  const baseConfig = url
    ? configFromUrl(url)
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
      };

  let connection;
  try {
    console.log(`🔧 Connexion à MySQL: ${baseConfig.host}:${baseConfig.port}`);
    connection = await mysql.createConnection({
      ...baseConfig,
      multipleStatements: false,
      ssl: sslConfig(),
    });
    console.log("✅ Connecté à MySQL");

    const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
    const statements = splitSql(fs.readFileSync(schemaPath, "utf8"))
      .filter((stmt) => {
        if (url && /^CREATE DATABASE/i.test(stmt)) return false;
        if (url && /^USE /i.test(stmt)) return false;
        return true;
      });

    console.log(`📋 Exécution de ${statements.length} statements...`);
    for (const stmt of statements) {
      try {
        await connection.query(stmt);
      } catch (err) {
        if (!/already exists|Duplicate|exists/i.test(err.message)) {
          console.error("⚠️ Erreur statement:", err.message);
          throw err;
        }
      }
    }
    await ensureExistingSchema(connection);

    const [tables] = await connection.query("SHOW TABLES");
    console.log("✅ Schéma MySQL initialisé");
    console.log("\n📊 Tables:");
    tables.forEach((t) => console.log(`  - ${Object.values(t)[0]}`));
  } catch (err) {
    console.error("❌ Erreur initialisation DB:", err.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

initDatabase();
