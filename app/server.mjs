import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { db, ensureDefaultAdmin, verifyPassword, slotAvailableCount } from './lib/db.mjs';
import { createSession, readSession, sessionCookie, clearSessionCookie } from './lib/session.mjs';
import { sendWhatsApp } from './lib/whatsapp.mjs';
import * as publicViews from './views/public.mjs';
import * as adminViews from './views/admin.mjs';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = new URL('./public/', import.meta.url).pathname;

ensureDefaultAdmin();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function redirect(res, location, cookie = null) {
  const headers = { Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}

async function parseBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const ctype = req.headers['content-type'] || '';
  if (ctype.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  if (ctype.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

function parseFlash(url) {
  const f = url.searchParams.get('flash');
  const t = url.searchParams.get('ftype');
  if (!f) return null;
  return { message: f, type: t === 'error' ? 'error' : t === 'info' ? 'info' : 'success' };
}

function flashRedirect(res, path, message, type = 'success') {
  const u = new URL(path, 'http://x');
  u.searchParams.set('flash', message);
  u.searchParams.set('ftype', type);
  redirect(res, u.pathname + u.search);
}

function requireAdmin(req) {
  return readSession(req.headers.cookie);
}

async function serveStatic(req, res, urlPath) {
  const safePath = urlPath.replace(/^\/public\//, '').replace(/\.\./g, '');
  const file = join(PUBLIC_DIR, safePath);
  try {
    await stat(file);
    const data = await readFile(file);
    const mime = MIME[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---------- route handlers ----------

function handleHome(req, res, url) {
  const campaigns = db.prepare(`
    SELECT * FROM campaigns
    WHERE status = 'active'
    ORDER BY datetime(COALESCE(start_date, created_at)) ASC
  `).all();
  send(res, 200, publicViews.homePage({ campaigns, flash: parseFlash(url) }));
}

function handleCampaignDetail(req, res, url, slug) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE slug = ?').get(slug);
  if (!campaign) {
    send(res, 404, publicViews.campaignPage({ campaign: null, slots: [], flash: null }));
    return;
  }
  const slots = db.prepare(`
    SELECT * FROM time_slots WHERE campaign_id = ? ORDER BY datetime(slot_datetime) ASC
  `).all(campaign.id).map(s => ({ ...s, available: slotAvailableCount(s.id) }));
  send(res, 200, publicViews.campaignPage({ campaign, slots, flash: parseFlash(url) }));
}

async function handleRegister(req, res) {
  const body = await parseBody(req);
  const campaignId = Number(body.campaign_id);
  const slotId = Number(body.slot_id);
  const fullName = String(body.full_name || '').trim();
  const tiktok = String(body.tiktok_username || '').trim();
  const whatsapp = String(body.whatsapp_number || '').trim();
  const followers = body.followers_count ? Number(body.followers_count) : null;
  const city = String(body.city || '').trim() || null;
  const notes = String(body.notes || '').trim() || null;

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign || campaign.status !== 'active') {
    return flashRedirect(res, '/', 'الحملة غير متاحة', 'error');
  }
  if (!fullName || !tiktok || !whatsapp) {
    return flashRedirect(res, `/campaign/${campaign.slug}`, 'يرجى تعبئة الحقول الإلزامية', 'error');
  }
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ? AND campaign_id = ?').get(slotId, campaignId);
  if (!slot) {
    return flashRedirect(res, `/campaign/${campaign.slug}`, 'يرجى اختيار موعد صحيح', 'error');
  }
  if (slotAvailableCount(slotId) <= 0) {
    return flashRedirect(res, `/campaign/${campaign.slug}`, 'الموعد المختار مكتمل', 'error');
  }

  db.prepare(`
    INSERT INTO registrations
      (campaign_id, slot_id, full_name, tiktok_username, followers_count, whatsapp_number, city, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(campaignId, slotId, fullName, tiktok, followers, whatsapp, city, notes);

  send(res, 200, publicViews.registrationSuccessPage({ campaign }));
}

// ---------- admin ----------

function handleAdminHome(req, res, url) {
  const session = requireAdmin(req);
  if (!session) return redirect(res, '/admin/login');
  const stats = {
    campaigns: db.prepare('SELECT COUNT(*) c FROM campaigns').get().c,
    activeCampaigns: db.prepare("SELECT COUNT(*) c FROM campaigns WHERE status='active'").get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM registrations WHERE status='pending'").get().c,
    approved: db.prepare("SELECT COUNT(*) c FROM registrations WHERE status='approved'").get().c,
  };
  send(res, 200, adminViews.dashboardPage({ stats, flash: parseFlash(url) }));
}

function handleAdminLoginPage(req, res, url) {
  if (requireAdmin(req)) return redirect(res, '/admin');
  send(res, 200, adminViews.loginPage({ flash: parseFlash(url) }));
}

async function handleAdminLogin(req, res) {
  const body = await parseBody(req);
  const row = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(body.username || '');
  if (!row || !verifyPassword(body.password || '', row.password_hash)) {
    return flashRedirect(res, '/admin/login', 'بيانات الدخول غير صحيحة', 'error');
  }
  const token = createSession(row.id);
  redirect(res, '/admin', sessionCookie(token));
}

function handleAdminLogout(req, res) {
  redirect(res, '/admin/login', clearSessionCookie());
}

function handleAdminCampaignsList(req, res, url) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const campaigns = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM registrations r WHERE r.campaign_id = c.id) AS registrations_count
    FROM campaigns c ORDER BY datetime(c.created_at) DESC
  `).all();
  send(res, 200, adminViews.campaignsListPage({ campaigns, flash: parseFlash(url) }));
}

function handleAdminCampaignNew(req, res, url) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  send(res, 200, adminViews.campaignFormPage({ campaign: null, isNew: true, flash: parseFlash(url) }));
}

function handleAdminCampaignEdit(req, res, url, id) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(id));
  if (!campaign) return flashRedirect(res, '/admin/campaigns', 'الحملة غير موجودة', 'error');
  const slots = db.prepare('SELECT * FROM time_slots WHERE campaign_id = ? ORDER BY datetime(slot_datetime)').all(campaign.id);
  send(res, 200, adminViews.campaignFormPage({ campaign, slots, isNew: false, flash: parseFlash(url) }));
}

async function handleAdminCampaignCreate(req, res) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const b = await parseBody(req);
  try {
    const info = db.prepare(`
      INSERT INTO campaigns (slug, title, description, goal, location, start_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(b.slug || '').trim(),
      String(b.title || '').trim(),
      b.description || null,
      b.goal || null,
      b.location || null,
      b.start_date || null,
      b.end_date || null,
      b.status === 'closed' ? 'closed' : 'active'
    );
    flashRedirect(res, `/admin/campaigns/${info.lastInsertRowid}/edit`, 'تم إنشاء الحملة. أضف الأوقات الآن.');
  } catch (e) {
    flashRedirect(res, '/admin/campaigns/new', `خطأ: ${e.message}`, 'error');
  }
}

async function handleAdminCampaignUpdate(req, res, id) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const b = await parseBody(req);
  try {
    db.prepare(`
      UPDATE campaigns SET slug=?, title=?, description=?, goal=?, location=?, start_date=?, end_date=?, status=?
      WHERE id=?
    `).run(
      String(b.slug || '').trim(),
      String(b.title || '').trim(),
      b.description || null,
      b.goal || null,
      b.location || null,
      b.start_date || null,
      b.end_date || null,
      b.status === 'closed' ? 'closed' : 'active',
      Number(id)
    );
    flashRedirect(res, `/admin/campaigns/${id}/edit`, 'تم حفظ التعديلات');
  } catch (e) {
    flashRedirect(res, `/admin/campaigns/${id}/edit`, `خطأ: ${e.message}`, 'error');
  }
}

async function handleAdminSlotAdd(req, res, campaignId) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const b = await parseBody(req);
  const dt = String(b.slot_datetime || '').trim();
  const cap = Math.max(1, Number(b.capacity || 1));
  if (!dt) return flashRedirect(res, `/admin/campaigns/${campaignId}/edit`, 'أدخل تاريخ/وقت صحيح', 'error');
  db.prepare('INSERT INTO time_slots (campaign_id, slot_datetime, capacity) VALUES (?, ?, ?)')
    .run(Number(campaignId), new Date(dt).toISOString(), cap);
  flashRedirect(res, `/admin/campaigns/${campaignId}/edit`, 'تمت إضافة الموعد');
}

async function handleAdminSlotDelete(req, res, slotId) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const slot = db.prepare('SELECT campaign_id FROM time_slots WHERE id = ?').get(Number(slotId));
  if (slot) db.prepare('DELETE FROM time_slots WHERE id = ?').run(Number(slotId));
  flashRedirect(res, `/admin/campaigns/${slot ? slot.campaign_id : ''}/edit`, 'تم حذف الموعد');
}

function handleAdminRegistrations(req, res, url) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const filter = url.searchParams.get('filter') || 'all';
  let where = '';
  const params = [];
  if (filter !== 'all') { where = 'WHERE r.status = ?'; params.push(filter); }
  const registrations = db.prepare(`
    SELECT r.*, c.title AS campaign_title, c.slug AS campaign_slug, s.slot_datetime
    FROM registrations r
    JOIN campaigns c ON c.id = r.campaign_id
    LEFT JOIN time_slots s ON s.id = r.slot_id
    ${where}
    ORDER BY datetime(r.created_at) DESC
  `).all(...params);
  send(res, 200, adminViews.registrationsPage({ registrations, filter, flash: parseFlash(url) }));
}

async function handleAdminRegistrationDecide(req, res, id, decision) {
  if (!requireAdmin(req)) return redirect(res, '/admin/login');
  const newStatus = decision === 'approve' ? 'approved' : 'rejected';
  const reg = db.prepare(`
    SELECT r.*, c.title AS campaign_title, c.location, s.slot_datetime
    FROM registrations r
    JOIN campaigns c ON c.id = r.campaign_id
    LEFT JOIN time_slots s ON s.id = r.slot_id
    WHERE r.id = ?
  `).get(Number(id));
  if (!reg) return flashRedirect(res, '/admin/registrations', 'السجل غير موجود', 'error');

  db.prepare('UPDATE registrations SET status=?, responded_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(newStatus, Number(id));

  // إرسال واتساب (stub أو حقيقي)
  try {
    await sendWhatsApp({
      to: reg.whatsapp_number,
      fullName: reg.full_name,
      campaignTitle: reg.campaign_title,
      slotDatetime: reg.slot_datetime,
      location: reg.location,
      status: newStatus,
    });
  } catch (e) {
    console.error('WhatsApp send error:', e);
  }

  flashRedirect(res, '/admin/registrations', `تم ${newStatus === 'approved' ? 'اعتماد' : 'رفض'} الطلب وإرسال الإشعار`);
}

// ---------- router ----------

const routes = [
  // static
  { method: 'GET', pattern: /^\/public\//, handler: (req, res, u) => serveStatic(req, res, u.pathname) },

  // public
  { method: 'GET', pattern: /^\/$/, handler: handleHome },
  { method: 'GET', pattern: /^\/campaign\/([a-z0-9-]+)$/, handler: (req, res, u, m) => handleCampaignDetail(req, res, u, m[1]) },
  { method: 'POST', pattern: /^\/api\/register$/, handler: handleRegister },

  // admin pages
  { method: 'GET', pattern: /^\/admin\/?$/, handler: handleAdminHome },
  { method: 'GET', pattern: /^\/admin\/login$/, handler: handleAdminLoginPage },
  { method: 'POST', pattern: /^\/api\/admin\/login$/, handler: handleAdminLogin },
  { method: 'POST', pattern: /^\/api\/admin\/logout$/, handler: handleAdminLogout },

  { method: 'GET', pattern: /^\/admin\/campaigns$/, handler: handleAdminCampaignsList },
  { method: 'GET', pattern: /^\/admin\/campaigns\/new$/, handler: handleAdminCampaignNew },
  { method: 'GET', pattern: /^\/admin\/campaigns\/(\d+)\/edit$/, handler: (req, res, u, m) => handleAdminCampaignEdit(req, res, u, m[1]) },

  { method: 'POST', pattern: /^\/api\/admin\/campaigns$/, handler: handleAdminCampaignCreate },
  { method: 'POST', pattern: /^\/api\/admin\/campaigns\/(\d+)$/, handler: (req, res, u, m) => handleAdminCampaignUpdate(req, res, m[1]) },
  { method: 'POST', pattern: /^\/api\/admin\/campaigns\/(\d+)\/slots$/, handler: (req, res, u, m) => handleAdminSlotAdd(req, res, m[1]) },
  { method: 'POST', pattern: /^\/api\/admin\/slots\/(\d+)\/delete$/, handler: (req, res, u, m) => handleAdminSlotDelete(req, res, m[1]) },

  { method: 'GET', pattern: /^\/admin\/registrations$/, handler: handleAdminRegistrations },
  { method: 'POST', pattern: /^\/api\/admin\/registrations\/(\d+)\/(approve|reject)$/, handler: (req, res, u, m) => handleAdminRegistrationDecide(req, res, m[1], m[2]) },
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.pattern);
      if (m) return await r.handler(req, res, url, m);
    }
    send(res, 404, '<h1>الصفحة غير موجودة</h1><a href="/">العودة للرئيسية</a>');
  } catch (err) {
    console.error('Server error:', err);
    send(res, 500, '<h1>خطأ داخلي في الخادم</h1>');
  }
});

server.listen(PORT, () => {
  console.log(`\n✔ منصة الحملات تعمل على: http://localhost:${PORT}`);
  console.log(`  لوحة الأدمن: http://localhost:${PORT}/admin\n`);
});
