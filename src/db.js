/**
 * Satu antarmuka untuk dua database dengan SQL yang sama (dialek PostgreSQL):
 *  - DATABASE_URL terisi  -> PostgreSQL sungguhan (mis. Neon)
 *  - kosong               -> PGlite (PostgreSQL di dalam proses; lokal dan tes, tanpa instalasi)
 */
function createDb(url = process.env.DATABASE_URL) {
  if (url) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: url, max: 3 });
    return {
      kind: "postgres",
      query: (text, params = []) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn((t, p = []) => client.query(t, p));
          await client.query("COMMIT");
          return out;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = require("@electric-sql/pglite");
  // Di Vercel filesystem tidak bisa ditulisi, jadi pakai memori; lokal disimpan di .data/
  const dir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? undefined : ".data/pglite");
  if (dir && !dir.includes("://")) require("fs").mkdirSync(dir, { recursive: true }); // PGlite tidak membuat folder induk
  const pg = new PGlite(dir);
  return {
    kind: "pglite",
    query: (text, params = []) => pg.query(text, params),
    exec: (sql) => pg.exec(sql),
    tx: (fn) => pg.transaction((tx) => fn((t, p = []) => tx.query(t, p))),
    close: () => pg.close(),
  };
}

let shared;
const getDb = () => (shared ??= createDb());

module.exports = { createDb, getDb };
