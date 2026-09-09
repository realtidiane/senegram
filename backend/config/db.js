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
 *
 * IMPORTANT : on sauvegarde la vraie methode Pool.query AVANT de
 * l'overrider, sinon on tombe en recursion infinie.
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
});

// Sauvegarder la vraie methode AVANT de l'overrider
const originalPoolQuery = pool.query.bind(pool);

// Petit ping de démarrage
originalPoolQuery("SELECT NOW() as now")
  .then((res) => {
    console.log(
      `✅ PostgreSQL connecté (${process.env.PGDATABASE || process.env.DB_NAME || "senegram"}) — server time: ${res.rows[0].now}`
    );
  })
  .catch((err) => {
    console.error("❌ Impossible de se connecter à PostgreSQL :", err.message);
  });

// Adapter : ? -> $N (compat MySQL-style placeholders)
function mysqlToPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Wrapper qui imite mysql2 : rows/rowCount/insertId
async function pgQuery(sql, params = []) {
  const pgSql = mysqlToPg(sql);
  const result = await originalPoolQuery(pgSql, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount,
    insertId: result.rows && result.rows[0] ? result.rows[0].id : undefined,
  };
}

// Override UNE seule fois pool.query avec notre wrapper
pool.query = pgQuery;

// On garde pool.connect() et pool.end() intacts (methodes natives de pg.Pool).
// Le code qui appelle pool.connect() est dans pg_helpers.js via getTransactionClient.

module.exports = pool;
