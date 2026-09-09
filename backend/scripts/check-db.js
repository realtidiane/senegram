require("dotenv").config();
const pool = require("../config/db");

async function checkDb() {
  try {
    const [[version]] = await pool.query("SELECT VERSION() AS version");
    const [tables] = await pool.query("SHOW TABLES");
    console.log("✅ Connexion MySQL OK");
    console.log(`Version: ${version.version}`);
    console.log(`Tables: ${tables.map((t) => Object.values(t)[0]).join(", ") || "aucune"}`);
  } catch (err) {
    console.error("❌ Connexion MySQL impossible:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

checkDb();
