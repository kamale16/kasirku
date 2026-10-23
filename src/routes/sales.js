const { Router } = require("express");
const { requireAuth } = require("../auth");
const { httpError, int, wrap } = require("../util");

const MAX_TOTAL = 1_000_000_000;

/** Gabungkan baris yang produknya sama dan urutkan per id (urutan tetap mencegah deadlock). */
function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) throw httpError(400, "Keranjang kosong atau terlalu besar");
  const merged = new Map();
  for (const it of raw) {
    const id = int(it && it.product_id, 1, 2 ** 31 - 1);
    const qty = int(it && it.qty, 1, 999);
    if (id === null || qty === null) throw httpError(400, "Data barang tidak valid");
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  return [...merged].map(([product_id, qty]) => ({ product_id, qty })).sort((a, b) => a.product_id - b.product_id);
}

module.exports = (db) => {
  const r = Router();

  r.post("/", requireAuth(), wrap(async (req, res) => {
    const items = parseItems(req.body.items);
    const paid = int(req.body.paid, 0, MAX_TOTAL);
    if (paid === null) throw httpError(400, "Jumlah uang tidak valid");

    // Semua langkah dalam satu transaksi: kalau satu barang gagal, stok barang lain ikut dikembalikan.
    const sale = await db.tx(async (q) => {
      const lines = [];
      let total = 0;
      for (const it of items) {
        // Pengurangan stok bersyarat: dua kasir tidak bisa menjual stok terakhir secara bersamaan.
        const upd = await q("UPDATE products SET stock = stock - $1 WHERE id = $2 AND active AND stock >= $1 RETURNING id, name, price", [it.qty, it.product_id]);
        if (!upd.rows.length) {
          const p = (await q("SELECT name, stock, active FROM products WHERE id=$1", [it.product_id])).rows[0];
          throw httpError(409, p && p.active ? `Stok ${p.name} tidak cukup (sisa ${p.stock})` : "Ada produk yang tidak ditemukan");
        }
        const { id, name, price } = upd.rows[0]; // harga selalu dari database, bukan dari klien
        lines.push({ id, name, price, qty: it.qty });
        total += price * it.qty;
      }
      if (total > MAX_TOTAL) throw httpError(400, "Total belanja terlalu besar");
      if (paid < total) throw httpError(400, `Uang kurang ${total - paid}`);
      const s = await q("INSERT INTO sales (cashier_id,total,paid,change_amount) VALUES ($1,$2,$3,$4) RETURNING id", [req.user.id, total, paid, paid - total]);
      for (const l of lines) {
        await q("INSERT INTO sale_items (sale_id,product_id,name,price,qty) VALUES ($1,$2,$3,$4,$5)", [s.rows[0].id, l.id, l.name, l.price, l.qty]);
      }
      return { id: s.rows[0].id, total, paid, change: paid - total };
    });
    res.status(201).json({ sale });
  }));

  r.get("/", requireAuth(), wrap(async (req, res) => {
    const limit = int(req.query.limit, 1, 100) ?? 20;
    const own = req.user.role !== "admin"; // kasir hanya melihat transaksinya sendiri
    const base = "SELECT s.id, s.total, s.created_at, u.name AS cashier FROM sales s JOIN users u ON u.id = s.cashier_id";
    const { rows } = own
      ? await db.query(`${base} WHERE s.cashier_id = $2 ORDER BY s.id DESC LIMIT $1`, [limit, req.user.id])
      : await db.query(`${base} ORDER BY s.id DESC LIMIT $1`, [limit]);
    res.json({ sales: rows });
  }));

  r.get("/:id", requireAuth(), wrap(async (req, res) => {
    const id = int(req.params.id, 1, 2 ** 31 - 1);
    const head = (await db.query(
      "SELECT s.id, s.total, s.paid, s.change_amount AS change, s.created_at, s.cashier_id, u.name AS cashier FROM sales s JOIN users u ON u.id=s.cashier_id WHERE s.id=$1", [id])).rows[0];
    if (!head || (req.user.role !== "admin" && head.cashier_id !== req.user.id)) throw httpError(404, "Struk tidak ditemukan");
    const items = (await db.query("SELECT name, price, qty FROM sale_items WHERE sale_id=$1 ORDER BY id", [id])).rows;
    res.json({ sale: { ...head, items } });
  }));

  return r;
};
