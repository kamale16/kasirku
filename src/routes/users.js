const bcrypt = require("bcryptjs");
const { Router } = require("express");
const { requireAuth } = require("../auth");
const { httpError, int, str, isUnique, wrap } = require("../util");

module.exports = (db) => {
  const r = Router();
  r.use(requireAuth("admin"));

  r.get("/", wrap(async (req, res) => {
    res.json({ users: (await db.query("SELECT id, username, name, role FROM users ORDER BY role, name")).rows });
  }));

  r.post("/", wrap(async (req, res) => {
    const username = str(req.body.username, 50), name = str(req.body.name, 80);
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const role = req.body.role === "admin" ? "admin" : "kasir";
    if (!username || !name || password.length < 6) throw httpError(400, "Isi nama, username, dan password (minimal 6 karakter)");
    try {
      const { rows } = await db.query("INSERT INTO users (username,name,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id, username, name, role",
        [username, name, await bcrypt.hash(password, 10), role]);
      res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (isUnique(err)) throw httpError(409, "Username sudah dipakai");
      throw err;
    }
  }));

  r.delete("/:id", wrap(async (req, res) => {
    const id = int(req.params.id, 1, 2 ** 31 - 1);
    if (id === req.user.id) throw httpError(400, "Tidak bisa menghapus akun sendiri");
    if ((await db.query("SELECT 1 FROM sales WHERE cashier_id=$1 LIMIT 1", [id])).rows.length) {
      throw httpError(409, "Akun ini punya riwayat transaksi, jadi tidak bisa dihapus");
    }
    const { rows } = await db.query("DELETE FROM users WHERE id=$1 RETURNING id", [id]);
    if (!rows.length) throw httpError(404, "Akun tidak ditemukan");
    res.json({ ok: true });
  }));

  return r;
};
