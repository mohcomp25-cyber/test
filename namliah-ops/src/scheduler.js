'use strict';
const cron = require('node-cron');
const apify = require('./services/apify');

function start() {
  const schedule = process.env.REVIEWS_CRON || '30 3 * * *';
  cron.schedule(schedule, async () => {
    const branches = apify.configuredBranches();
    if (!branches.length) {
      console.warn('[scheduler] reviews sync skipped — لا يوجد فرع مُعد (APIFY_TOKEN / GOOGLE_MAPS_URL_*)');
      return;
    }
    for (const branch of branches) {
      console.log(`[scheduler] starting Google Maps reviews sync for ${branch}…`);
      const result = await apify.syncReviews(branch, null);
      console.log(`[scheduler] reviews sync (${branch}) finished:`, JSON.stringify(result));
    }
  }, { timezone: 'Asia/Riyadh' });
  console.log(`[scheduler] reviews sync scheduled (${schedule} Asia/Riyadh)`);
}

module.exports = { start };
