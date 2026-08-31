const { EXPLORER_API, KNOWN_DEX_ROUTERS } = require('./_config');

const isAddress = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000), // don't let one slow endpoint eat the whole function budget
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

async function collectPaginated(path, { maxPages = 20 } = {}) {
  let url = `${EXPLORER_API}${path}`;
  const items = [];
  for (let page = 0; page < maxPages && url; page++) {
    const data = await getJSON(url);
    if (!data) break;
    items.push(...(data.items || []));
    if (data.next_page_params) {
      const qs = new URLSearchParams(data.next_page_params).toString();
      const base = `${EXPLORER_API}${path}`;
      const sep = base.includes('?') ? '&' : '?';
      url = `${base}${sep}${qs}`;
    } else {
      url = null;
    }
  }
  return items;
}

// Wraps a piece of work so that if OUR ASSUMPTION about an endpoint/field is
// wrong, that one section degrades to a default value + a note, instead of
// taking down the entire wallet-stats response with a 502.
async function section(name, fn, fallback) {
  try {
    return { name, ok: true, value: await fn() };
  } catch (err) {
    return { name, ok: false, value: fallback, error: String(err.message || err) };
  }
}

exports.handler = async (event) => {
  const address = (event.queryStringParameters || {}).address || '';

  if (!isAddress(address)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'یک آدرس والت معتبر EVM (0x...) بفرست' }),
    };
  }

  // Only the base address lookup is load-bearing: if THIS fails, we have
  // nothing to show at all, so it's fine to error out here.
  let info;
  try {
    info = await getJSON(`${EXPLORER_API}/addresses/${address}`);
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'اکسپلورر LitVM جواب نداد', detail: String(err) }),
    };
  }

  if (!info) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        address,
        found: false,
        message: 'این آدرس هیچ فعالیتی روی LitVM Testnet نداره.',
      }),
    };
  }

  // Every other section runs independently — a wrong field-name guess in
  // one of these only zeroes out that one stat, not the whole response.
  const [countersR, outgoingR, nftR] = await Promise.all([
    section('counters', () => getJSON(`${EXPLORER_API}/addresses/${address}/counters`), null),
    section(
      'outgoingTxs',
      () => collectPaginated(`/addresses/${address}/transactions?filter=from`, { maxPages: 15 }),
      []
    ),
    section(
      'nftTransfers',
      () => collectPaginated(`/addresses/${address}/token-transfers?type=ERC-721,ERC-1155`, { maxPages: 10 }),
      []
    ),
  ]);

  const counters = countersR.value;
  const outgoingTxs = outgoingR.value;
  const nftTransfers = nftR.value;

  const deployments = outgoingTxs.filter((tx) => (tx.tx_types || []).includes('contract_creation'));
  const uniqueNftTokens = new Set(nftTransfers.map((t) => t.token && t.token.address).filter(Boolean));

  let swaps = null;
  let erc20TransferCount = null;
  let erc20R = { ok: true };
  if (KNOWN_DEX_ROUTERS.length > 0) {
    const routerCalls = outgoingTxs.filter((tx) =>
      KNOWN_DEX_ROUTERS.includes(((tx.to && tx.to.hash) || '').toLowerCase())
    );
    swaps = routerCalls.length;
  } else {
    erc20R = await section(
      'erc20Transfers',
      () => collectPaginated(`/addresses/${address}/token-transfers?type=ERC-20`, { maxPages: 10 }),
      []
    );
    erc20TransferCount = erc20R.value.length;
  }

  const failedSections = [countersR, outgoingR, nftR, erc20R]
    .filter((s) => s.ok === false)
    .map((s) => ({ section: s.name, error: s.error }));

  const stats = {
    address,
    found: true,
    isContract: !!info.is_contract,
    coinBalance: info.coin_balance,
    transactionsCount: Number((counters && counters.transactions_count) || info.transactions_count || 0),
    tokenTransfersCount: Number((counters && counters.token_transfers_count) || 0),
    gasUsed: (counters && counters.gas_usage_count) || null,
    contractDeployments: deployments.length,
    nftTransfersCount: nftTransfers.length,
    uniqueNftContracts: uniqueNftTokens.size,
    swaps,
    erc20TransferCountApprox: erc20TransferCount,
    swapsAreApproximate: swaps === null,
    partial: failedSections.length > 0,
    failedSections: failedSections.length > 0 ? failedSections : undefined,
  };

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(stats),
  };
};
