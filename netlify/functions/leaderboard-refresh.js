const { getStore } = require('@netlify/blobs');
const { EXPLORER_API } = require('./_config');

// PROBLEM THIS FIXES:
// A full crawl of every wallet can be thousands of pages. Netlify Functions
// have a hard execution ceiling (10s default, up to 26s on paid plans) —
// trying to crawl everything in one invocation will get killed mid-way and
// never produce a snapshot. So instead of one giant run, each invocation
// only does a small, time-boxed batch of pages, saves its progress (cursor
// + wallets seen so far) to Blobs, and picks up where it left off next time
// it's triggered. Only when a full pass finishes does it publish the
// result as the "official" snapshot that percentile.js reads — readers
// never see a half-built pass.
const PAGE_ITEMS = 50;
const MAX_PAGES_PER_RUN = 25; // ~25 sequential requests fits comfortably under 26s
const TIME_BUDGET_MS = 20000; // extra safety net independent of page count

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

exports.handler = async () => {
  const store = getStore('litvm-leaderboard');
  const started = Date.now();

  // Resume an in-progress pass, or start a new one.
  let progress = (await store.get('crawl-progress', { type: 'json' })) || {
    cursorParams: null,
    walletsById: {},
  };

  let url = progress.cursorParams
    ? `${EXPLORER_API}/addresses?items_count=${PAGE_ITEMS}&${new URLSearchParams(progress.cursorParams).toString()}`
    : `${EXPLORER_API}/addresses?items_count=${PAGE_ITEMS}`;

  let pagesThisRun = 0;
  let finishedFullPass = false;

  try {
    while (url && pagesThisRun < MAX_PAGES_PER_RUN && Date.now() - started < TIME_BUDGET_MS) {
      const data = await getJSON(url);
      for (const item of data.items || []) {
        progress.walletsById[item.hash] = Number(item.transactions_count || 0);
      }
      pagesThisRun++;

      if (data.next_page_params) {
        progress.cursorParams = data.next_page_params;
        url = `${EXPLORER_API}/addresses?items_count=${PAGE_ITEMS}&${new URLSearchParams(data.next_page_params).toString()}`;
      } else {
        finishedFullPass = true;
        url = null;
      }
    }

    if (finishedFullPass) {
      const wallets = Object.entries(progress.walletsById)
        .map(([address, txCount]) => ({ address, txCount }))
        .sort((a, b) => b.txCount - a.txCount);

      await store.setJSON('snapshot', {
        generatedAt: new Date().toISOString(),
        walletCount: wallets.length,
        complete: true,
        wallets,
      });

      // Reset progress so the next scheduled run starts a fresh pass
      // (keeps the leaderboard from going stale as new wallets show up).
      await store.setJSON('crawl-progress', { cursorParams: null, walletsById: {} });

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, finishedFullPass: true, walletCount: wallets.length }),
      };
    }

    // Not done yet — save progress for the next invocation to pick up.
    await store.setJSON('crawl-progress', progress);
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        finishedFullPass: false,
        pagesThisRun,
        walletsSeenSoFar: Object.keys(progress.walletsById).length,
      }),
    };
  } catch (err) {
    // Keep whatever progress we made before the error, so we don't lose it.
    await store.setJSON('crawl-progress', progress);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
