// The radar's one model. Shared, by import, between the program that writes
// board.json (main.ts, via lib/radar.ts) and the page that renders it
// (dashboard/app.js), so the board's numbers and the page's numbers can never
// drift apart: the page recomputes every row with these same functions and
// says so when a row disagrees.
//
// What it scores: a protocol's implied value if it launched a token today.
// The three inputs are the snapshot's own figures — TVL, seven-day growth,
// and how long the protocol has run with no token. The base multiple is not a
// house guess: it is the median market-cap-to-TVL ratio of the live-token
// protocols in this same snapshot, calibrated at run time (see
// calibrateMultiple). No protocol name is ever special-cased.

/** The model's version label, shown on the page. */
export const MODEL_VERSION = 'radar-2';

/** The model's shape. base_multiple is filled in by calibrateMultiple. */
export const MODEL_DEFAULTS = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when unknown. */
export function ageDays(asOf, listedAt) {
  if (listedAt === null || listedAt === undefined) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * The implied value one protocol gets under `model`, with every multiplier
 * exposed so the page can show the arithmetic, not just the answer.
 *
 *   base       = tvl_usd x base_multiple
 *   growth     = clamp(change_7d, floor, cap), unknown growth counts as 0
 *   growthMult = 1 + (growth / 100) x growth_weight
 *   maturity   = floor + min(age, maturity_days) / maturity_days x range
 *   implied    = max(1, round(base x growthMult x maturity))
 */
export function impliedValue(protocol, asOf, model) {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age === null ? model.unknown_age_days : age;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult: round4(growthMult), maturityMult: round4(maturityMult), age };
}

/**
 * The base multiple, calibrated from the snapshot itself: the median
 * market-cap-to-TVL ratio across the live-token protocols (exchanges excluded,
 * like everywhere else). The median is used because a few live tokens trade at
 * many times their TVL and would drag a mean far from the typical protocol.
 * Returns the median plus the quartiles and the count, for the page to state.
 */
export function calibrateMultiple(protocols) {
  const ratios = protocols
    .filter(isTrading)
    .map((p) => p.mcap_usd / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length < 10) return { multiple: MODEL_DEFAULTS.base_multiple, median: MODEL_DEFAULTS.base_multiple, p25: null, p75: null, n: ratios.length, calibrated: false };
  const at = (q) => ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))];
  const median = ratios.length % 2 === 1 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;
  return { multiple: round4(median), median: round4(median), p25: round4(at(0.25)), p75: round4(at(0.75)), n: ratios.length, calibrated: true };
}

/** Whether a protocol already trades: a market cap on record, with TVL behind it. */
export function isTrading(p) {
  return (
    p.category !== 'CEX' &&
    typeof p.mcap_usd === 'number' &&
    Number.isFinite(p.mcap_usd) &&
    p.mcap_usd > 0 &&
    typeof p.tvl_usd === 'number' &&
    p.tvl_usd > 0
  );
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p) {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p) {
  return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
}

/**
 * What one transaction typically costs on a chain, in words a farmer can plan
 * around. Only the chains this snapshot's protocols actually run on are
 * listed; anything else gets the neutral line. These are ordinary conditions,
 * not a quote: gas spikes, and the plan says so where it matters.
 */
const GAS_TABLE = {
  Ethereum: 'about $4–$12 of gas, more when the network is busy',
  Solana: 'under $0.05 of gas',
  Binance: 'under $0.25 of gas',
  Arbitrum: 'under $0.50 of gas',
  Base: 'under $0.25 of gas',
  Optimism: 'under $0.50 of gas',
  Polygon: 'under $0.25 of gas',
  Avalanche: 'under $0.50 of gas',
  Tron: 'about $1 of gas',
  Hyperliquid: 'under $0.10 of gas',
  'Hyperliquid L1': 'under $0.10 of gas',
  Monad: 'under $0.10 of gas',
  Plasma: 'under $0.25 of gas',
  Ink: 'under $0.25 of gas',
  Unichain: 'under $0.25 of gas',
  Sui: 'under $0.10 of gas',
  Aptos: 'under $0.05 of gas',
  Berachain: 'under $0.25 of gas',
};

function gasFor(chain) {
  return GAS_TABLE[chain] ?? 'a few dollars of gas at most';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p) {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p, capital, chain) {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('liquid staking') || c.includes('staking pool') || c.includes('restak') || c === 'staking' || c.includes('staking'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('canonical bridge') || c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside the app it points to.`;
  if (c.includes('dex') || c.includes('exchange'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('leveraged farm'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain} and leave it compounding.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it in the farming wallet.`;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it so the wallet shows both sides of the market.`;
  if (c.includes('cdp') || c.includes('collateral')) return `Lock $${capital} of collateral in ${name} on ${chain} and mint its stable asset against it.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, then close it; the deposit is what counts.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the receipt.`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and place one market position on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy for the full term.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} onto the chain through ${name}'s own route and use one of its native apps with the funds.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step) {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record — category, chains,
 * TVL, age — never from a hand-written list of names. The costs name the
 * protocol's own chain, so a Solana farm does not quote Ethereum gas.
 */
export function farmSteps(p, age) {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline and off any screenshot.',
      cost: gas + ' for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: 'Come back once a week and make one more qualifying action: a second deposit, a borrow against the position, a swap through the protocol, or a vote if it has one.',
      cost: gas + ' a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Check the protocol's own points or rewards page once a week and write down the balance; points rules change without notice and a log is the only proof of what you earned.",
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: 'When a claim opens, use only the link the protocol itself publishes on its own site or verified account. Never pay a fee to claim, and never connect a wallet from a link in a direct message.',
      cost: 'claim gas only, on the protocol’s own page',
      time: '10 minutes',
    },
    {
      text: 'Keep a farm log — the wallet, the dates, every transaction — and decide the price at which you will sell before the token lists, so the listing day is an execution, not a decision.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}
