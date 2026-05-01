// R2 helpers + signed file URLs (signed via our own JWT, not S3 sigV4).

import { signJwt, verifyJwt } from "./auth.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 8 * 1024 * 1024;

export function isAllowedType(t) {
  return ALLOWED_TYPES.includes((t || "").toLowerCase());
}

export function maxBytes() {
  return MAX_BYTES;
}

export async function putObject(env, key, body, contentType) {
  await env.ATTACHMENTS.put(key, body, { httpMetadata: { contentType } });
}

export async function getObject(env, key) {
  return env.ATTACHMENTS.get(key);
}

export async function deleteObject(env, key) {
  await env.ATTACHMENTS.delete(key);
}

export async function signFileToken(env, key, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return signJwt({ k: key, exp, typ: "file" }, env.JWT_SECRET);
}

export async function verifyFileToken(env, token) {
  const claims = await verifyJwt(token, env.JWT_SECRET);
  if (!claims || claims.typ !== "file") return null;
  return claims.k;
}
