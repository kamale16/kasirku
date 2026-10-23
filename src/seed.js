const bcrypt = require("bcryptjs");
const { SCHEMA } = require("./schema");

const PRODUCTS = [
  ["INDO-GRG", "Indomie Goreng", 3500, 120], ["TEHB-250", "Teh Botol Sosro", 5000, 60],
  ["AQUA-600", "Aqua 600 ml", 4000, 96], ["KAPAL-SC", "Kopi Kapal Api Sachet", 1500, 200],
  ["ROTI-TWR", "Roti Tawar", 16000, 18], ["TELUR-1K", "Telur Ayam 1 kg", 28000, 24],
  ["GULA-1K", "Gula Pasir 1 kg", 17000, 30], ["MINYAK-1L", "Minyak Goreng 1 L", 18000, 22],
  ["SUSU-UHT", "Susu UHT 250 ml", 7000, 48], ["SABUN-MDI", "Sabun Mandi", 4500, 40],
  ["BERAS-5K", "Beras 5 kg", 68000, 4], ["GARAM-250", "Garam 250 g", 3000, 3],
];

/** Buat tabel bila belum ada, lalu isi akun awal (dan data demo bila seed=true). Aman dipanggil berulang. */
async function initDb(db, { seed = true } = {}) {
  const exists = (await db.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
  if (exists) return;
  await db.exec(SCHEMA);
  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const adminPw = process.env.ADMIN_PASSWORD || "admin123";
  await db.query("INSERT INTO users (username,name,password_hash,role) VALUES ('admin','Administrator',$1,'admin') ON CONFLICT DO NOTHING", [hash(adminPw)]);
  if (!seed) return;
  await db.query("INSERT INTO users (username,name,password_hash,role) VALUES ('kasir1','Rina Kasir',$1,'kasir') ON CONFLICT DO NOTHING", [hash("kasir123")]);
  for (const [sku, name, price, stock] of PRODUCTS) {
    await db.query("INSERT INTO products (sku,name,price,stock) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [sku, name, price, stock]);
  }
  await seedSales(db);
}

/** Transaksi 7 hari terakhir supaya laporan langsung terisi (angka dibuat deterministik). */
async function seedSales(db) {
  const products = (await db.query("SELECT id,name,price FROM products ORDER BY id")).rows;
  const cashier = (await db.query("SELECT id FROM users WHERE username='kasir1'")).rows[0].id;
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 48271) % 2147483647) % n);
  const perDay = [4, 6, 5, 7, 3, 6, 5];
  for (let day = 6; day >= 0; day--) {
    for (let i = 0; i < perDay[6 - day]; i++) {
      const lines = Array.from({ length: 1 + rnd(3) }, () => ({ p: products[rnd(products.length)], qty: 1 + rnd(3) }));
      const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
      const paid = Math.ceil(total / 10000) * 10000;
      const when = new Date(Date.now() - day * 86400000 - (1 + i) * 3600000);
      const sale = await db.query("INSERT INTO sales (cashier_id,total,paid,change_amount,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id", [cashier, total, paid, paid - total, when]);
      for (const l of lines) {
        await db.query("INSERT INTO sale_items (sale_id,product_id,name,price,qty) VALUES ($1,$2,$3,$4,$5)", [sale.rows[0].id, l.p.id, l.p.name, l.p.price, l.qty]);
      }
    }
  }
}

module.exports = { initDb };
