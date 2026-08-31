// Shared config for all functions.
//
// EXPLORER_API: LitVM Testnet ("LiteForge") explorer is a standard Blockscout
// instance. Blockscout's public REST API is documented (per-deployment) at
// <explorer-url>/api-docs — check that page after you deploy in case any
// field names below have shifted on this particular instance/version.
const EXPLORER_BASE = process.env.EXPLORER_BASE_URL || 'https://liteforge.explorer.caldera.xyz';
const EXPLORER_API = `${EXPLORER_BASE}/api/v2`;

// Swaps aren't a native concept on an EVM chain — a "swap" is just a
// contract call to a DEX router/pool. To count them accurately we need the
// router contract address(es) of whatever DEX(es) are live on LitVM testnet
// (e.g. the Lester Labs DEX). Add them here as you find them.
// Until this list is filled in, the UI shows an ERC-20 transfer count
// labeled honestly as an approximation rather than a fake "swap count".
const KNOWN_DEX_ROUTERS = (process.env.DEX_ROUTER_ADDRESSES || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const CHAIN_ID = 4441;

module.exports = { EXPLORER_BASE, EXPLORER_API, KNOWN_DEX_ROUTERS, CHAIN_ID };
