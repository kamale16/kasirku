const path = require("path");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { getDb } = require("./db");
const { initDb } = require("./seed");
const { HttpError, httpError } = require("./util");

function createApp(express, { db = getDb(), seed = process.env.SEED_DEMO !== "0" } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "50kb" }));
  app.use(cookieParser());

  // Perlindungan CSRF: cookie SameSite=Lax + semua perubahan data wajib berformat JSON
  // (form lintas situs tidak bisa mengirim application/json).
  app.use("/api", (req, res, next) => {
    const isRead = ["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (!isRead && !(req.get("content-type") || "").startsWith("application/json")) {
      return next(httpError(415, "Gunakan Content-Type: application/json"));
    }
    next();
  });

  // Buat tabel saat permintaan pertama (cold start). Kalau gagal, dicoba lagi di permintaan berikutnya.
  let ready;
  app.use("/api", (req, res, next) => {
    ready ??= initDb(db, { seed });
    ready.then(() => next(), (err) => { ready = null; next(err); });
  });

  app.use("/api", require("./routes/session")(db));
  app.use("/api/products", require("./routes/products")(db));
  app.use("/api/sales", require("./routes/sales")(db));
  app.use("/api/reports", require("./routes/reports")(db));
  app.use("/api/users", require("./routes/users")(db));
  app.use("/api", (req, res, next) => next(httpError(404, "Endpoint tidak ditemukan")));

  // Lokal saja: di Vercel file statis dilayani dari folder public/ (express.static diabaikan di sana).
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === "entity.parse.failed") err = httpError(400, "JSON tidak valid");
    if (err.code === "22003") err = httpError(400, "Angka terlalu besar");
    if (!(err instanceof HttpError)) {
      console.error(err);
      return res.status(500).json({ error: "Terjadi kesalahan di server" });
    }
    res.status(err.status).json({ error: err.message });
  });
  return app;
}

module.exports = { createApp };
