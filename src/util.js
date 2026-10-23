class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const httpError = (status, message) => new HttpError(status, message);

/** Ubah input jadi integer dalam rentang [min, max], atau null kalau tidak valid. */
function int(value, min, max) {
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** String yang dipangkas dan dibatasi panjangnya, atau null kalau kosong/terlalu panjang. */
function str(value, max) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

const isUnique = (err) => err && (err.code === "23505" || /duplicate key/i.test(err.message || ""));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

/** Tanggal (YYYY-MM-DD) menurut zona waktu Jakarta. */
const jakartaDate = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

module.exports = { HttpError, httpError, int, str, isUnique, wrap, jakartaDate };
