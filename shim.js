/*
 * Conecta el panel con el servidor propio.
 * Ofrece la misma interfaz que usaba la versión dentro de Claude
 * (datos compartidos, descargas y usuario), pero hablando con /api.
 */
(function () {
  "use strict";
  const POLL_MS = 30000;
  let data = null, version = null, me = null, loading = null;
  const listeners = {}; // colección -> [{next, error}]

  async function api(path, opts = {}) {
    const r = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
    if (r.status === 401) { location.href = "/login"; throw { code: "revoked", message: "Sesión cerrada" }; }
    let body = null; try { body = await r.json(); } catch (e) {}
    if (!r.ok) {
      const code = r.status === 403 ? "invalid_argument" : r.status === 429 ? "resource_exhausted" : r.status >= 500 ? "unavailable" : "invalid_argument";
      throw { code, message: (body && body.error) || "Error " + r.status };
    }
    return body;
  }
  function snapDocs(col) {
    return (data && data[col] ? data[col] : []).map(d => ({ id: d.id, exists: true, data: () => d.data, metadata: { fromCache: false, hasPendingWrites: false } }));
  }
  function notify(col) {
    (listeners[col] || []).forEach(l => { const docs = snapDocs(col); try { l.next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }); } catch (e) { console.error(e); } });
  }
  async function load() {
    if (loading) return loading;
    loading = api("/api/data").then(r => { data = r.data || {}; version = r.version; Object.keys(listeners).forEach(notify); }).finally(() => { loading = null; });
    return loading;
  }
  async function poll() {
    try { const r = await api("/api/version"); if (r.version !== version) await load(); } catch (e) { /* sin conexión: se reintenta */ }
  }
  setInterval(poll, POLL_MS);
  window.addEventListener("focus", poll);
  function localSet(col, id, body) {
    data = data || {}; const arr = data[col] = data[col] || [];
    const i = arr.findIndex(d => d.id === id);
    if (body === null) { if (i >= 0) arr.splice(i, 1); } else if (i >= 0) arr[i] = { id, data: body }; else arr.push({ id, data: body });
    notify(col);
  }
  function docRef(path) {
    const parts = String(path).split("/"); const col = parts[0], id = parts.slice(1).join("/");
    return {
      id, path,
      async get() { if (!data) await load(); const d = (data[col] || []).find(x => x.id === id); return { id, exists: !!d, data: () => (d ? d.data : undefined) }; },
      async set(body) { const r = await api(`/api/doc/${col}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }); version = r.version; localSet(col, id, JSON.parse(JSON.stringify(body))); },
      async update(body) { const cur = await this.get(); await this.set(Object.assign({}, cur.data() || {}, body)); },
      async delete() { const r = await api(`/api/doc/${col}/${encodeURIComponent(id)}`, { method: "DELETE" }); version = r.version; localSet(col, id, null); },
    };
  }
  const db = {
    doc: docRef,
    collection(col) {
      return {
        path: col,
        doc: id => docRef(col + "/" + id),
        onSnapshot(next, error) {
          const l = { next, error }; (listeners[col] = listeners[col] || []).push(l);
          if (data) setTimeout(() => notify(col), 0); else load().catch(e => error && error(e));
          return () => { listeners[col] = (listeners[col] || []).filter(x => x !== l); };
        },
        async get() { if (!data) await load(); const docs = snapDocs(col); return { docs, size: docs.length, empty: !docs.length }; },
      };
    },
  };
  const downloads = {
    async save({ filename, data: content }) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: /\.csv$/i.test(filename) ? "text/csv;charset=utf-8" : "application/octet-stream" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
  };
  const meP = api("/api/me").then(r => (me = r.user)).catch(() => null);
  const user = {
    async id() { await meP; return me ? "u" + me.id : null; },
    async me() { await meP; return me ? { id: "u" + me.id, name: me.name } : { id: null, name: "" }; },
    isOwner() { return !!me && me.role === "admin"; },
    canEdit() { return !!me && me.role === "admin"; },
    async can(what) { await meP; if (!me) return false; if (what === "data.write") return me.role !== "viewer"; return me.role === "admin"; },
  };
  const caps = { db, downloads, user };
  window.claude = { use: name => Promise.resolve(caps[name] || null) };

  // Barra de usuario: nombre, permisos, administración y salir
  const ROLE = { admin: "Administrador", editor: "Editor", viewer: "Solo lectura" };
  function userBar() {
    const host = document.querySelector(".pickers"); if (!host || !me || document.getElementById("userBar")) return;
    const box = document.createElement("div"); box.id = "userBar"; box.className = "userbar";
    box.innerHTML = `<span class="who-me"><b></b><small></small></span><a class="btn" href="/usuarios">${me.role === "admin" ? "Usuarios" : "Mi cuenta"}</a><button class="btn" type="button" id="btnSalir">Salir</button>`;
    box.querySelector("b").textContent = me.name; box.querySelector("small").textContent = ROLE[me.role] || me.role;
    host.appendChild(box);
    box.querySelector("#btnSalir").addEventListener("click", async () => { await fetch("/api/logout", { credentials: "same-origin" }); location.href = "/login"; });
  }
  meP.then(() => { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", userBar); else userBar(); });
})();
