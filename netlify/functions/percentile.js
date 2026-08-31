const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const address = ((event.queryStringParameters || {}).address || '').toLowerCase();
  if (!address) {
    return { statusCode: 400, body: JSON.stringify({ error: 'address لازم است' }) };
  }

  const store = getStore('litvm-leaderboard');
  const snapshot = await store.get('snapshot', { type: 'json' });

  if (!snapshot) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ready: false,
        message: 'لیدربورد هنوز ساخته نشده — بعد از اولین اجرای leaderboard-refresh آماده میشه.',
      }),
    };
  }

  const idx = snapshot.wallets.findIndex((w) => w.address.toLowerCase() === address);

  if (idx === -1) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ready: true,
        found: false,
        walletCount: snapshot.walletCount,
        generatedAt: snapshot.generatedAt,
        message: 'این آدرس هنوز در آخرین اسنپ‌شات لیدربورد دیده نشده.',
      }),
    };
  }

  // idx 0 = highest tx count. Rank is 1-based.
  const rank = idx + 1;
  const topPercent = (rank / snapshot.walletCount) * 100;

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      ready: true,
      found: true,
      rank,
      walletCount: snapshot.walletCount,
      txCount: snapshot.wallets[idx].txCount,
      topPercent: Number(topPercent.toFixed(2)),
      generatedAt: snapshot.generatedAt,
      snapshotComplete: snapshot.complete,
    }),
  };
};
