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
 * IMPORTANT: on sauvegarde la vraie methode Client.query AVANT de l'overrider,
 * sinon on tombe en recursion infinie (ce bug a deja fait crasher le backend !)
 */
async function getTransactionClient(pool) {
  const client = await pool.connect();

  // Sauvegarder la vraie methode AVANT l'override
  const originalClientQuery = client.query.bind(client);

  // Adapter ? -> $N (compat MySQL-style placeholders)
  function mysqlToPg(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  // Wrapper qui imite mysql2 : rows/rowCount/insertId
  async function pgTxQuery(sql, params = []) {
    const pgSql = mysqlToPg(sql);
    const result = await originalClientQuery(pgSql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      insertId: result.rows && result.rows[0] ? result.rows[0].id : undefined,
    };
  }

  // Override UNE seule fois
  client.query = pgTxQuery;

  // Transaction shortcuts
  client.beginTransaction = async function () {
    await originalClientQuery("BEGIN");
  };
  client.commit = async function () {
    await originalClientQuery("COMMIT");
  };
  client.rollback = async function () {
    await originalClientQuery("ROLLBACK");
  };

  // Conserver la vraie methode release pour usage interne
  client._rawRelease = client.release.bind(client);

  return client;
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
