"use strict";

const root = document.getElementById("app");
let me = null;

// ---------- helper ----------
const rupiah = (n) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const waktu = (s) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(s));
const hariIni = (d) => new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));

/** Buat elemen DOM. Teks selalu lewat createTextNode, jadi aman dari XSS. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

function toast(msg, type = "ok") {
  const el = h("div", { class: `toast ${type}`, role: type === "error" ? "alert" : "status" }, msg);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Terjadi kesalahan"), { status: res.status });
  return data;
}

// ---------- kerangka halaman ----------
const PAGES = {
  kasir: { label: "Kasir", roles: ["kasir", "admin"], render: pageKasir },
  produk: { label: "Produk", roles: ["admin"], render: pageProduk },
  laporan: { label: "Laporan", roles: ["admin"], render: pageLaporan },
  pengguna: { label: "Pengguna", roles: ["admin"], render: pagePengguna },
};

function shell(active, content) {
  const links = Object.entries(PAGES).filter(([, p]) => p.roles.includes(me.role))
    .map(([key, p]) => h("a", { href: `#/${key}`, "aria-current": key === active ? "page" : null }, p.label));
  root.replaceChildren(
    h("header", { class: "topbar" },
      h("a", { class: "brand", href: "#/" }, h("img", { src: "/logo.svg", alt: "" }), "KasirKu"),
      h("nav", { "aria-label": "Menu utama" }, links),
      h("div", { class: "who" }, `${me.name} (${me.role})`, h("button", { class: "btn small", onclick: logout }, "Keluar"))),
    h("main", {}, content));
}

async function logout() {
  await api("/logout", { method: "POST", body: {} }).catch(() => {});
  me = null;
  location.hash = "#/";
  route();
}

async function route() {
  if (!me) { try { me = (await api("/me")).user; } catch { me = null; } }
  if (!me) return pageLogin();
  const [name, arg] = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (name === "struk" && arg) return await pageStruk(arg);
    const key = PAGES[name] && PAGES[name].roles.includes(me.role) ? name : me.role === "admin" ? "laporan" : "kasir";
    if (location.hash !== `#/${key}`) history.replaceState(null, "", `#/${key}`);
    await PAGES[key].render(key);
  } catch (err) {
    if (err.status === 401) { me = null; return pageLogin(); }
    shell("", h("div", { class: "panel" }, h("p", {}, "Gagal memuat halaman: " + err.message)));
  }
}
window.addEventListener("hashchange", route);

// ---------- login ----------
function pageLogin() {
  const user = h("input", { name: "username", autocomplete: "username", required: true, autofocus: true });
  const pass = h("input", { name: "password", type: "password", autocomplete: "current-password", required: true });
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault();
    try {
      me = (await api("/login", { method: "POST", body: { username: user.value, password: pass.value } })).user;
      location.hash = me.role === "admin" ? "#/laporan" : "#/kasir";
      route();
    } catch (err) { toast(err.message, "error"); pass.value = ""; }
  } }, h("label", {}, "Username", user), h("label", {}, "Password", pass), h("button", { class: "btn primary big" }, "Masuk"));
  root.replaceChildren(h("div", { class: "login" },
    h("div", { class: "brand" }, h("img", { src: "/logo.svg", alt: "", width: 36, height: 36 }), "KasirKu"),
    h("div", { class: "panel" }, h("h1", {}, "Masuk"), form),
    h("p", { class: "hint" }, "Akun demo kasir: kasir1 / kasir123"),
    h("p", { class: "hint" }, "Akun demo admin: admin / admin123")));
}

// ---------- kasir (POS) ----------
async function pageKasir(key) {
  const { products } = await api("/products");
  const byId = new Map(products.map((p) => [p.id, p]));
  const cart = new Map();
  const digits = (s) => Number(String(s).replace(/\D/g, "")) || 0;

  const search = h("input", { type: "search", placeholder: "Cari nama atau SKU, Enter untuk menambah", "aria-label": "Cari produk", autofocus: true });
  const cards = products.map((p) => ({ p, el: h("button", { class: "card", disabled: p.stock === 0, onclick: () => add(p.id) },
    h("span", { class: "name" }, p.name), h("span", { class: "price" }, rupiah(p.price)),
    h("span", { class: "stock" + (p.stock <= 5 ? " low" : "") }, p.stock === 0 ? "Habis" : `Stok ${p.stock}`)) }));
  const cartList = h("ul", { class: "cart" });
  const totalEl = h("strong", { class: "num" }), changeEl = h("span", { class: "num" });
  const paid = h("input", { inputmode: "numeric", placeholder: "0", "aria-label": "Uang diterima", oninput: () => { paid.value = digits(paid.value) ? new Intl.NumberFormat("id-ID").format(digits(paid.value)) : ""; refresh(); } });
  const payBtn = h("button", { class: "btn primary big", disabled: true, onclick: pay }, "Bayar");
  const total = () => [...cart].reduce((s, [id, q]) => s + byId.get(id).price * q, 0);
  const quickBox = h("div", { class: "quick" });

  /** Nominal uang yang wajar di atas total: kelipatan 10.000, 20.000, 50.000, 100.000 (maksimal 3). */
  const suggest = (t) => [...new Set([10000, 20000, 50000, 100000].map((u) => Math.ceil(t / u) * u))].filter((n) => n > t).sort((a, b) => a - b).slice(0, 3);

  function add(id, d = 1) {
    const p = byId.get(id), q = (cart.get(id) || 0) + d;
    if (q <= 0) cart.delete(id);
    else if (q > p.stock) return toast(`Stok ${p.name} hanya ${p.stock}`, "error");
    else cart.set(id, q);
    refresh();
  }
  function setPaid(n) { paid.value = new Intl.NumberFormat("id-ID").format(n); refresh(); }
  function refresh() {
    cartList.replaceChildren(...(cart.size ? [...cart].map(([id, q]) => { const p = byId.get(id); return h("li", {},
      h("span", {}, p.name), h("span", { class: "qty" },
        h("button", { class: "btn small", "aria-label": `Kurangi ${p.name}`, onclick: () => add(id, -1) }, "−"), h("b", {}, q),
        h("button", { class: "btn small", "aria-label": `Tambah ${p.name}`, onclick: () => add(id, 1) }, "+"),
        h("button", { class: "btn small danger", "aria-label": `Hapus ${p.name}`, onclick: () => { cart.delete(id); refresh(); } }, "×")),
      h("span", { class: "sub num" }, `${rupiah(p.price)} × ${q} = ${rupiah(p.price * q)}`)); }) : [h("li", { class: "empty" }, "Klik produk untuk menambah ke keranjang")]));
    totalEl.textContent = rupiah(total());
    const diff = digits(paid.value) - total();
    changeEl.textContent = diff >= 0 ? rupiah(diff) : `Kurang ${rupiah(-diff)}`;
    payBtn.disabled = !cart.size || diff < 0;
    quickBox.replaceChildren(...(cart.size ? [
      h("button", { class: "btn small", onclick: () => setPaid(total()) }, "Uang pas"),
      ...suggest(total()).map((n) => h("button", { class: "btn small", onclick: () => setPaid(n) }, new Intl.NumberFormat("id-ID").format(n))),
    ] : []));
  }
  async function pay() {
    payBtn.disabled = true;
    try {
      const { sale } = await api("/sales", { method: "POST", body: { items: [...cart].map(([product_id, qty]) => ({ product_id, qty })), paid: digits(paid.value) } });
      toast(`Transaksi #${sale.id} berhasil`);
      location.hash = `#/struk/${sale.id}`;
    } catch (err) { toast(err.message, "error"); refresh(); }
  }
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    cards.forEach(({ p, el }) => { el.hidden = q !== "" && !(p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)); });
  });
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = cards.find(({ p, el }) => !el.hidden && p.stock > 0);
    if (first) { add(first.p.id); search.select(); }
  });

  shell(key, h("div", { class: "pos" },
    h("section", {}, h("div", { class: "search" }, search), h("div", { class: "grid" }, cards.map((c) => c.el))),
    h("aside", { class: "panel cartbox" }, h("h2", {}, "Keranjang"), cartList,
      h("div", { class: "sum total" }, h("span", {}, "Total"), totalEl),
      h("label", {}, "Uang diterima", paid),
      quickBox,
      h("div", { class: "sum" }, h("span", {}, "Kembalian"), changeEl), payBtn)));
  refresh();
  search.focus();
}

// ---------- produk (admin) ----------
async function pageProduk(key) {
  const { products } = await api("/products?all=1");
  let editing = null;
  const f = Object.fromEntries(["sku", "name", "price", "stock"].map((k) => [k, h("input", { name: k, required: true, ...(k === "price" || k === "stock" ? { type: "number", min: 0 } : {}) })]));
  const submit = h("button", { class: "btn primary" }, "Tambah produk");
  const cancel = h("button", { class: "btn", type: "button", hidden: true, onclick: () => reset() }, "Batal");
  const title = h("h2", {}, "Tambah produk");
  function reset() { editing = null; Object.values(f).forEach((i) => (i.value = "")); submit.textContent = "Tambah produk"; title.textContent = "Tambah produk"; cancel.hidden = true; }
  function edit(p) { editing = p; Object.keys(f).forEach((k) => (f[k].value = p[k])); submit.textContent = "Simpan perubahan"; title.textContent = `Ubah ${p.name}`; cancel.hidden = false; f.name.focus(); }
  const form = h("form", { class: "form-row", onsubmit: async (e) => {
    e.preventDefault();
    const body = { sku: f.sku.value, name: f.name.value, price: Number(f.price.value), stock: Number(f.stock.value) };
    try {
      await api(editing ? `/products/${editing.id}` : "/products", { method: editing ? "PUT" : "POST", body });
      toast(editing ? "Produk diperbarui" : "Produk ditambahkan");
      route();
    } catch (err) { toast(err.message, "error"); }
  } }, Object.entries({ sku: "SKU", name: "Nama", price: "Harga (Rp)", stock: "Stok" }).map(([k, t]) => h("label", {}, t, f[k])), h("div", { class: "actions" }, submit, cancel));

  const rows = products.map((p) => h("tr", {},
    h("td", {}, p.sku), h("td", {}, p.name), h("td", { class: "r" }, rupiah(p.price)),
    h("td", { class: "r" }, p.stock, p.active && p.stock <= 5 ? h("span", { class: "tag warn" }, " menipis") : null),
    h("td", {}, h("span", { class: "tag" + (p.active ? "" : " off") }, p.active ? "Aktif" : "Nonaktif")),
    h("td", { class: "act" },
      h("button", { class: "btn small", onclick: () => edit(p) }, "Ubah"), " ",
      h("button", { class: "btn small danger", onclick: async () => {
        if (!confirm(`Hapus ${p.name}?`)) return;
        try { const r = await api(`/products/${p.id}`, { method: "DELETE", body: {} }); toast(r.deactivated ? "Pernah terjual, jadi dinonaktifkan" : "Produk dihapus"); route(); } catch (err) { toast(err.message, "error"); }
      } }, "Hapus"))));
  shell(key, [h("h1", {}, "Produk"), h("section", { class: "panel" }, title, form),
    h("section", { class: "panel scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["SKU", "Nama"].map((t) => h("th", {}, t)), h("th", { class: "r" }, "Harga"), h("th", { class: "r" }, "Stok"), h("th", {}, "Status"), h("th", {}))), h("tbody", {}, rows)))]);
}

// ---------- laporan (admin) ----------
async function pageLaporan(key) {
  const [rep, recent] = await Promise.all([api("/reports/summary"), api("/sales?limit=8")]);
  const max = Math.max(1, ...rep.days.map((d) => d.revenue));
  shell(key, [h("h1", {}, "Laporan penjualan"),
    h("div", { class: "stats" },
      h("div", {}, h("b", { class: "num" }, rupiah(rep.today.revenue)), h("span", {}, "Omzet hari ini")),
      h("div", {}, h("b", { class: "num" }, rep.today.transactions), h("span", {}, "Transaksi hari ini")),
      h("div", {}, h("b", { class: "num" }, rep.today.items), h("span", {}, "Barang terjual hari ini"))),
    h("div", { class: "two" },
      h("section", { class: "panel" }, h("h2", {}, "Omzet 7 hari terakhir"),
        rep.days.map((d) => h("div", { class: "bar-row" }, h("span", {}, hariIni(d.date)), h("div", { class: "track" }, h("i", { style: `width:${(d.revenue / max) * 100}%` })), h("span", { class: "num" }, rupiah(d.revenue))))),
      h("section", { class: "panel" }, h("h2", {}, "Produk terlaris (7 hari)"),
        h("ul", { class: "list" }, rep.top.length ? rep.top.map((t) => h("li", {}, h("span", {}, t.name), h("span", { class: "num" }, `${t.qty} terjual`))) : h("li", { class: "empty" }, "Belum ada penjualan")))),
    h("div", { class: "two" },
      h("section", { class: "panel" }, h("h2", {}, "Transaksi terbaru"),
        h("ul", { class: "list" }, recent.sales.length ? recent.sales.map((s) => h("li", {}, h("a", { href: `#/struk/${s.id}` }, `#${s.id} · ${waktu(s.created_at)} · ${s.cashier}`), h("span", { class: "num" }, rupiah(s.total)))) : h("li", { class: "empty" }, "Belum ada transaksi"))),
      h("section", { class: "panel" }, h("h2", {}, "Stok menipis"),
        h("ul", { class: "list" }, rep.lowStock.length ? rep.lowStock.map((p) => h("li", {}, h("span", {}, p.name), h("span", { class: "tag warn" }, `sisa ${p.stock}`))) : h("li", { class: "empty" }, "Semua stok aman"))))]);
}

// ---------- pengguna (admin) ----------
async function pagePengguna(key) {
  const { users } = await api("/users");
  const f = { name: h("input", { required: true }), username: h("input", { required: true, autocomplete: "off" }), password: h("input", { type: "password", required: true, minlength: 6, autocomplete: "new-password" }),
    role: h("select", {}, h("option", { value: "kasir" }, "Kasir"), h("option", { value: "admin" }, "Admin")) };
  const form = h("form", { class: "form-row", onsubmit: async (e) => {
    e.preventDefault();
    try { await api("/users", { method: "POST", body: { name: f.name.value, username: f.username.value, password: f.password.value, role: f.role.value } }); toast("Akun ditambahkan"); route(); }
    catch (err) { toast(err.message, "error"); }
  } }, h("label", {}, "Nama", f.name), h("label", {}, "Username", f.username), h("label", {}, "Password", f.password), h("label", {}, "Peran", f.role), h("button", { class: "btn primary" }, "Tambah akun"));
  const rows = users.map((u) => h("tr", {}, h("td", {}, u.name), h("td", {}, u.username), h("td", {}, h("span", { class: "tag" }, u.role)),
    h("td", { class: "act" }, u.id === me.id ? "" : h("button", { class: "btn small danger", onclick: async () => {
      if (!confirm(`Hapus akun ${u.username}?`)) return;
      try { await api(`/users/${u.id}`, { method: "DELETE", body: {} }); toast("Akun dihapus"); route(); } catch (err) { toast(err.message, "error"); }
    } }, "Hapus"))));
  shell(key, [h("h1", {}, "Pengguna"), h("section", { class: "panel" }, h("h2", {}, "Tambah akun"), form),
    h("section", { class: "panel scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["Nama", "Username", "Peran"].map((t) => h("th", {}, t)), h("th", {}))), h("tbody", {}, rows)))]);
}

// ---------- struk ----------
async function pageStruk(id) {
  const { sale } = await api(`/sales/${encodeURIComponent(id)}`);
  const line = (a, b, cls) => h("div", { class: "row " + (cls || "") }, h("span", {}, a), h("span", { class: "num" }, b));
  shell("", [h("div", { class: "receipt" },
    h("h2", {}, "KasirKu"), h("div", { class: "c" }, "Terima kasih sudah berbelanja"), h("hr"),
    line(`No. #${sale.id}`, waktu(sale.created_at)), line("Kasir", sale.cashier), h("hr"),
    sale.items.map((it) => h("div", { class: "item" }, h("div", {}, it.name), line(`${it.qty} × ${rupiah(it.price)}`, rupiah(it.qty * it.price)))), h("hr"),
    line("Total", rupiah(sale.total), "tot"), line("Bayar", rupiah(sale.paid)), line("Kembali", rupiah(sale.change))),
    h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => window.print() }, "Cetak struk"), h("a", { class: "btn", href: "#/kasir" }, "Transaksi baru"))]);
}

route();
