'use strict';
const { db, getSetting, setSetting, audit, BRANCHES, DEFAULT_BRANCH } = require('./../db');

const APIFY_BASE = 'https://api.apify.com/v2';
const POLL_INTERVAL_MS = 10 * 1000;
const RUN_TIMEOUT_MS = 8 * 60 * 1000;

// رابط قوقل ماب لكل فرع: GOOGLE_MAPS_URL_JEDDAH / _ABHA / _MAKKAH
// (GOOGLE_MAPS_URL القديم يُعامل كرابط جدة للتوافق)
function mapsUrlFor(branch) {
  const url = process.env[`GOOGLE_MAPS_URL_${branch.toUpperCase()}`];
  if (url) return url;
  if (branch === DEFAULT_BRANCH) return process.env.GOOGLE_MAPS_URL || null;
  return null;
}

function isConfigured(branch = DEFAULT_BRANCH) {
  return Boolean(process.env.APIFY_TOKEN && mapsUrlFor(branch));
}

function configuredBranches() {
  return Object.keys(BRANCHES).filter((b) => isConfigured(b));
}

function sentimentFor(rating) {
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
}

function actorId() {
  // e.g. compass~google-maps-reviews-scraper (Apify uses ~ instead of / in URLs)
  return (process.env.APIFY_ACTOR || 'compass~google-maps-reviews-scraper').replace('/', '~');
}

async function apifyFetch(pathname, options) {
  const url = `${APIFY_BASE}${pathname}${pathname.includes('?') ? '&' : '?'}token=${process.env.APIFY_TOKEN}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apify ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function startRun(branch, { full = false } = {}) {
  // المزامنة الليلية (full=false): مراجعات يوم العمل فقط (من أمس) توفيراً للتوكن.
  // المزامنة اليدوية الكاملة (full=true): تسحب التاريخ الأوسع — مناسبة لأول تشغيل
  // وعند الضغط على «مزامنة الآن». التكرار يُرشَّح تلقائياً بالـ upsert على external_id.
  const yesterdayRiyadh = new Date(Date.now() + 3 * 3600 * 1000 - 86400000)
    .toISOString().slice(0, 10);
  const input = {
    startUrls: [{ url: mapsUrlFor(branch) }],
    maxReviews: full
      ? Number(process.env.APIFY_MAX_REVIEWS_FULL || 300)
      : Number(process.env.APIFY_MAX_REVIEWS || 50),
    reviewsSort: 'newest',
    language: 'ar',
    personalData: true
  };
  // في الوضع الكامل لا نقيّد بتاريخ (نسحب التاريخ حتى الحد الأقصى)
  if (!full) {
    input.reviewsStartDate = process.env.APIFY_REVIEWS_START_DATE || yesterdayRiyadh;
  } else if (process.env.APIFY_REVIEWS_START_DATE) {
    input.reviewsStartDate = process.env.APIFY_REVIEWS_START_DATE;
  }
  const data = await apifyFetch(`/acts/${actorId()}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  return data.data; // { id, defaultDatasetId, status, ... }
}

async function waitForRun(runId) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const data = await apifyFetch(`/actor-runs/${runId}`);
    const run = data.data;
    if (run.status === 'SUCCEEDED') return run;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
      throw new Error(`Apify run ${run.status}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Apify run timed out');
}

async function fetchDataset(datasetId) {
  return apifyFetch(`/datasets/${datasetId}/items?clean=true&format=json`);
}

const upsertReview = db.prepare(`
  INSERT INTO reviews (external_id, branch, author_name, author_photo_url, rating, text, review_date, photos, owner_reply, sentiment, fetched_at, is_demo)
  VALUES (@external_id, @branch, @author_name, @author_photo_url, @rating, @text, @review_date, @photos, @owner_reply, @sentiment, datetime('now'), 0)
  ON CONFLICT(external_id) DO UPDATE SET
    branch = excluded.branch,
    rating = excluded.rating,
    text = excluded.text,
    photos = excluded.photos,
    owner_reply = excluded.owner_reply,
    sentiment = excluded.sentiment,
    fetched_at = excluded.fetched_at
`);

function mapItem(branch, item) {
  const rating = Math.max(1, Math.min(5, Math.round(Number(item.stars ?? item.rating ?? 0)) || 0));
  if (!rating) return null;
  const externalId = item.reviewId || item.id;
  if (!externalId) return null;
  const photos = Array.isArray(item.reviewImageUrls) ? item.reviewImageUrls
    : Array.isArray(item.images) ? item.images : [];
  return {
    external_id: String(externalId),
    branch,
    author_name: item.name || item.reviewerName || null,
    author_photo_url: item.reviewerPhotoUrl || item.userPhotoUrl || null,
    rating,
    text: item.text || item.textTranslated || null,
    review_date: item.publishedAtDate ? String(item.publishedAtDate).slice(0, 10) : null,
    photos: JSON.stringify(photos),
    owner_reply: item.responseFromOwnerText || null,
    sentiment: sentimentFor(rating)
  };
}

const saveAllTx = db.transaction((rows) => {
  let saved = 0;
  for (const row of rows) {
    upsertReview.run(row);
    saved++;
  }
  return saved;
});

async function syncReviews(branch, triggeredBy, opts = {}) {
  if (!isConfigured(branch)) {
    setSetting(`last_reviews_sync_status:${branch}`, 'not_configured');
    return { status: 'not_configured', branch };
  }
  if (getSetting(`reviews_sync_running:${branch}`) === '1') {
    return { status: 'already_running', branch };
  }
  setSetting(`reviews_sync_running:${branch}`, '1');
  try {
    const run = await startRun(branch, { full: !!opts.full });
    const finished = await waitForRun(run.id);
    const items = await fetchDataset(finished.defaultDatasetId);
    const rows = (Array.isArray(items) ? items : []).map((it) => mapItem(branch, it)).filter(Boolean);
    const saved = saveAllTx(rows);
    setSetting(`last_reviews_sync_at:${branch}`, new Date().toISOString());
    setSetting(`last_reviews_sync_status:${branch}`, 'ok');
    audit('reviews_synced', triggeredBy || null, { branch, fetched: rows.length, saved });
    return { status: 'ok', branch, saved };
  } catch (err) {
    setSetting(`last_reviews_sync_at:${branch}`, new Date().toISOString());
    setSetting(`last_reviews_sync_status:${branch}`, `error: ${err.message}`);
    audit('reviews_sync_failed', triggeredBy || null, { branch, error: err.message });
    return { status: 'error', branch, message: err.message };
  } finally {
    setSetting(`reviews_sync_running:${branch}`, '0');
  }
}

module.exports = { isConfigured, configuredBranches, syncReviews, sentimentFor };
