/**
 * Pool PostgreSQL (node-postgres).
 * On expose un `pool` utilisable partout avec await pool.query(...).
 *
 * Conversion depuis MySQL/mysql2 vers PostgreSQL/pg :
 *   - pool.query(sql, params) : MySQL -> PostgreSQL (compatible)
 *   - Mais les placeholders ? -> $1, $2, $3...
 *   - result.insertId -> result.rows[0].id (RETURNING id)
 *   - result[0] (tableau de tableaux) -> result.rows
 *   - Connexion via env vars PG_*
 */
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host:     process.env.PGHOST    || process.env.DB_HOST || "localhost",
  port:     Number(process.env.PGPORT || process.env.DB_PORT) || 5432,
  user:     process.env.PGUSER    || process.env.DB_USER || "senegram",
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.PGDATABASE || process.env.DB_NAME || "senegram",
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Force UTC pour cohérence avec TIMESTAMP DEFAULT
  timezone: "UTC",
});

// Petit ping de démarrage
pool
  .query("SELECT NOW() as now")
  .then((res) => {
    console.log(
      `✅ PostgreSQL connecté (${process.env.PGDATABASE || process.env.DB_NAME || "senegram"}) — server time: ${res.rows[0].now}`
    );
  })
  .catch((err) => {
    console.error("❌ Impossible de se connecter à PostgreSQL :", err.message);
  });

// Helper : adapter les `?` style MySQL en `$1, $2...` PostgreSQL
// Evite de réécrire toutes les requêtes à la main
function mysqlToPg(sql) {
  // Ne touche pas aux $$ (PL/pgSQL) ni aux $1 déjà remplacés
  // On compte les ? et on substitue séquentiellement
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Helper : retourne result.rows (compat avec mysql2 style [rows])
// Helper 2 : retourne result.rowCount
// Helper 3 : pour INSERT ... RETURNING id, expose insertId = result.rows[0].id
function pgResult(result) {
  return {
    rows: result.rows,
    rowCount: result.rowCount,
    insertId: result.rows && result.rows[0] ? result.rows[0].id : undefined,
  };
}

module.exports = pool;
module.exports.query = async function pgQuery(sql, params = []) {
  const pgSql = mysqlToPg(sql);
  const result = await pool.query(pgSql, params);
  return pgResult(result);
};
module.exports.connect = () => pool.connect();
module.exports.end = () => pool.end();
module.exports.sql = (strings, ...values) => {
  // tag template literal : pg template literal helper
  const { Pool } = require("pg");
  return pool.query(strings.reduce((acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ""), ""), values);
};
