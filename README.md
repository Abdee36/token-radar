# Token Radar

A radar for token launches: every rankable pre-token protocol in a DefiLlama
snapshot, ranked by an implied-value model calibrated on the market's own
live tokens, each row with a farm plan. Entry for the make.fun bounty
`token-radar-01`.

## The model

`dashboard/model.js` holds the one model, imported by both the program and
the page, so the board's numbers and the page's numbers can never drift:

- **Base** = TVL × a multiple calibrated at run time: the median
  market-cap-to-TVL ratio across the snapshot's trading protocols
  (0.246× on the 2026-11-14 snapshot, from 119 protocols).
- **Growth** = 1 + clamp(7-day change, −60%, +120%) × 0.5.
- **Maturity** = 0.6 + min(age, 3y) / 3y × 0.4, where age is the time since
  the protocol was first listed.
- **Implied value** = round(base × growth × maturity).

The board covers all 40 watchlist protocols plus every rankable pre-token
protocol below the $50M floor (226 rows on this snapshot). Exchanges,
versioned pools, and protocols above the floor that are not on the watchlist
are set aside; protocols that record a token but no market cap appear in
neither view, and the page says how many.

## The page

`dashboard/` is a static page (no framework, no network): a sortable,
filterable board, a per-protocol detail view with the model's arithmetic and
a seven-step farm plan with chain-aware gas costs, and a model sandbox that
re-ranks the board live. Open `dashboard/index.html` beside a generated
`data.js` (see below) to run it.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`.

## Layout

- `main.ts` — orchestration: read, score, write, copy, dossier.
- `lib/radar.ts` — snapshot parsing, board assembly, calibration wiring.
- `dashboard/model.js` — the shared model and farm-plan generator.
- `dashboard/app.js`, `dashboard/app.css`, `dashboard/index.html` — the page.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied as the kit directs.
- `screenshots/` — the board, a detail view, a filtered view, and the sandbox.
