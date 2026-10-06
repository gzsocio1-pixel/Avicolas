"use strict";
/* Crea o reinicia un usuario administrador.
   Uso: npm run crear-admin -- usuario "contraseña larga" */
const { createStore } = require("../lib/store");
const { hashPassword } = require("../lib/password");
(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 8) { console.log('Uso: npm run crear-admin -- usuario "contraseña de 8 o más caracteres"'); process.exit(1); }
  const store = createStore(); await store.init();
  const u = await store.getUserByName(username);
  if (u) { await store.updateUser(u.id, { pass_hash: hashPassword(password), role: "admin" }); console.log(`Listo: ${username} ahora es administrador y tiene contraseña nueva.`); }
  else { await store.createUser({ username, name: username, pass_hash: hashPassword(password), role: "admin" }); console.log(`Listo: se creó el administrador ${username}.`); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
