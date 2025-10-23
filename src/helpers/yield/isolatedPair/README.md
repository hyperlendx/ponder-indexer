# Isolated Pair Utilities

This directory contains utilities for working with isolated lending pairs in the Hyperlend protocol.
Isolated pairs use **ERC4626-style shares-based accounting**, different from the index-based accounting used in the regular AAVE pool.

## File Structure

### `constants.ts` - Constants and Precision Values
Core constants used throughout the isolated pair calculations.

**Exports:**
- `EXCHANGE_PRECISION` - Constant: 1e18 (exchange rate precision)

**Usage:**
```typescript
import { EXCHANGE_PRECISION } from "./isolatedPair";

const assets = (shares * exchangeRate) / EXCHANGE_PRECISION;
```

---

### `pairTracking.ts` - User-Pair Relationship Tracking
Functions for tracking which isolated pairs a user has interacted with.

**Exports:**
- `getUserIsolatedPairs(context, user, startTimestamp, endTimestamp)` - Get all pairs a user has interacted with

**Usage:**
```typescript
import { getUserIsolatedPairs } from "./isolatedPair";

const pairs = await getUserIsolatedPairs(context, "0x123...", 0, Date.now());
// Returns: ["0xPair1...", "0xPair2..."]
```

---

### `balanceQueries.ts` - Balance Query Functions
Functions for querying user balances (collateral, asset shares, borrow shares) at specific timestamps.

**Exports:**
- `getIsolatedPairCollateralBalance(context, user, pair, timestamp)` - Query collateral balance
- `getIsolatedPairAssetShares(context, user, pair, timestamp)` - Query asset shares (vault deposits)
- `getIsolatedPairBorrowShares(context, user, pair, timestamp)` - Query borrow shares (debt)
- `convertSharesToAssets(shares, exchangeRate)` - Convert shares to asset amounts

**Usage:**
```typescript
import { getIsolatedPairAssetShares, convertSharesToAssets } from "./isolatedPair";

const shares = await getIsolatedPairAssetShares(context, "0x123...", "0xPair...", 1234567890);
const assets = convertSharesToAssets(shares, exchangeRate);
```

---

### `exchangeRate.ts` - Exchange Rate Calculations
Functions for calculating and extrapolating exchange rates at specific timestamps.

**Exports:**
- `calculateIsolatedPairExchangeRateAtTimestamp(context, pair, timestamp)` - Calculate exchange rate with extrapolation
- `getIsolatedPairExchangeRate(context, pair, timestamp)` - Legacy wrapper (deprecated)

**Usage:**
```typescript
import { calculateIsolatedPairExchangeRateAtTimestamp } from "./isolatedPair";

const rate = await calculateIsolatedPairExchangeRateAtTimestamp(context, "0xPair...", 1234567890);
// Returns: 1050000000000000000n (1.05 exchange rate)
```

---

### `eventQueries.ts` - Event Query Functions
Internal functions for querying and normalizing events from the database.

**Note:** Functions in this file are NOT exported from the main index - they are internal helpers.

---

### `positionCalculations.ts` - Position Calculations
Functions for calculating user positions (combining balances + exchange rates).

**Exports:**
- `calculateIsolatedPairPosition(context, user, pair, timestamp)` - Calculate single pair position
- `calculateAllIsolatedPairPositions(context, user, timestamp, startTimestamp?)` - Calculate all pair positions

**Usage:**
```typescript
import { calculateAllIsolatedPairPositions } from "./isolatedPair";

const positions = await calculateAllIsolatedPairPositions(context, "0x123...", Date.now());
// Returns: [
//   { pair: "0xPair1...", collateralAmount: 1000n, assetShares: 1000n, assetAmount: 1050n, ... },
//   { pair: "0xPair2...", collateralAmount: 2000n, assetShares: 2000n, assetAmount: 2100n, ... }
// ]
```

---

### `yieldCalculations.ts` - Yield Calculations
Core yield calculation logic using segment-based approach.

**Exports:**
- `calculateIsolatedPairYield(context, user, pair, startTimestamp, endTimestamp)` - Calculate yield for single pair
- `calculateAllIsolatedPairYields(context, user, startTimestamp, endTimestamp)` - Calculate yields for all pairs

**Usage:**
```typescript
import { calculateAllIsolatedPairYields } from "./isolatedPair";

const yields = await calculateAllIsolatedPairYields(context, "0x123...", 1000, 2000);
// Returns: [
//   { pair: "0xPair1...", assetYield: 50n, borrowCost: 15n, netYield: 35n, ... },
//   { pair: "0xPair2...", assetYield: 30n, borrowCost: 10n, netYield: 20n, ... }
// ]
```

---

### `timeAggregations.ts` - Time-Based Yield Aggregations
Functions for aggregating yields over time periods (daily, monthly).

**Exports:**
- `calculateDailyIsolatedPairYields(context, user, startTimestamp, endTimestamp)` - Daily yield breakdown
- `calculateMonthlyIsolatedPairYields(context, user, startTimestamp, endTimestamp)` - Monthly yield breakdown

**Usage:**
```typescript
import { calculateMonthlyIsolatedPairYields } from "./isolatedPair";

const monthlyYields = await calculateMonthlyIsolatedPairYields(context, "0x123...", 1000000, 2000000);
// Returns: [
//   { year: 2025, month: 1, monthName: "January", monthlyYield: 300n, pairs: [...] },
//   ...
// ]
```

---

### `index.ts` - Main Export
Re-exports all public functions from submodules for convenient importing.

**Usage:**
```typescript
// Import everything from one place
import {
    EXCHANGE_PRECISION,
    getUserIsolatedPairs,
    calculateAllIsolatedPairPositions,
    calculateAllIsolatedPairYields,
    calculateDailyIsolatedPairYields,
    calculateMonthlyIsolatedPairYields
} from "./isolatedPair";
```

---

## Key Concepts

### ERC4626 Shares-Based Accounting
Isolated pairs follow the ERC4626 vault standard:
- **Shares** = Your ownership units (constant unless you deposit/withdraw)
- **Assets** = Actual token value = shares × exchangeRate
- **Exchange Rate** = Grows over time as interest accrues

### Shares vs Assets
- **Shares (Scaled Balance)**: Constant value that only changes on deposit/withdraw
- **Assets (Actual Balance)**: Current withdrawable amount (grows with interest)
- **Relationship**: `assets = shares × exchangeRate / EXCHANGE_PRECISION`

### Exchange Rate Growth
```
Initial: 100 shares × 1.00 rate = 100 tokens
Later:   100 shares × 1.05 rate = 105 tokens
Yield:   5 tokens earned!
```

### Yield Calculation
Yield is calculated using a **segment-based approach**:
1. Divide time period into segments between events
2. Calculate yield for each segment: `yield = shares × (newRate - oldRate)`
3. Sum all segment yields to get total yield

This ensures accurate yield even when positions change during the period.

### Collateral vs Asset Shares
- **Asset Shares**: Vault deposits that EARN yield
- **Borrow Shares**: Debt that COSTS interest
- **Collateral**: Backs borrows but does NOT earn yield

### Net Yield Formula
```
Net Yield = Asset Yield - Borrow Cost
```

---

## Related Files

- `src/helpers/aave/` - Similar utilities for regular AAVE pool (uses liquidity index instead of exchange rate)
- `src/api/index.ts` - API endpoints that use these utilities
- `ponder.schema.ts` - Database schema definitions for isolated pair events

---

## Future Improvements

Potential enhancements to consider:
1. **Compound Interest**: Use exponential formula instead of linear approximation
2. **Rate Smoothing**: Use more than 2 events for rate calculation
3. **Bounds Checking**: Reject extrapolation for very long periods
4. **On-Chain Queries**: Option to query current state from contract for 100% accuracy

