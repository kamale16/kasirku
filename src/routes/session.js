const bcrypt = require("bcryptjs");
const { Router } = require("express");
const { setSession, readUser } = require("../auth");
const { httpError, str, wrap } = require("../util");

const DUMMY_HASH = bcrypt.hashSync("tidak-dipakai", 10); // supaya waktu respons sama untuk user yang tidak ada

module.exports = (db) => {
  const r = Router();

  r.post("/login", wrap(async (req, res) => {
    const username = str(req.body.username, 50);
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = username && (await db.query("SELECT id,name,role,password_hash FROM users WHERE username=$1", [username])).rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw httpError(401, "Username atau password salah");
    setSession(res, user);
    res.json({ user: { id: user.id, name: user.name, role: user.role } });
  }));

  r.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ ok: true });
  });

  // Selalu 200: user null berarti belum login (tidak memicu error 401 di console browser).
  r.get("/me", (req, res) => res.json({ user: readUser(req) }));
  return r;
};
