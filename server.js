"use strict";
/*
 * Control de Galeras — servidor web.
 * No usa frameworks: solo Node.js y el conector de PostgreSQL ("pg").
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createStore, COLLECTIONS } = require("./lib/store");
const { hashPassword, checkPassword } = require("./lib/password");

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === "production" || !!process.env.RENDER;
const SECRET = process.env.SESSION_SECRET || (PROD ? null : "solo-para-pruebas-locales");
if (!SECRET) { console.error("Falta la variable SESSION_SECRET."); process.exit(1); }
const PUBLIC = path.join(__dirname, "public");
const SESSION_DAYS = 14;
const ROLES = ["admin", "editor", "viewer"];
const store = createStore();

/* ---------- contraseñas y sesiones ---------- */
const b64 = s => Buffer.from(s).toString("base64url");
const sign = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
function makeToken(user) {
  const p = b64(JSON.stringify({ u: user.id, v: String(user.pass_hash).slice(-12), e: Date.now() + SESSION_DAYS * 864e5 }));
  return p + "." + sign(p);
}
function readCookies(req) {
  const out = {}; (req.headers.cookie || "").split(";").forEach(c => { const i = c.indexOf("="); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
async function currentUser(req) {
  const t = readCookies(req).sid; if (!t) return null;
  const [p, s] = t.split("."); if (!p || !s) return null;
  const good = sign(p); if (good.length !== s.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(s))) return null;
  let d; try { d = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; }
  if (!d.e || d.e < Date.now()) return null;
  const u = await store.getUser(d.u);
  if (!u || String(u.pass_hash).slice(-12) !== d.v) return null; // cambiar la contraseña cierra las sesiones viejas
  return u;
}
function sessionCookie(token, maxAgeSec) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${PROD ? "; Secure" : ""}`;
}
const publicUser = u => ({ id: u.id, username: u.username, name: u.name || u.username, role: u.role });

/* ---------- utilidades HTTP ---------- */
function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(status, { "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(Object.assign(new Error("El archivo es demasiado grande."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(Object.assign(new Error("Datos no válidos."), { status: 400 })); } });
    req.on("error", reject);
  });
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "No encontrado");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    res.end(buf);
  });
}
const validId = s => typeof s === "string" && /^[A-Za-z0-9_.\-]{1,80}$/.test(s);

/* ---------- intentos de acceso ---------- */
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(); const a = (attempts.get(ip) || []).filter(t => now - t < 10 * 60e3);
  attempts.set(ip, a); return a.length >= 8;
}

/* ---------- rutas ---------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  if (p === "/salud") return send(res, 200, { ok: true });

  if (p === "/api/login" && req.method === "POST") {
    if (tooMany(ip)) return send(res, 429, { error: "Demasiados intentos. Espera unos minutos." });
    const b = await readBody(req);
    const u = await store.getUserByName(String(b.username || "").trim());
    if (!u || !checkPassword(b.password || "", u.pass_hash)) { attempts.get(ip).push(Date.now()); return send(res, 401, { error: "Usuario o contraseña incorrectos." }); }
    attempts.delete(ip);
    return send(res, 200, { user: publicUser(u) }, { "Set-Cookie": sessionCookie(makeToken(u), SESSION_DAYS * 86400) });
  }
  if (p === "/api/logout") return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });

  const user = await currentUser(req);

  // páginas
  if (req.method === "GET" && !p.startsWith("/api/")) {
    if (p === "/login" || p === "/login.html") return user ? send(res, 302, "", { Location: "/" }) : serveFile(res, path.join(PUBLIC, "login.html"));
    if (p === "/" || p === "/index.html") return user ? serveFile(res, path.join(PUBLIC, "index.html")) : send(res, 302, "", { Location: "/login" });
    if (p === "/usuarios" || p === "/usuarios.html") return user ? serveFile(res, path.join(PUBLIC, "usuarios.html")) : send(res, 302, "", { Location: "/login" });
    const f = path.normalize(path.join(PUBLIC, p));
    if (!f.startsWith(PUBLIC) || /\.html$/.test(f)) return send(res, 404, "No encontrado");
    return serveFile(res, f);
  }

  if (!user) return send(res, 401, { error: "Inicia sesión." });
  const canWrite = user.role === "admin" || user.role === "editor";
  const isAdmin = user.role === "admin";

  if (p === "/api/me") return send(res, 200, { user: publicUser(user), store: store.kind });
  if (p === "/api/data" && req.method === "GET") return send(res, 200, { version: await store.version(), data: await store.getAll() });
  if (p === "/api/version") return send(res, 200, { version: await store.version() });

  let m = /^\/api\/doc\/([a-z]+)\/([^/]+)$/.exec(p);
  if (m) {
    const col = m[1], id = decodeURIComponent(m[2]);
    if (!COLLECTIONS.includes(col) || !validId(id)) return send(res, 400, { error: "Documento no válido." });
    if (!canWrite) return send(res, 403, { error: "Tu usuario solo puede ver." });
    if (req.method === "PUT") { const b = await readBody(req); if (!b || typeof b !== "object" || Array.isArray(b)) return send(res, 400, { error: "Datos no válidos." }); await store.put(col, id, b, user.username); return send(res, 200, { ok: true, version: await store.version() }); }
    if (req.method === "DELETE") { await store.del(col, id, user.username); return send(res, 200, { ok: true, version: await store.version() }); }
  }
  if (p === "/api/batch" && req.method === "POST") {
    if (!canWrite) return send(res, 403, { error: "Tu usuario solo puede ver." });
    const b = await readBody(req); const items = Array.isArray(b.items) ? b.items : [];
    if (items.some(i => !COLLECTIONS.includes(i.col) || !validId(i.id) || !i.data || typeof i.data !== "object")) return send(res, 400, { error: "Datos no válidos." });
    await store.batch(items, user.username); return send(res, 200, { ok: true, n: items.length, version: await store.version() });
  }

  // contraseña propia
  if (p === "/api/password" && req.method === "POST") {
    const b = await readBody(req);
    if (!checkPassword(b.current || "", user.pass_hash)) return send(res, 400, { error: "La contraseña actual no es correcta." });
    if (String(b.password || "").length < 8) return send(res, 400, { error: "La nueva contraseña debe tener al menos 8 caracteres." });
    const h = hashPassword(b.password); await store.updateUser(user.id, { pass_hash: h });
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(makeToken({ ...user, pass_hash: h }), SESSION_DAYS * 86400) });
  }

  // administración
  if (p.startsWith("/api/admin/")) {
    if (!isAdmin) return send(res, 403, { error: "Solo un administrador puede hacer esto." });
    if (p === "/api/admin/users" && req.method === "GET") return send(res, 200, { users: await store.listUsers() });
    if (p === "/api/admin/users" && req.method === "POST") {
      const b = await readBody(req); const username = String(b.username || "").trim();
      if (!/^[A-Za-z0-9_.\-]{3,40}$/.test(username)) return send(res, 400, { error: "El usuario debe tener de 3 a 40 letras o números, sin espacios." });
      if (String(b.password || "").length < 8) return send(res, 400, { error: "La contraseña debe tener al menos 8 caracteres." });
      if (!ROLES.includes(b.role)) return send(res, 400, { error: "Permiso no válido." });
      try { await store.createUser({ username, name: String(b.name || "").trim() || username, pass_hash: hashPassword(b.password), role: b.role }); }
      catch (e) { if (e.code === "23505") return send(res, 400, { error: "Ese usuario ya existe." }); throw e; }
      return send(res, 200, { ok: true });
    }
    m = /^\/api\/admin\/users\/(\d+)$/.exec(p);
    if (m) {
      const id = +m[1]; const target = await store.getUser(id); if (!target) return send(res, 404, { error: "No existe ese usuario." });
      const admins = (await store.listUsers()).filter(u => u.role === "admin");
      if (req.method === "DELETE") {
        if (id === user.id) return send(res, 400, { error: "No puedes eliminar tu propio usuario." });
        await store.deleteUser(id); return send(res, 200, { ok: true });
      }
      if (req.method === "PUT") {
        const b = await readBody(req); const f = {};
        if (b.role !== undefined) { if (!ROLES.includes(b.role)) return send(res, 400, { error: "Permiso no válido." }); if (target.role === "admin" && b.role !== "admin" && admins.length <= 1) return send(res, 400, { error: "Debe quedar al menos un administrador." }); f.role = b.role; }
        if (b.name !== undefined) f.name = String(b.name).trim();
        if (b.password !== undefined) { if (String(b.password).length < 8) return send(res, 400, { error: "La contraseña debe tener al menos 8 caracteres." }); f.pass_hash = hashPassword(b.password); }
        await store.updateUser(id, f); return send(res, 200, { ok: true });
      }
    }
    if (p === "/api/admin/changes") return send(res, 200, { changes: await store.recentChanges(100) });
    if (p === "/api/admin/backup") {
      const body = JSON.stringify({ tipo: "respaldo-control-de-galeras", version: 1, fecha: new Date().toISOString(), datos: await store.getAll() });
      const fname = `respaldo-control-de-galeras-${new Date().toISOString().slice(0, 10)}.json`;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${fname}"`, "Cache-Control": "no-store" });
      return res.end(body);
    }
    if (p === "/api/admin/restore" && req.method === "POST") {
      const b = await readBody(req, 60 * 1024 * 1024);
      if (!b || b.tipo !== "respaldo-control-de-galeras" || !b.datos) return send(res, 400, { error: "Ese archivo no es un respaldo de Control de Galeras." });
      const items = [];
      COLLECTIONS.forEach(c => (b.datos[c] || []).forEach(d => { if (validId(d.id) && d.data && typeof d.data === "object") items.push({ col: c, id: d.id, data: d.data }); }));
      for (let i = 0; i < items.length; i += 200) await store.batch(items.slice(i, i + 200), user.username);
      return send(res, 200, { ok: true, n: items.length });
    }
  }
  return send(res, 404, { error: "No encontrado." });
}

/* ---------- arranque ---------- */
(async () => {
  await store.init();
  if ((await store.countUsers()) === 0) {
    const u = process.env.ADMIN_USER, pw = process.env.ADMIN_PASSWORD;
    if (u && pw) { await store.createUser({ username: u, name: u, pass_hash: hashPassword(pw), role: "admin" }); console.log(`Se creó el administrador "${u}".`); }
    else console.warn("No hay usuarios. Define ADMIN_USER y ADMIN_PASSWORD y reinicia, o ejecuta: npm run crear-admin");
  }
  http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "Ocurrió un error en el servidor." }); });
  }).listen(PORT, () => console.log(`Control de Galeras listo en el puerto ${PORT} (datos: ${store.kind}).`));
})().catch(e => { console.error("No se pudo iniciar:", e); process.exit(1); });

