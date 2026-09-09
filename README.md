# Ponder Indexer

Indexes the HyperLend core pool on HyperEVM for the **USDC reserve only**
(`0xb88339CB7199b77E23DB6E890353E22632Ba630f`).

- Core pool events (supply, withdraw, borrow, repay, liquidations, reserve data updates, ...)
  are filtered to USDC at the log level in `ponder.config.ts`.
- USDC oracle price snapshots are taken every 3,600 blocks (about hourly), then
  resolved sparsely at only the timestamps requested by a report.
- `daily_reserve_index` stores the reserve state (last `ReserveDataUpdated`) as of every UTC
  midnight, written at index time. The yield API resolves liquidity/borrow indices at day
  boundaries from it instead of scanning `reserve_data_event`.
- Yield / portfolio APIs live in `src/api/index.ts`; the calculation code in `src/helpers/yield`
  loads a bounded time window, uses pre-period aggregates as its starting state, and evaluates
  each event once in memory. Successful API responses are cached for 30 seconds.

Isolated pairs and liquid staking tokens (kHYPE, beHYPE, wstHYPE) are not tracked.
