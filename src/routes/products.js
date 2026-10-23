const { Router } = require("express");
const { requireAuth } = require("../auth");
const { httpError, int, str, isUnique, wrap } = require("../util");

const COLS = "id, sku, name, price, stock, active";

module.exports = (db) => {
  const r = Router();

  r.get("/", requireAuth(), wrap(async (req, res) => {
    const all = req.user.role === "admin" && req.query.all === "1";
    const { rows } = await db.query(`SELECT ${COLS} FROM products ${all ? "" : "WHERE active"} ORDER BY name`);
    res.json({ products: rows });
  }));

  function parse(body, partial) {
    const out = { sku: str(body.sku, 30), name: str(body.name, 80), price: int(body.price, 0, 10_000_000), stock: int(body.stock, 0, 1_000_000) };
    const bad = Object.entries(out).filter(([k, v]) => (partial ? body[k] !== undefined : true) && v === null).map(([k]) => k);
    if (bad.length) throw httpError(400, `Data tidak valid: ${bad.join(", ")}`);
    return out;
  }

  r.post("/", requireAuth("admin"), wrap(async (req, res) => {
    const p = parse(req.body, false);
    try {
      const { rows } = await db.query(`INSERT INTO products (sku,name,price,stock) VALUES ($1,$2,$3,$4) RETURNING ${COLS}`, [p.sku, p.name, p.price, p.stock]);
      res.status(201).json({ product: rows[0] });
    } catch (err) {
      if (isUnique(err)) throw httpError(409, "SKU sudah dipakai");
      throw err;
    }
  }));

  r.put("/:id", requireAuth("admin"), wrap(async (req, res) => {
    const id = int(req.params.id, 1, 2 ** 31 - 1);
    const p = parse(req.body, true);
    const active = typeof req.body.active === "boolean" ? req.body.active : null;
    try {
      const { rows } = await db.query(
        `UPDATE products SET sku=COALESCE($1,sku), name=COALESCE($2,name), price=COALESCE($3,price),
         stock=COALESCE($4,stock), active=COALESCE($5,active) WHERE id=$6 RETURNING ${COLS}`,
        [p.sku, p.name, p.price, p.stock, active, id]);
      if (!rows.length) throw httpError(404, "Produk tidak ditemukan");
      res.json({ product: rows[0] });
    } catch (err) {
      if (isUnique(err)) throw httpError(409, "SKU sudah dipakai");
      throw err;
    }
  }));

  // Produk yang pernah terjual hanya dinonaktifkan supaya riwayat struk tetap utuh.
  r.delete("/:id", requireAuth("admin"), wrap(async (req, res) => {
    const id = int(req.params.id, 1, 2 ** 31 - 1);
    const sold = (await db.query("SELECT 1 FROM sale_items WHERE product_id=$1 LIMIT 1", [id])).rows.length > 0;
    const sql = sold ? "UPDATE products SET active=FALSE WHERE id=$1 RETURNING id" : "DELETE FROM products WHERE id=$1 RETURNING id";
    const { rows } = await db.query(sql, [id]);
    if (!rows.length) throw httpError(404, "Produk tidak ditemukan");
    res.json({ ok: true, deactivated: sold });
  }));

  return r;
};
