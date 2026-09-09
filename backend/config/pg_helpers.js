/**
 * Helpers pour la conversion MySQL -> PostgreSQL dans Senegram.
 *
 * Couvre :
 *   - Transactions (beginTransaction/commit/rollback -> BEGIN/COMMIT/ROLLBACK)
 *   - Bulk INSERT (VALUES ? avec array -> multi-VALUES avec unnest())
 *   - placeholder ? -> $N (delegated to db.js wrapper)
 */
const { Pool } = require("pg");

// Creer un client dedie pour une transaction
async function getTransactionClient(pool) {
  const client = await pool.connect();
  // Wrapper pour adapter l'API MySQL-style a pg
  client.query = async function pgTxQuery(sql, params = []) {
    // Convertir ? -> $N si pas deja fait
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const result = await client.query(pgSql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      insertId: result.rows && result.rows[0] ? result.rows[0].id : undefined,
    };
  };
  client.beginTransaction = async function () {
    await client.query("BEGIN");
  };
  client.commit = async function () {
    await client.query("COMMIT");
  };
  client.rollback = async function () {
    await client.query("ROLLBACK");
  };
  client.release = function () {
    // pg.Client.release() peut etre appele avec ou sans erreur
    return client._rawRelease ? client._rawRelease() : client.end();
  };
  // Conserver la vraie methode release pour usage brut si besoin
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
 *   ou (recommended):
 *   INSERT INTO t (a, b) SELECT * FROM UNNEST($1::int[], $2::int[])
 *
 * Strategie : on genere les placeholders numerotes un par un pour pg.
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
  // Trouver le ? dans le SQL et le remplacer par les placeholders
  const newSql = sql.replace("?", placeholders);
  // Flatten rows en params
  const params = rows.flat();
  return { sql: newSql, params };
}

module.exports = {
  getTransactionClient,
  bulkInsert,
};
