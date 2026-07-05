'use strict';
const cron = require('node-cron');
const apify = require('./services/apify');

function start() {
  const schedule = process.env.REVIEWS_CRON || '30 3 * * *';
  cron.schedule(schedule, async () => {
    if (!apify.isConfigured()) {
      console.warn('[scheduler] reviews sync skipped — APIFY_TOKEN / GOOGLE_MAPS_URL not set');
      return;
    }
    console.log('[scheduler] starting daily Google Maps reviews sync…');
    const result = await apify.syncReviews(null);
    console.log('[scheduler] reviews sync finished:', JSON.stringify(result));
  }, { timezone: 'Asia/Riyadh' });
  console.log(`[scheduler] reviews sync scheduled (${schedule} Asia/Riyadh)`);
}

module.exports = { start };
