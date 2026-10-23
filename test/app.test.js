const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createDb } = require("../src/db");
const { createApp } = require("../src/app");

let db, server, base;
const url = process.env.TEST_DATABASE_URL || ""; // diisi = tes yang sama jalan di PostgreSQL sungguhan

before(async () => {
  process.env.JWT_SECRET = "rahasia-untuk-tes";
  process.env.PGLITE_DIR = "memory://"; // tanpa TEST_DATABASE_URL: PostgreSQL dalam memori (PGlite)
  db = createDb(url);
  if (url) await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  server = createApp(express, { db, seed: true }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

async function call(method, path, { body, cookie, type = "application/json" } = {}) {
  const res = await fetch(base + path, {
    method, headers: { "Content-Type": type, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const set = res.headers.get("set-cookie");
  return { status: res.status, data, cookie: set ? set.split(";")[0] : undefined };
}
async function login(username, password) {
  const r = await call("POST", "/api/login", { body: { username, password } });
  return r.cookie;
}
const productByName = async (cookie, name) => (await call("GET", "/api/products", { cookie })).data.products.find((p) => p.name === name);

test("login: salah ditolak, benar mendapat sesi", async () => {
  assert.equal((await call("POST", "/api/login", { body: { username: "admin", password: "salah" } })).status, 401);
  const cookie = await login("admin", "admin123");
  assert.ok(cookie);
  assert.equal((await call("GET", "/api/me", { cookie })).data.user.role, "admin");
});

test("tanpa login: /me berisi null, data produk ditolak (401)", async () => {
  assert.equal((await call("GET", "/api/me")).data.user, null);
  assert.equal((await call("GET", "/api/products")).status, 401);
});

test("perubahan data tanpa JSON ditolak (perlindungan CSRF)", async () => {
  const cookie = await login("admin", "admin123");
  const r = await call("POST", "/api/products", { cookie, type: "application/x-www-form-urlencoded", body: "sku=X&name=X&price=1&stock=1" });
  assert.equal(r.status, 415);
});

test("kasir tidak boleh kelola produk, laporan, atau pengguna", async () => {
  const kasir = await login("kasir1", "kasir123");
  assert.equal((await call("POST", "/api/products", { cookie: kasir, body: { sku: "A", name: "A", price: 1, stock: 1 } })).status, 403);
  assert.equal((await call("GET", "/api/reports/summary", { cookie: kasir })).status, 403);
  assert.equal((await call("GET", "/api/users", { cookie: kasir })).status, 403);
});

test("admin membuat produk; SKU kembar ditolak (409); input aneh ditolak (400)", async () => {
  const admin = await login("admin", "admin123");
  const body = { sku: "TES-1", name: "Barang Tes", price: 2500, stock: 10 };
  assert.equal((await call("POST", "/api/products", { cookie: admin, body })).status, 201);
  assert.equal((await call("POST", "/api/products", { cookie: admin, body })).status, 409);
  assert.equal((await call("POST", "/api/products", { cookie: admin, body: { ...body, sku: "TES-2", price: -5 } })).status, 400);
});

test("checkout: total dihitung server, stok berkurang, kembalian benar", async () => {
  const kasir = await login("kasir1", "kasir123");
  const p = await productByName(kasir, "Barang Tes");
  const r = await call("POST", "/api/sales", { cookie: kasir, body: { items: [{ product_id: p.id, qty: 2 }, { product_id: p.id, qty: 1 }], paid: 10000, price: 1 } });
  assert.equal(r.status, 201);
  assert.deepEqual([r.data.sale.total, r.data.sale.change], [7500, 2500]); // 3 x 2500, harga dari klien diabaikan
  assert.equal((await productByName(kasir, "Barang Tes")).stock, 7);
  const struk = await call("GET", `/api/sales/${r.data.sale.id}`, { cookie: kasir });
  assert.equal(struk.data.sale.items[0].qty, 3);
});

test("stok tidak cukup: 409 dan stok barang lain ikut dikembalikan (atomik)", async () => {
  const kasir = await login("kasir1", "kasir123");
  const a = await productByName(kasir, "Barang Tes"), b = await productByName(kasir, "Garam 250 g");
  const r = await call("POST", "/api/sales", { cookie: kasir, body: { items: [{ product_id: a.id, qty: 1 }, { product_id: b.id, qty: 99 }], paid: 1_000_000 } });
  assert.equal(r.status, 409);
  assert.equal((await productByName(kasir, "Barang Tes")).stock, a.stock);
});

test("uang kurang: 400 dan stok tidak berubah", async () => {
  const kasir = await login("kasir1", "kasir123");
  const a = await productByName(kasir, "Barang Tes");
  const r = await call("POST", "/api/sales", { cookie: kasir, body: { items: [{ product_id: a.id, qty: 2 }], paid: 1000 } });
  assert.equal(r.status, 400);
  assert.equal((await productByName(kasir, "Barang Tes")).stock, a.stock);
});

test("kasir tidak bisa membuka struk milik kasir lain", async () => {
  const admin = await login("admin", "admin123");
  const a = await productByName(admin, "Barang Tes");
  const sale = await call("POST", "/api/sales", { cookie: admin, body: { items: [{ product_id: a.id, qty: 1 }], paid: 5000 } });
  const kasir = await login("kasir1", "kasir123");
  assert.equal((await call("GET", `/api/sales/${sale.data.sale.id}`, { cookie: kasir })).status, 404);
  assert.equal((await call("GET", `/api/sales/${sale.data.sale.id}`, { cookie: admin })).status, 200);
});

test("laporan: omzet hari ini memuat transaksi barusan, 7 hari terisi", async () => {
  const admin = await login("admin", "admin123");
  const r = await call("GET", "/api/reports/summary", { cookie: admin });
  assert.equal(r.status, 200);
  assert.equal(r.data.days.length, 7);
  assert.ok(r.data.today.revenue >= 10000); // 7500 + 2500 dari tes di atas
  assert.ok(r.data.top.length > 0 && r.data.lowStock.length > 0);
});

test("produk yang pernah terjual hanya dinonaktifkan, riwayat struk utuh", async () => {
  const admin = await login("admin", "admin123");
  const a = await productByName(admin, "Barang Tes");
  const r = await call("DELETE", `/api/products/${a.id}`, { cookie: admin, body: {} });
  assert.equal(r.data.deactivated, true);
  assert.equal(await productByName(admin, "Barang Tes"), undefined);
});

test("pengguna: tambah kasir, username kembar ditolak, hapus diri sendiri ditolak", async () => {
  const admin = await login("admin", "admin123");
  const body = { username: "kasir2", name: "Dewi", password: "dewi1234" };
  assert.equal((await call("POST", "/api/users", { cookie: admin, body })).status, 201);
  assert.equal((await call("POST", "/api/users", { cookie: admin, body })).status, 409);
  const me = (await call("GET", "/api/me", { cookie: admin })).data.user;
  assert.equal((await call("DELETE", `/api/users/${me.id}`, { cookie: admin, body: {} })).status, 400);
});
