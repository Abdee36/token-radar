// Token Radar's page. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, its filters, a per-protocol detail
// view with the model's own arithmetic and the farm plan, and a model sandbox
// that re-ranks the whole board live. No network: every byte shown is in
// data.js, and every number is recomputed here with dashboard/model.js — the
// same functions that wrote board.json.
import { MODEL_VERSION, farmSteps, impliedValue, stepText } from './model.js';

const DATA = window.RADAR;
const app = document.getElementById('board');
if (!DATA || !app) throw new Error('Token Radar: no data beside the page.');

const state = {
  q: '',
  category: 'all',
  chain: 'all',
  tab: 'pre-token',
  sort: 'implied',
  dir: -1,
  selected: null,
  sandbox: null, // null = the calibrated model; otherwise {base_multiple, growth_weight, maturity_floor}
};

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function fmtUsd(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return usd0.format(n);
}
function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function fmtAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return Math.max(0, Math.round(days)) + 'd';
}

/** The model in force: the calibrated one, or the sandbox's overrides. */
function activeModel() {
  if (!state.sandbox) return DATA.model;
  return { ...DATA.model, ...state.sandbox };
}

/** Rows with implied values under the model in force, re-ranked. */
function scoredRows() {
  const model = activeModel();
  const scored = DATA.rows.map((r) => {
    if (!state.sandbox) return { ...r, displayRank: r.rank };
    const v = impliedValue(r, DATA.as_of, model);
    return { ...r, implied_value_usd: v.implied, growth_multiplier: v.growthMult, maturity_multiplier: v.maturityMult, displayRank: 0 };
  });
  if (state.sandbox) {
    scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((r, i) => { r.displayRank = i + 1; });
  }
  return scored;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) child.forEach((c) => { if (c) node.appendChild(c); });
    else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function readHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.get('q')) state.q = params.get('q');
  if (params.get('category')) state.category = params.get('category');
  if (params.get('chain')) state.chain = params.get('chain');
  if (params.get('tab') === 'live') state.tab = 'live';
  if (params.get('p')) state.selected = params.get('p');
  const bm = Number(params.get('bm'));
  const gw = Number(params.get('gw'));
  const mf = Number(params.get('mf'));
  if (Number.isFinite(bm) && Number.isFinite(gw) && Number.isFinite(mf) && (params.get('bm') || params.get('gw') || params.get('mf'))) {
    state.sandbox = {
      base_multiple: Number.isFinite(bm) && params.get('bm') ? bm : DATA.model.base_multiple,
      growth_weight: Number.isFinite(gw) && params.get('gw') ? gw : DATA.model.growth_weight,
      maturity_floor: Number.isFinite(mf) && params.get('mf') ? mf : DATA.model.maturity_floor,
    };
  }
  return params.get('view');
}

function writeHash() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category !== 'all') params.set('category', state.category);
  if (state.chain !== 'all') params.set('chain', state.chain);
  if (state.tab === 'live') params.set('tab', 'live');
  if (state.selected) params.set('p', state.selected);
  if (state.sandbox) {
    params.set('bm', String(state.sandbox.base_multiple));
    params.set('gw', String(state.sandbox.growth_weight));
    params.set('mf', String(state.sandbox.maturity_floor));
  }
  const next = params.toString();
  window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
}

function filteredRows(list) {
  const q = state.q.trim().toLowerCase();
  return list.filter((r) => {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (!q) return true;
    return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().includes(q);
  });
}

function sortedRows(list) {
  const key = state.sort;
  return list.slice().sort((a, b) => {
    let av; let bv;
    if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
    else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
    else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
    else { av = a.implied_value_usd; bv = b.implied_value_usd; }
    if (av < bv) return -state.dir;
    if (av > bv) return state.dir;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}

function header() {
  return el('header', { class: 'top' },
    el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { text: 'Token Radar' })),
    el('div', { class: 'top-meta' },
      el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
      el('span', { text: 'DefiLlama protocol index' }),
      el('span', null, 'Model ', el('b', { text: MODEL_VERSION })),
    ));
}

function lede() {
  return el('section', { class: 'lede' },
    el('div', null,
      el('h1', null,
        el('span', { text: DATA.watchlist_size + ' watchlist protocols, ' }),
        el('span', { class: 'accent', text: 'ranked by implied value' }),
      ),
      el('p', { text: `The watchlist is the floor: every protocol with at least $${Math.round(DATA.floor_usd / 1e6)}M of TVL and no token on record. The early radar adds every rankable pre-token protocol below that floor — ${DATA.early_size} of them. Implied value is a model calibrated on the market's own live tokens, not a promise.` }),
    ),
    el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: `${DATA.watchlist_size} / ${DATA.watchlist_size}` })),
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Calibrated multiple' }), el('b', { text: `${DATA.model.base_multiple}× TVL` })),
      el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
    ));
}

function controls() {
  const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
  const chains = [...new Set(DATA.rows.flatMap((r) => r.chains || []))].sort();
  const search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
  search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });
  const cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
    el('option', { value: 'all', text: 'All categories' }),
    categories.map((c) => el('option', { value: c, text: c, selected: c === state.category || undefined })));
  cat.addEventListener('change', () => { state.category = cat.value; writeHash(); render(); });
  const chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
    el('option', { value: 'all', text: 'All chains' }),
    chains.map((c) => el('option', { value: c, text: c, selected: c === state.chain || undefined })));
  chain.addEventListener('change', () => { state.chain = chain.value; writeHash(); render(); });
  const pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token', text: 'Pre-token', onclick: () => { state.tab = 'pre-token'; writeHash(); render(); } });
  const live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live', text: 'Live token', onclick: () => { state.tab = 'live'; writeHash(); render(); } });
  const shown = state.tab === 'pre-token' ? filteredRows(scoredRows()).length + ' rows shown' : DATA.live.length + ' live-token protocols';
  return el('div', { class: 'controls' },
    el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
    el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
    el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
    el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
    el('span', { class: 'count', id: 'row-count', text: shown + (state.sandbox ? ' · sandbox model in force' : '') }));
}

function sortHeader(key, label) {
  return el('th', { scope: 'col' },
    el('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
      label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null));
}

function boardTable() {
  const list = sortedRows(filteredRows(scoredRows()));
  if (list.length === 0) {
    return el('div', { class: 'panel', id: 'board-panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })));
  }
  const max = list[0].implied_value_usd || 1;
  const tbody = el('tbody');  for (const r of list) {
    const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    tbody.appendChild(el('tr', {
      'data-selected': state.selected === r.slug || undefined,
      tabindex: '0',
      onclick: () => openDetail(r.slug),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
    },
      el('td', { class: 'num', text: String(r.displayRank) }),
      el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' on ' + ((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') }))),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(3, Math.round((r.implied_value_usd / max) * 100))}%` })),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
      el('td', null, el('span', { class: 'status', text: 'no token' }))));
  }
  return el('div', { class: 'panel', id: 'board-panel' }, el('div', { class: 'table-wrap' },
    el('table', null,
      el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
      el('thead', null, el('tr', null,
        sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
        sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'),
        el('th', { scope: 'col', text: 'Token' }))),
      tbody)));
}

function liveTable() {
  const tbody = el('tbody');
  for (const r of DATA.live) {
    tbody.appendChild(el('tr', null,
      el('td', null, el('span', { class: 'status live', text: 'trades' })),
      el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' on ' + ((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') }))),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
      el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a' })));
  }
  return el('div', { class: 'panel', id: 'board-panel' }, el('div', { class: 'table-wrap' },
    el('table', null,
      el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their median market-cap-to-TVL ratio is what calibrates the model.' }),
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }),
        el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
        el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
      tbody)));
}

function modelPanel() {
  const m = DATA.model;
  const cal = DATA.calibration;
  const formula = el('div', { class: 'formula' });
  formula.append(
    'implied = round( tvl_usd × ', el('b', { text: String(m.base_multiple) }),
    ` × (1 + clamp(change_7d, ${m.growth_floor}, ${m.growth_cap}) / 100 × `, el('b', { text: String(m.growth_weight) }),
    `) × (${m.maturity_floor} + min(age_days, ${m.maturity_days}) / ${m.maturity_days} × ${m.maturity_range}) )`,
  );
  const panel = el('section', { class: 'panel model', id: 'model' },
    el('h2', { text: 'How implied value is computed' }),
    el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. TVL and seven-day growth come from the snapshot; age is the time since the protocol was first listed, the best record of how long it has run with no token. Unknown growth counts as 0, and an unlisted age uses ' + m.unknown_age_days + ' days.' }),
    formula,
    el('p', { text: cal && cal.calibrated
      ? `The ${m.base_multiple}× multiple is not a guess: it is the median market-cap-to-TVL ratio across ${cal.n} live-token protocols in this same snapshot (25th percentile ${cal.p25}×, 75th ${cal.p75}×). The market already prices live tokens at a spread of multiples; the median is the typical one.`
      : 'The multiple defaults to 0.25× because too few live-token protocols were available to calibrate from.' }),
  );
  panel.appendChild(sandbox());
  return panel;
}

function sandbox() {
  const m = DATA.model;
  const current = state.sandbox || { base_multiple: m.base_multiple, growth_weight: m.growth_weight, maturity_floor: m.maturity_floor };
  const box = el('div', { class: 'sandbox', id: 'sandbox' },
    el('h3', { text: 'Model sandbox' }),
    el('p', { text: 'Move a constant and the whole board re-ranks live, in this page, with the same function that wrote board.json. The board file itself always uses the calibrated constants above.' }));
  const sliders = el('div', { class: 'sliders' });
  const defs = [
    { key: 'base_multiple', label: 'Base multiple (× TVL)', min: 0.05, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) + '×' },
    { key: 'growth_weight', label: 'Growth weight', min: 0, max: 1, step: 0.05, fmt: (v) => v.toFixed(2) },
    { key: 'maturity_floor', label: 'Maturity floor', min: 0.3, max: 0.9, step: 0.05, fmt: (v) => v.toFixed(2) },
  ];
  for (const d of defs) {
    const out = el('output', { text: d.fmt(current[d.key]) });
    const input = el('input', { type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), value: String(current[d.key]), 'aria-label': d.label });
    input.addEventListener('input', () => {
      const next = { ...(state.sandbox || { base_multiple: m.base_multiple, growth_weight: m.growth_weight, maturity_floor: m.maturity_floor }) };
      next[d.key] = Number(input.value);
      state.sandbox = next;
      out.textContent = d.fmt(next[d.key]);
      writeHash();
      updateBoard();
    });
    sliders.appendChild(el('div', { class: 'slider' }, el('label', null, el('span', { text: d.label }), out), input));
  }
  box.appendChild(sliders);
  const note = el('p', { class: 'sandbox-note', id: 'sandbox-note' });
  const values = el('b', { id: 'sandbox-note-values', text: '' });
  if (state.sandbox) {
    note.append('Sandbox in force: the ranks above use ', values, ', not the calibrated board. ');
    values.textContent = `${state.sandbox.base_multiple}× / ${state.sandbox.growth_weight} / ${state.sandbox.maturity_floor}`;
  } else {
    note.append('Calibrated model in force: ', values, '. Move a slider to test another one.');
    values.textContent = `${m.base_multiple}× / ${m.growth_weight} / ${m.maturity_floor}`;
  }
  box.appendChild(note);
  const actions = el('div', { class: 'sandbox-actions', id: 'sandbox-actions' },
    el('button', { class: 'button', type: 'button', text: 'Reset to the calibrated model', onclick: () => { state.sandbox = null; writeHash(); render(); } }));
  if (!state.sandbox) actions.style.display = 'none';
  box.appendChild(actions);
  return box;
}

const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

function openDetail(slug) {
  const stored = DATA.rows.find((r) => r.slug === slug);
  if (!stored) return;
  state.selected = slug;
  writeHash();
  const model = activeModel();
  const v = impliedValue(stored, DATA.as_of, model);
  const steps = farmSteps(stored, stored.age_days).map(stepText);
  const agrees = !state.sandbox && v.implied === stored.implied_value_usd;
  dialog.textContent = '';
  dialog.appendChild(el('div', { class: 'detail-head' },
    el('div', null,
      el('span', { class: 'kicker', text: `Rank ${stored.rank} of ${DATA.board_size} · pre-token` }),
      el('h2', { id: 'detail-title', text: stored.name }),
      el('p', { class: 'sub', text: (stored.category || 'Other') + ' on ' + ((stored.chains || []).join(', ') || 'an unnamed chain') })),
    el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() })));
  dialog.appendChild(el('section', { class: 'detail-section' },
    el('h3', { text: 'Implied value' }),
    el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(stored.tvl_usd) })),
      el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(stored.change_7d) })),
      el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(stored.age_days) })),
      el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(v.growthMult) })),
      el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(v.maturityMult) })),
      el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(v.implied) }))),
    el('p', { class: 'check' }, state.sandbox
      ? `Sandbox model in force: this row recomputes to ${fmtUsd(v.implied)} here; board.json carries ${fmtUsd(stored.implied_value_usd)} under the calibrated model.`
      : agrees
        ? `The page recomputes this row as ${fmtUsd(v.implied)} — the same number board.json carries. This is an estimate, not a price.`
        : `The page recomputes this row as ${fmtUsd(v.implied)}; board.json carries ${fmtUsd(stored.implied_value_usd)} — the data would be stale.`)));
  dialog.appendChild(el('section', { class: 'detail-section' },
    el('h3', { text: 'Farm plan' }),
    el('ol', { class: 'steps' }, steps.map((s) => {
      const costAt = s.indexOf(' Cost: ');
      const timeAt = s.indexOf(' Time: ');
      const action = costAt >= 0 ? s.slice(0, costAt) : s;
      const cost = costAt >= 0 && timeAt > costAt ? s.slice(costAt + 7, timeAt) : '';
      const time = timeAt >= 0 ? s.slice(timeAt + 7).replace(/\.$/, '') : '';
      return el('li', null, el('b', { text: action }),
        el('span', { class: 'cost' }, 'Cost: ', el('i', { text: cost }), ` · Time: ${time}`));
    }))));
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function foot() {
  return el('footer', { class: 'foot' },
    el('p', { text: `Source: ${DATA.source}, snapshot ${DATA.as_of}. The watchlist is the snapshot's own: protocols at or above the $${Math.round(DATA.floor_usd / 1e6)}M floor with no token on record. Protocols above the floor that are not on the watchlist — wrapped, staked and bridged products among them — are not ranked, and exchanges and versioned pools are set aside from the early radar. ${DATA.unpriced_size} protocols record a token but no market cap yet, so they appear in neither view.` }),
    el('p', { text: 'Gas figures are ordinary conditions on each protocol’s own chain, not quotes. Nothing here is financial advice, and no farm plan guarantees an airdrop: protocols change their rules, and some never launch a token at all.' }));
}

function render() {
  app.textContent = '';
  const shell = el('div', { class: 'shell' });
  shell.appendChild(header());
  shell.appendChild(lede());
  shell.appendChild(controls());
  shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
  if (state.tab === 'pre-token') shell.appendChild(modelPanel());
  shell.appendChild(foot());
  app.appendChild(shell);
  app.setAttribute('aria-busy', 'false');
  if (!dialog.isConnected) app.appendChild(dialog);
  if (state.selected) openDetail(state.selected);
}

/** Re-rank and repaint only the board, leaving the sandbox sliders (and any
 *  drag in progress) untouched. Used by the sandbox's input handler. */
function updateBoard() {
  const panel = document.getElementById('board-panel');
  if (panel) panel.replaceWith(state.tab === 'pre-token' ? boardTable() : liveTable());
  const count = document.getElementById('row-count');
  if (count) {
    const shown = state.tab === 'pre-token' ? filteredRows(scoredRows()).length + ' rows shown' : DATA.live.length + ' live-token protocols';
    count.textContent = shown + (state.sandbox ? ' · sandbox model in force' : '');
  }
  const noteValues = document.getElementById('sandbox-note-values');
  const note = document.getElementById('sandbox-note');
  const actions = document.getElementById('sandbox-actions');
  if (noteValues && state.sandbox) {
    noteValues.textContent = `${state.sandbox.base_multiple}× / ${state.sandbox.growth_weight} / ${state.sandbox.maturity_floor}`;
  }
  if (note && state.sandbox && !note.textContent.startsWith('Sandbox in force')) {
    note.textContent = '';
    note.append('Sandbox in force: the ranks above use ', noteValues, ', not the calibrated board. ');
  }
  if (actions && state.sandbox) actions.style.display = '';
  if (state.selected && dialog.open) openDetail(state.selected);
}

const view = readHash();
render();
if (view === 'sandbox') {
  const target = document.getElementById('sandbox');
  if (target) target.scrollIntoView();
}
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog.open) dialog.close(); });
