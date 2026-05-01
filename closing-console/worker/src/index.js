// Cloudflare Worker entry — REST router + static asset binding.

import { handleAccountant } from "./routes/accountant.js";
import { handleClosings } from "./routes/closings.js";
import { handleDeposits } from "./routes/deposits.js";
import { handleInventory } from "./routes/inventory.js";
import { handleUploads } from "./routes/uploads.js";
import { handlePublicLink } from "./routes/publicLink.js";
import { json, err, getIp } from "./routes/_util.js";
import { verifyFileToken, getObject } from "./r2.js";
import { cleanupOld as cleanupPinAttempts } from "./ratelimit.js";
import { hashPassword } from "./auth.js";
import { run, one } from "./db.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/") return Response.redirect(`${url.origin}/console/login.html`, 302);

    try {
      if (path === "/api/health") return json({ ok: true });

      if (path === "/api/files") return serveFile(req, env);

      if (env.ENVIRONMENT === "dev" && path === "/api/_dev/seed-accountant" && req.method === "POST") {
        return seedAccountant(req, env);
      }

      if (path.startsWith("/api/link/")) return handlePublicLink(req, env, ctx);
      if (path.startsWith("/api/auth/") || path.startsWith("/api/brands") || path.startsWith("/api/branches")
        || path.startsWith("/api/employees") || path.startsWith("/api/links")) return handleAccountant(req, env, ctx);
      if (path.startsWith("/api/closings")) return handleClosings(req, env, ctx);
      if (path.startsWith("/api/deposits") || path.startsWith("/api/safes") && path.includes("/deposits")) return handleDeposits(req, env, ctx);
      if (path.startsWith("/api/safes") || path.startsWith("/api/reports")) return handleInventory(req, env, ctx);
      if (path.startsWith("/api/uploads")) return handleUploads(req, env, ctx);

      if (path.startsWith("/api/")) return err(404, "not_found");

      // Fallback to static assets (console/, cashier/, README, etc.)
      if (env.ASSETS) return env.ASSETS.fetch(req);
      return err(404, "not_found");
    } catch (e) {
      console.error("worker error", e?.stack || e);
      return err(500, "server_error", { message: String(e?.message || e) });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupPinAttempts(env));
    ctx.waitUntil(cleanupPendingUploads(env));
  },
};

async function serveFile(req, env) {
  const url = new URL(req.url);
  const tok = url.searchParams.get("t");
  if (!tok) return err(400, "missing_token");
  const key = await verifyFileToken(env, tok);
  if (!key) return err(403, "bad_token");
  const obj = await getObject(env, key);
  if (!obj) return err(404, "not_found");
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=60",
    },
  });
}

async function seedAccountant(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || email.split("@")[0]);
  if (!email || !password || password.length < 6) return err(400, "bad_input");
  const existing = await one(env, `SELECT id FROM accountants WHERE email=?`, email);
  if (existing) return err(409, "exists");
  const hash = await hashPassword(password, env.PASSWORD_PEPPER || "");
  await run(env, `INSERT INTO accountants (email, password_hash, name) VALUES (?, ?, ?)`, email, hash, name);
  return json({ ok: true });
}

async function cleanupPendingUploads(env) {
  // Best-effort: list under uploads/pending/ and delete keys older than 24h.
  // R2 list is paginated; iterate in chunks.
  let cursor = undefined;
  const cutoff = Date.now() - 24 * 3600_000;
  do {
    const list = await env.ATTACHMENTS.list({ prefix: "uploads/pending/", cursor, limit: 1000 });
    for (const obj of list.objects) {
      if (obj.uploaded && new Date(obj.uploaded).getTime() < cutoff) {
        await env.ATTACHMENTS.delete(obj.key);
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
