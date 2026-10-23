const jwt = require("jsonwebtoken");
const { httpError } = require("./util");

const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProd) throw new Error("JWT_SECRET wajib diisi di produksi");
  return "dev-only-ganti-di-produksi";
}

function setSession(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, getSecret(), { expiresIn: "8h" });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 8 * 3600 * 1000 });
}

/** Pengguna dari cookie, atau null kalau belum login. */
function readUser(req) {
  try {
    return jwt.verify(req.cookies.token || "", getSecret());
  } catch {
    return null;
  }
}

/** Wajib login; kalau roles diisi, hanya peran itu yang boleh. */
function requireAuth(...roles) {
  return (req, res, next) => {
    req.user = readUser(req);
    if (!req.user) return next(httpError(401, "Silakan masuk dulu"));
    if (roles.length && !roles.includes(req.user.role)) return next(httpError(403, "Tidak punya akses"));
    next();
  };
}

module.exports = { setSession, requireAuth, readUser };
