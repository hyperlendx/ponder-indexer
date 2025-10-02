# Yield Calculation Module

Comprehensive yield tracking and reporting system for AAVE/Hyperlend protocol positions. This module provides functions to calculate interest earned, track portfolio values, and generate detailed yield reports over time.

## Overview

The yield calculation system is organized into three layers:

```
yield/
├── balanceQueries.ts          # Data access layer
│   └── Query balances and assets at specific timestamps
│
├── yieldCalculations.ts       # Business logic layer
│   └── Core algorithms for yield calculation
│
├── yieldReports.ts            # Presentation layer
│   └── Generate comprehensive yield reports
│
└── index.ts                   # Public API
    └── Re-exports commonly used functions
```

**Design Principles:**
- **Separation of Concerns**: Each file has a single, well-defined responsibility
- **Dependency Flow**: Reports → Calculations → Queries
- **Testability**: Each layer can be tested independently
- **Reusability**: Lower-level functions can be used without higher-level abstractions

---

## Key Concepts

### Scaled vs Actual Balance

AAVE protocol uses a scaled balance system to efficiently track interest accrual:

- **Scaled Balance**: A constant value stored in the database that doesn't change as interest accrues
- **Actual Balance**: The current withdrawable amount that grows over time with interest
- **Liquidity Index**: A multiplier that tracks cumulative interest growth (starts at 1.0 RAY = 1e27)

**Conversion Formula:**
```typescript
actualBalance = (scaledBalance × liquidityIndex) / RAY
```

**Example:**
```typescript
// User deposits 1000 tokens
scaledBalance = 1000e18
liquidityIndex = 1.0e27 (RAY)
actualBalance = 1000e18

// After 1 year with 5% APY
scaledBalance = 1000e18 (unchanged)
liquidityIndex = 1.05e27
actualBalance = 1050e18 (grew by 5%)
```

### Time Segmentation

To accurately calculate yield when users deposit/withdraw during a period, we split the timeline into segments where the balance remains constant:

```
Timeline:
|-------|---------|---------|---------|
Start   Event1    Event2    Event3    End
        (Deposit) (Withdraw)(Deposit)

Segments:
[Segment 1: Start → Event1]  balance = 0      yield = 0
[Segment 2: Event1 → Event2] balance = 1000   yield = 50
[Segment 3: Event2 → Event3] balance = 0      yield = 0
[Segment 4: Event3 → End]    balance = 1000   yield = 25

Total Yield = 0 + 50 + 0 + 25 = 75
```

**Why Segmentation?**
- ✅ Handles intra-period deposits/withdrawals accurately
- ✅ Each segment has constant balance (no transactions)
- ✅ Interest accrues continuously within each segment
- ✅ Provides detailed breakdown for transparency

### Yield Calculation Algorithm

For each time segment:

```typescript
// 1. Get liquidity indices at segment boundaries
startIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime);
endIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime);

// 2. Calculate actual balances
startActualBalance = (scaledBalance × startIndex) / RAY;
endActualBalance = (scaledBalance × endIndex) / RAY;

// 3. Yield = growth in actual balance
segmentYield = endActualBalance - startActualBalance;
```

**Total yield** = sum of all segment yields

---

## API Reference

### Balance Queries (`balanceQueries.ts`)

Functions for querying user balances and assets at specific timestamps.

#### `getScaledBalanceAtTimestamp()`

Get a user's scaled balance for a specific asset at any point in time.

```typescript
async function getScaledBalanceAtTimestamp(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<bigint>
```

**Parameters:**
- `context` - Ponder context object
- `user` - User address (0x...)
- `asset` - Asset address (0x...)
- `timestamp` - Unix timestamp (seconds)

**Returns:** Scaled balance as BigInt

**Example:**
```typescript
import { getScaledBalanceAtTimestamp } from "../helpers/yield";

const scaledBalance = await getScaledBalanceAtTimestamp(
    context,
    "0x4d48bEC025De3AD0f06aB8b8562C685c373f83bb",
    "0x5555555555555555555555555555555555555555",
    1704067200  // Jan 1, 2024
);

// Convert to actual withdrawable balance
import { calculateLiquidityIndexAtTimestamp, calculateActualBalance } from "../helpers/aave";
const liquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, timestamp);
const actualBalance = calculateActualBalance(scaledBalance, liquidityIndex);
```

---

#### `getUserAssetsForPeriod()`

Get all assets a user had positions in during a time period.

```typescript
async function getUserAssetsForPeriod(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]>
```

**Returns:** Array of asset addresses

**Example:**
```typescript
import { getUserAssetsForPeriod } from "../helpers/yield";

const assets = await getUserAssetsForPeriod(
    context,
    user,
    1704067200,  // Start: Jan 1, 2024
    1735689600   // End: Jan 1, 2025
);

console.log(`User had positions in ${assets.length} assets`);
```

---

#### `getBorrowedBalanceAtTimestamp()`

Get net borrowed amount (total borrows - total repays) at a specific timestamp.

```typescript
async function getBorrowedBalanceAtTimestamp(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<bigint>
```

**Note:** Returns principal borrowed amount, not including accrued interest.

---

### Yield Reports (`yieldReports.ts`)

High-level functions that generate comprehensive yield reports.

#### `calculateUserMonthlyYield()`

Calculate monthly yield for all assets a user had positions in during a specific month.

```typescript
async function calculateUserMonthlyYield(
    context: any,
    user: string,
    year: number,
    month: number
): Promise<Array<MonthlyYieldResult>>
```

**Parameters:**
- `year` - Year (e.g., 2025)
- `month` - Month (1-12)

**Returns:** Array of yield data per asset

**Result Structure:**
```typescript
{
    user: string;
    asset: string;
    year: number;
    month: number;
    monthlyYield: bigint;              // Total yield earned
    startScaledBalance: bigint;
    endScaledBalance: bigint;
    startActualBalance: bigint;
    endActualBalance: bigint;
    startLiquidityIndex: bigint;
    endLiquidityIndex: bigint;
    netDeposits: bigint;               // Deposits - withdrawals
    startTimestamp: number;
    endTimestamp: number;
    hadPositionDuringMonth: boolean;
    maxBalanceDuringMonth: bigint;
    transactionCount: number;
    segments?: Array<SegmentData>;     // Detailed breakdown
}
```

**Example:**
```typescript
import { calculateUserMonthlyYield } from "../helpers/yield/yieldReports";

// Get September 2025 yield
const yields = await calculateUserMonthlyYield(context, user, 2025, 9);

for (const assetYield of yields) {
    console.log(`Asset: ${assetYield.asset}`);
    console.log(`Monthly Yield: ${assetYield.monthlyYield}`);
    console.log(`Net Deposits: ${assetYield.netDeposits}`);
    console.log(`Segments: ${assetYield.segments?.length}`);
}
```

---

#### `calculateUserDailyYieldBreakdown()`

Calculate daily yield breakdown for charting and time-series visualization.

```typescript
async function calculateUserDailyYieldBreakdown(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<DailyYieldResult>>
```

**Result Structure:**
```typescript
{
    date: string;                      // YYYY-MM-DD
    timestamp: number;
    dailyYield: bigint;
    dailyYieldFormatted: string;       // Human-readable
    assets: Array<{
        asset: string;
        dailyYield: bigint;
        dailyYieldFormatted: string;
        segments: Array<SegmentData>;
    }>;
}
```

**Example:**
```typescript
import { calculateUserDailyYieldBreakdown } from "../helpers/yield/yieldReports";

const dailyData = await calculateUserDailyYieldBreakdown(
    context,
    user,
    startTimestamp,
    endTimestamp
);

// Format for chart
const chartData = dailyData.map(day => ({
    date: day.date,
    yield: day.dailyYieldFormatted,
    assets: day.assets.map(a => ({
        asset: a.asset,
        yield: a.dailyYieldFormatted
    }))
}));
```

---

#### `calculateUserDailyPortfolioValue()`

Calculate daily portfolio values (supplied - borrowed) for net worth tracking.

```typescript
async function calculateUserDailyPortfolioValue(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<PortfolioValueResult>>
```

**Result Structure:**
```typescript
{
    date: string;
    timestamp: number;
    portfolioValue: bigint;            // totalSupplied - totalBorrowed
    portfolioValueFormatted: string;
    totalSupplied: bigint;
    totalSuppliedFormatted: string;
    totalBorrowed: bigint;
    totalBorrowedFormatted: string;
    assets: Array<{
        asset: string;
        supplied: bigint;
        borrowed: bigint;
        netPosition: bigint;
        // ... formatted versions
    }>;
}
```

**Example:**
```typescript
import { calculateUserDailyPortfolioValue } from "../helpers/yield/yieldReports";

const portfolioData = await calculateUserDailyPortfolioValue(
    context,
    user,
    startTimestamp,
    endTimestamp
);

for (const day of portfolioData) {
    console.log(`${day.date}:`);
    console.log(`  Supplied: ${day.totalSuppliedFormatted}`);
    console.log(`  Borrowed: ${day.totalBorrowedFormatted}`);
    console.log(`  Net Value: ${day.portfolioValueFormatted}`);
}
```

---

## Performance Considerations

### Complexity Analysis

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Balance queries | O(log n) | Uses indexed timestamp queries |
| Asset discovery | O(n) | Scans all user events (cached in practice) |
| Segment creation | O(m) | Where m = number of balance events |
| Daily breakdown | O(d × a × m) | d=days, a=assets, m=segments per asset |

### Optimization Strategies

**1. Batch Asset Processing**
```typescript
// ❌ Slow - Sequential processing
for (const asset of assets) {
    const yield = await calculateYield(asset);
}

// ✅ Fast - Parallel processing
const yields = await Promise.all(
    assets.map(asset => calculateYield(asset))
);
```

**2. Cache Liquidity Indices**

The same liquidity index is often needed multiple times. Consider caching:

```typescript
const indexCache = new Map<string, bigint>();

async function getCachedIndex(asset: string, timestamp: number) {
    const key = `${asset}-${timestamp}`;
    if (!indexCache.has(key)) {
        const index = await calculateLiquidityIndexAtTimestamp(context, asset, timestamp);
        indexCache.set(key, index);
    }
    return indexCache.get(key)!;
}
```

**3. Limit Date Ranges**

Smaller periods = fewer segments = faster calculation:
- ✅ Daily queries: Very fast
- ✅ Monthly queries: Fast
- ⚠️ Yearly queries: Moderate
- ❌ Multi-year queries: Slow

**4. Choose the Right Function**

| Use Case | Function | Performance |
|----------|----------|-------------|
| Single month | `calculateUserMonthlyYield()` | Fast |
| Custom period | `calculateUserCustomPeriodYield()` | Moderate |
| Daily chart data | `calculateUserDailyYieldBreakdown()` | Slow (many calculations) |
| Portfolio tracking | `calculateUserDailyPortfolioValue()` | Slow (many balance queries) |

**5. Pre-aggregate When Possible**

For frequently accessed data, consider storing pre-calculated results:
- Monthly yields in a separate table
- Daily portfolio snapshots
- Asset-level aggregations

---

## Testing

### Unit Tests

Test individual functions with mock data:

```typescript
import { createTimeSegments } from "../helpers/yield/yieldCalculations";

describe("createTimeSegments", () => {
    it("should create segments between balance events", async () => {
        const mockEvents = [
            { timestamp: 1000, scaledBalance: 100n },
            { timestamp: 2000, scaledBalance: 200n }
        ];

        const segments = await createTimeSegments(
            mockContext,
            user,
            asset,
            0,      // startTimestamp
            3000,   // endTimestamp
            mockEvents
        );

        expect(segments).toHaveLength(3);
        expect(segments[0].scaledBalance).toBe(0n);
        expect(segments[1].scaledBalance).toBe(100n);
        expect(segments[2].scaledBalance).toBe(200n);
    });
});
```

### Integration Tests

Test full yield calculation flow with real database:

```typescript
import { calculateUserMonthlyYield } from "../helpers/yield/yieldReports";

describe("calculateUserMonthlyYield", () => {
    it("should calculate monthly yield for all user assets", async () => {
        const yields = await calculateUserMonthlyYield(context, user, 2025, 9);

        expect(yields.length).toBeGreaterThan(0);
        expect(yields[0].monthlyYield).toBeGreaterThanOrEqual(0n);
        expect(yields[0].segments).toBeDefined();
    });
});
```

---

## Common Patterns

### Pattern 1: Get Current Balance

```typescript
import { getScaledBalanceAtTimestamp } from "../helpers/yield";
import { calculateLiquidityIndexAtTimestamp, calculateActualBalance } from "../helpers/aave";

const now = Math.floor(Date.now() / 1000);
const scaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, now);
const liquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, now);
const currentBalance = calculateActualBalance(scaledBalance, liquidityIndex);
```

### Pattern 2: Calculate Yield for Date Range

```typescript
import { calculateUserCustomPeriodYield } from "../helpers/yield/yieldReports";
import { getMonthTimestamps } from "../helpers/aave";

// Get Q1 2025 yield
const q1Start = Math.floor(new Date('2025-01-01').getTime() / 1000);
const q1End = Math.floor(new Date('2025-03-31').getTime() / 1000);

const yields = await calculateUserCustomPeriodYield(context, user, q1Start, q1End);
```

### Pattern 3: Build Time-Series Chart

```typescript
import { calculateUserDailyYieldBreakdown } from "../helpers/yield/yieldReports";

const dailyData = await calculateUserDailyYieldBreakdown(context, user, start, end);

// Format for chart library
const chartData = {
    labels: dailyData.map(d => d.date),
    datasets: [{
        label: 'Daily Yield',
        data: dailyData.map(d => parseFloat(d.dailyYieldFormatted))
    }]
};
```

---

## Troubleshooting

### Issue: Yield calculation returns 0

**Possible causes:**
1. User had no balance during the period
2. Liquidity index didn't change (no interest accrued)
3. Deposits and withdrawals canceled out the yield

**Debug:**
```typescript
const result = await calculateUserMonthlyYield(context, user, year, month);
console.log('Assets found:', result.length);
console.log('Had position:', result[0]?.hadPositionDuringMonth);
console.log('Segments:', result[0]?.segments?.length);
```

### Issue: Performance is slow

**Solutions:**
1. Reduce date range (query smaller periods)
2. Use monthly aggregations instead of daily
3. Implement caching for liquidity indices
4. Process assets in parallel with `Promise.all()`

### Issue: Incorrect yield amounts

**Check:**
1. Liquidity index is in RAY precision (1e27)
2. Scaled balance is in token decimals (usually 1e18)
3. Time segments are created correctly
4. No missing balance events in database


---

## Quick Reference

### Common Tasks

| Task | Code |
|------|------|
| **Get monthly yield** | `calculateUserMonthlyYield(context, user, 2025, 9)` |
| **Get balance at time** | `getScaledBalanceAtTimestamp(context, user, asset, timestamp)` |
| **Get portfolio values** | `calculateUserDailyPortfolioValue(context, user, start, end)` |
| **Get user's assets** | `getUserAssetsForPeriod(context, user, start, end)` |
| **Get daily breakdown** | `calculateUserDailyYieldBreakdown(context, user, start, end)` |

### Function Reference

#### Balance Queries (`import from "../helpers/yield"`)

| Function | Purpose | Returns |
|----------|---------|---------|
| `getScaledBalanceAtTimestamp()` | Get scaled balance at specific time | `bigint` |
| `getAssetsWithBalanceAtTimestamp()` | Get assets with non-zero balance | `string[]` |
| `getUserAssetsForMonth()` | Get assets for specific month | `string[]` |
| `getUserAssetsForPeriod()` | Get assets for date range | `string[]` |
| `getMaxBalanceDuringMonth()` | Get peak balance in month | `bigint` |
| `getMaxBalanceDuringPeriod()` | Get peak balance in period | `bigint` |
| `getBorrowedBalanceAtTimestamp()` | Get borrowed amount at time | `bigint` |
| `getUserBorrowedAssets()` | Get borrowed assets in period | `string[]` |

#### Yield Reports (`import from "../helpers/yield/yieldReports"`)

| Function | Purpose | Use Case |
|----------|---------|----------|
| `calculateUserMonthlyYield()` | Monthly yield per asset | Monthly reports, historical analysis |
| `calculateUserCustomPeriodYield()` | Yield for date range | Custom period reports, quarterly summaries |
| `calculateUserDailyYieldBreakdown()` | Daily yield breakdown | Time-series charts, daily tracking |
| `calculateUserDailyPortfolioValue()` | Daily portfolio values | Net worth tracking, portfolio charts |

#### Core Calculations (`import from "../helpers/yield/yieldCalculations"`)

| Function | Purpose | Typical Usage |
|----------|---------|---------------|
| `calculateSegmentInterest()` | Interest for one segment | Internal use by report functions |
| `createTimeSegments()` | Split period into segments | Internal use by report functions |
| `calculateSegmentedMonthlyYield()` | Monthly yield with segments | Internal use by `calculateUserMonthlyYield()` |
| `calculateSegmentedCustomPeriodYield()` | Period yield with segments | Internal use by `calculateUserCustomPeriodYield()` |

---

## Related Documentation

- **`../aave/README.md`** - AAVE protocol utilities (RAY math, liquidity index, balance conversions)
- **`../userPositionManager.ts`** - User position tracking and net deposits calculation
- **`../../api/index.ts`** - API endpoints that use these yield functions
- **`ponder:schema`** - Database schema for UserBalanceEvent, UserPosition, Borrow, Repay

---

## Import Guide

### For API Endpoints

```typescript
// src/api/index.ts
import {
    calculateUserMonthlyYield,
    calculateUserDailyYieldBreakdown,
    calculateUserDailyPortfolioValue
} from "../helpers/yield/yieldReports";
```

### For Tests

```typescript
// tests/*.test.ts
import { getScaledBalanceAtTimestamp } from "../src/helpers/yield";
import { calculateUserMonthlyYield } from "../src/helpers/yield/yieldReports";
```

### For Internal Helpers

```typescript
// src/helpers/*.ts
import { getScaledBalanceAtTimestamp, getUserAssetsForPeriod } from "./yield";
import { calculateLiquidityIndexAtTimestamp } from "./aave";
```


