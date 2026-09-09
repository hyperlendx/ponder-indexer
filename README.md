# Ponder Indexer

Indexes the HyperLend core pool on HyperEVM for the **USDC reserve only**
(`0xb88339CB7199b77E23DB6E890353E22632Ba630f`).

- Core pool events (supply, withdraw, borrow, repay, liquidations, reserve data updates, ...)
  are filtered to USDC at the log level in `ponder.config.ts`.
- USDC oracle price snapshots are taken every 300 blocks.
- Yield / portfolio APIs live in `src/api/index.ts`.

Isolated pairs and liquid staking tokens (kHYPE, beHYPE, wstHYPE) are not tracked
