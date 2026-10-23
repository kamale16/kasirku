const { Router } = require("express");
const { requireAuth } = require("../auth");
const { jakartaDate, wrap } = require("../util");

module.exports = (db) => {
  const r = Router();

  r.get("/summary", requireAuth("admin"), wrap(async (req, res) => {
    const sales = (await db.query("SELECT id, total, created_at FROM sales WHERE created_at >= now() - interval '8 days'")).rows;
    const qtyBySale = new Map((await db.query(
      "SELECT sale_id, SUM(qty)::int AS qty FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE created_at >= now() - interval '8 days') GROUP BY sale_id")).rows
      .map((x) => [x.sale_id, x.qty]));

    // Kelompokkan per hari menurut zona waktu Jakarta (7 hari terakhir, termasuk hari ini).
    const days = [];
    for (let i = 6; i >= 0; i--) days.push({ date: jakartaDate(Date.now() - i * 86400000), revenue: 0, transactions: 0, items: 0 });
    const byDate = new Map(days.map((d) => [d.date, d]));
    for (const s of sales) {
      const d = byDate.get(jakartaDate(s.created_at));
      if (d) { d.revenue += s.total; d.transactions += 1; d.items += qtyBySale.get(s.id) || 0; }
    }

    const top = (await db.query(
      `SELECT name, SUM(qty)::int AS qty, SUM(qty * price)::float8 AS revenue FROM sale_items
       WHERE sale_id IN (SELECT id FROM sales WHERE created_at >= now() - interval '7 days')
       GROUP BY name ORDER BY qty DESC, name LIMIT 5`)).rows;
    const low = (await db.query("SELECT id, name, stock FROM products WHERE active AND stock <= 5 ORDER BY stock, name LIMIT 10")).rows;
    res.json({ today: days[days.length - 1], days, top, lowStock: low });
  }));

  return r;
};
