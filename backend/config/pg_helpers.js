/**
 * Helpers pour la conversion MySQL -> PostgreSQL dans Senegram.
 *
 * Couvre :
 *   - Transactions (beginTransaction/commit/rollback -> BEGIN/COMMIT/ROLLBACK)
 *   - Bulk INSERT (VALUES ? avec array -> multi-VALUES avec unnest())
 *   - placeholder ? -> $N (delegated to db.js wrapper)
 */
const { Pool } = require("pg");

/**
 * Creer un client dedie pour une transaction avec wrapper mysql2-style.
 *
 * IMPORTANT: on NE doit PAS override client.query car pg.Pool utilise
 * le tracking interne de query pour savoir si une connexion est occupee.
 * Si on override, le release() ne marche pas correctement et le pool
 * se bloque.
 *
 * Solution: retourner un objet qui imite mysql2 mais utilise le vrai
 * client.query en interne.
 */
async function getTransactionClient(pool) {
  const client = await pool.connect();

  // Sauvegarder la vraie methode (reference, pas override)
  const originalQuery = client.query.bind(client);

  // Adapter ? -> $N (compat MySQL-style placeholders)
  function mysqlToPg(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  // Wrapper qui imite mysql2 : rows/rowCount/insertId
  async function pgTxQuery(sql, params = []) {
    const pgSql = mysqlToPg(sql);
    const result = await originalQuery(pgSql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      insertId: result.rows && result.rows[0] ? result.rows[0].id : undefined,
    };
  }

  // Creer un PROXY qui delegue au client original
  // MAIS ne pas override les methodes internes (release, etc.)
  const wrapper = {
    query: pgTxQuery,
    beginTransaction: async () => {
      await originalQuery("BEGIN");
    },
    commit: async () => {
      await originalQuery("COMMIT");
    },
    rollback: async () => {
      try {
        await originalQuery("ROLLBACK");
      } catch (_) {}
    },
    // Acces au client original pour usage avance
    _client: client,
    _rawRelease: client.release.bind(client),
  };

  return wrapper;
}

/**
 * Convertir un bulk INSERT MySQL-style en PostgreSQL.
 *
 * MySQL :
 *   INSERT INTO t (a, b) VALUES ?
 *   avec [[1, 2], [3, 4]]
 *
 * PostgreSQL (sans VALUES ?):
 *   INSERT INTO t (a, b) VALUES (1, 2), (3, 4)
 *
 * @param {string} sql - La requete avec UN '?' pour le bulk insert
 * @param {Array} rows - Liste de lignes [v1, v2, ...]
 * @returns {{sql: string, params: any[]}}
 */
function bulkInsert(sql, rows) {
  if (!rows || !rows.length) {
    return { sql: sql.replace(/\?/, "()"), params: [] };
  }
  const ncols = rows[0].length;
  const placeholders = rows
    .map((row, rIdx) => {
      const offset = rIdx * ncols;
      const phs = [];
      for (let i = 0; i < ncols; i++) {
        phs.push(`\$${offset + i + 1}`);
      }
      return `(${phs.join(", ")})`;
    })
    .join(", ");
  const newSql = sql.replace("?", placeholders);
  const params = rows.flat();
  return { sql: newSql, params };
}

module.exports = {
  getTransactionClient,
  bulkInsert,
};
