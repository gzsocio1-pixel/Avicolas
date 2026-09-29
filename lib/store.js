"use strict";
/*
 * Almacenamiento de datos.
 * - Con DATABASE_URL: PostgreSQL (lo que usa Render).
 * - Sin DATABASE_URL: un archivo JSON en ./data (solo para pruebas locales).
 */
const fs = require("fs");
const path = require("path");

const COLLECTIONS = ["flocks", "years", "payments", "cashflow"];

/* ---------------- PostgreSQL ---------------- */
function pgStore(url) {
  const { Pool } = require("pg");
  const needsSsl = /\.render\.com|sslmode=require/.test(url);
  const pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : false, max: 5 });
  const q = (text, params) => pool.query(text, params);
  return {
    kind: "PostgreSQL",
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS docs (
        collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by text,
        PRIMARY KEY (collection, id))`);
      await q(`CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY, username text UNIQUE NOT NULL, name text,
        pass_hash text NOT NULL, role text NOT NULL DEFAULT 'viewer',
        created_at timestamptz NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS changes (
        id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
        username text, action text, collection text, doc_id text, n integer)`);
      await q(`CREATE TABLE IF NOT EXISTS meta (k text PRIMARY KEY, v text)`);
    },
    async getAll() {
      const r = await q(`SELECT collection, id, data FROM docs ORDER BY collection, id`);
      const out = {}; COLLECTIONS.forEach(c => (out[c] = []));
      r.rows.forEach(x => { if (out[x.collection]) out[x.collection].push({ id: x.id, data: x.data }); });
      return out;
    },
    async version() {
      const r = await q(`SELECT (SELECT coalesce(max(updated_at),'epoch')::text FROM docs) AS m,
                                (SELECT count(*) FROM docs)::text AS n,
                                (SELECT coalesce(v,'0') FROM meta WHERE k='del') AS d`);
      const x = r.rows[0] || {};
      return `${x.m}|${x.n}|${x.d || 0}`;
    },
    async put(col, id, data, user) {
      await q(`INSERT INTO docs (collection, id, data, updated_at, updated_by) VALUES ($1,$2,$3::jsonb,now(),$4)
               ON CONFLICT (collection, id) DO UPDATE SET data=excluded.data, updated_at=now(), updated_by=excluded.updated_by`,
        [col, id, JSON.stringify(data), user]);
      await this.log(user, "guardar", col, id, 1);
    },
    async del(col, id, user) {
      await q(`DELETE FROM docs WHERE collection=$1 AND id=$2`, [col, id]);
      await q(`INSERT INTO meta (k, v) VALUES ('del', '1') ON CONFLICT (k) DO UPDATE SET v=(meta.v::bigint+1)::text`);
      await this.log(user, "eliminar", col, id, 1);
    },
    async batch(items, user) {
      if (!items.length) return;
      await q(`INSERT INTO docs (collection, id, data, updated_at, updated_by)
               SELECT x.collection, x.id, x.data, now(), $2
               FROM jsonb_to_recordset($1::jsonb) AS x(collection text, id text, data jsonb)
               ON CONFLICT (collection, id) DO UPDATE SET data=excluded.data, updated_at=now(), updated_by=excluded.updated_by`,
        [JSON.stringify(items.map(i => ({ collection: i.col, id: i.id, data: i.data }))), user]);
      const cols = [...new Set(items.map(i => i.col))];
      await this.log(user, "importar", cols.length === 1 ? cols[0] : "varios", items.length === 1 ? items[0].id : null, items.length);
    },
    async log(user, action, col, id, n) {
      await q(`INSERT INTO changes (username, action, collection, doc_id, n) VALUES ($1,$2,$3,$4,$5)`, [user, action, col, id, n]);
    },
    async recentChanges(limit) {
      const r = await q(`SELECT at, username, action, collection, doc_id, n FROM changes ORDER BY id DESC LIMIT $1`, [limit]);
      return r.rows.map(x => ({ ...x, at: new Date(x.at).toISOString() }));
    },
    async listUsers() {
      const r = await q(`SELECT id, username, name, role, created_at FROM users ORDER BY username`);
      return r.rows.map(x => ({ ...x, created_at: new Date(x.created_at).toISOString() }));
    },
    async countUsers() { const r = await q(`SELECT count(*)::int AS n FROM users`); return r.rows[0].n; },
    async getUserByName(u) { const r = await q(`SELECT * FROM users WHERE lower(username)=lower($1)`, [u]); return r.rows[0] || null; },
    async getUser(id) { const r = await q(`SELECT * FROM users WHERE id=$1`, [id]); return r.rows[0] || null; },
    async createUser(u) {
      const r = await q(`INSERT INTO users (username, name, pass_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`, [u.username, u.name, u.pass_hash, u.role]);
      return r.rows[0].id;
    },
    async updateUser(id, f) {
      const sets = [], vals = [];
      ["name", "pass_hash", "role"].forEach(k => { if (f[k] !== undefined) { vals.push(f[k]); sets.push(`${k}=$${vals.length}`); } });
      if (!sets.length) return;
      vals.push(id);
      await q(`UPDATE users SET ${sets.join(", ")} WHERE id=$${vals.length}`, vals);
    },
    async deleteUser(id) { await q(`DELETE FROM users WHERE id=$1`, [id]); },
  };
}

/* ---------------- Archivo local (pruebas) ---------------- */
function fileStore(dir) {
  const file = path.join(dir, "datos-locales.json");
  let S = { docs: {}, users: [], changes: [], del: 0, seq: 1 };
  const save = () => { const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(S)); fs.renameSync(tmp, file); };
  const now = () => new Date().toISOString();
  return {
    kind: "archivo local",
    async init() { fs.mkdirSync(dir, { recursive: true }); if (fs.existsSync(file)) S = JSON.parse(fs.readFileSync(file, "utf8")); },
    async getAll() {
      const out = {}; COLLECTIONS.forEach(c => (out[c] = []));
      Object.entries(S.docs).sort().forEach(([k, v]) => { const [c, ...rest] = k.split("/"); if (out[c]) out[c].push({ id: rest.join("/"), data: v.data }); });
      return out;
    },
    async version() { let m = ""; Object.values(S.docs).forEach(v => { if (v.at > m) m = v.at; }); return `${m}|${Object.keys(S.docs).length}|${S.del}`; },
    async put(col, id, data, user) { S.docs[col + "/" + id] = { data, at: now(), by: user }; this.log(user, "guardar", col, id, 1); save(); },
    async del(col, id, user) { delete S.docs[col + "/" + id]; S.del++; this.log(user, "eliminar", col, id, 1); save(); },
    async batch(items, user) { const t = now(); items.forEach(i => (S.docs[i.col + "/" + i.id] = { data: i.data, at: t, by: user })); if (items.length) { const cols = [...new Set(items.map(i => i.col))]; this.log(user, "importar", cols.length === 1 ? cols[0] : "varios", items.length === 1 ? items[0].id : null, items.length); } save(); },
    log(user, action, col, id, n) { S.changes.push({ at: now(), username: user, action, collection: col, doc_id: id, n }); if (S.changes.length > 2000) S.changes = S.changes.slice(-2000); },
    async recentChanges(limit) { return S.changes.slice(-limit).reverse(); },
    async listUsers() { return S.users.map(({ pass_hash, ...u }) => u).sort((a, b) => a.username.localeCompare(b.username)); },
    async countUsers() { return S.users.length; },
    async getUserByName(u) { return S.users.find(x => x.username.toLowerCase() === String(u).toLowerCase()) || null; },
    async getUser(id) { return S.users.find(x => x.id === +id) || null; },
    async createUser(u) {
      if (S.users.some(x => x.username.toLowerCase() === u.username.toLowerCase())) { const e = new Error("duplicado"); e.code = "23505"; throw e; }
      const id = S.seq++; S.users.push({ id, ...u, created_at: now() }); save(); return id;
    },
    async updateUser(id, f) { const u = S.users.find(x => x.id === +id); if (u) { Object.keys(f).forEach(k => f[k] !== undefined && (u[k] = f[k])); save(); } },
    async deleteUser(id) { S.users = S.users.filter(x => x.id !== +id); save(); },
  };
}

function createStore() {
  const url = process.env.DATABASE_URL;
  return url ? pgStore(url) : fileStore(path.join(__dirname, "..", "data"));
}

module.exports = { createStore, COLLECTIONS };
