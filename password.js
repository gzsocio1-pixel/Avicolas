"use strict";
const crypto = require("crypto");
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  return `scrypt$${salt}$${h}`;
}
function checkPassword(pw, stored) {
  const [alg, salt, h] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !h) return false;
  const a = Buffer.from(h, "hex"), b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { hashPassword, checkPassword };
