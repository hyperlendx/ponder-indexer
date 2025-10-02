# AAVE Protocol Utilities

This directory contains utilities for working with AAVE/Hyperlend protocol calculations and operations.

## File Structure

### `rayMath.ts` - RAY Precision Math
Core mathematical operations using RAY precision (1e27).

**Exports:**
- `RAY` - Constant: 1e27 (RAY precision unit)
- `SECONDS_PER_YEAR` - Constant: 31536000 (365 days in seconds)
- `RayMath` - Class with static methods:
  - `rayMul(a, b)` - Multiply two RAY values with proper rounding
  - `rayDiv(a, b)` - Divide two RAY values with proper rounding

**Usage:**
```typescript
import { RAY, RayMath } from "./aave";

const a = 1500000000000000000000000000n; // 1.5 RAY
const b = 2000000000000000000000000000n; // 2.0 RAY
const result = RayMath.rayMul(a, b); // 3.0 RAY
```

---

### `liquidityIndex.ts` - Liquidity Index Calculations
Functions for calculating and querying liquidity indices using AAVE's methodology.

**Exports:**
- `calculateLinearInterest(liquidityRate, timeElapsed)` - Calculate linear interest factor
- `calculateLiquidityIndex(previousIndex, liquidityRate, timeElapsed)` - Calculate new liquidity index
- `validateLiquidityIndex(index)` - Validate liquidity index is within reasonable bounds
- `calculateLiquidityIndexAtTimestamp(context, reserve, targetTimestamp, currentTxHash?)` - Get liquidity index at any timestamp using 3-step fallback strategy

**3-Step Fallback Strategy:**
1. **Same Transaction** - Check for ReserveDataEvent in same transaction (most accurate)
2. **Historical Lookup** - Find most recent event before target timestamp and calculate forward
3. **Latest Fallback** - Use most recent event regardless of timestamp (for current/future queries)

**Usage:**
```typescript
import { calculateLiquidityIndexAtTimestamp } from "./aave";

const index = await calculateLiquidityIndexAtTimestamp(
    context,
    "0x5555...",  // reserve address
    1757318900,   // target timestamp
    "0xabc..."    // optional: current transaction hash
);
```

---

### `balanceConversions.ts` - Balance Conversions
Convert between scaled and actual balances using AAVE's methodology.

**Exports:**
- `calculateActualBalance(scaledBalance, liquidityIndex)` - Convert scaled → actual balance
- `calculateScaledBalance(actualBalance, liquidityIndex)` - Convert actual → scaled balance

**AAVE Balance System:**
- **Scaled Balance** - Constant value stored in user records
- **Actual Balance** - Grows over time as interest accrues (withdrawable amount)
- **Formula:** `actualBalance = scaledBalance * liquidityIndex / RAY`

**Usage:**
```typescript
import { calculateActualBalance, calculateScaledBalance } from "./aave";

// User deposited 1000 tokens when index was 1.0, now index is 1.05
const scaled = 1000000000000000000000000000000n;
const index = 1050000000000000000000000000n;

const actual = calculateActualBalance(scaled, index);
// Result: 1050000000000000000000000000000n (1050 tokens - earned 50 in interest!)

const scaledBack = calculateScaledBalance(actual, index);
// Result: 1000000000000000000000000000000n (back to original scaled balance)
```

---

### `formatting.ts` - Display Formatting
Format RAY values and token balances for human-readable display.

**Exports:**
- `formatRayValue(value, maxDecimals?)` - Format RAY value to decimal string
- `formatTokenBalance(value, decimals?, maxDecimals?)` - Format token balance from wei to human-readable

**Usage:**
```typescript
import { formatRayValue, formatTokenBalance } from "./aave";

// Format RAY value (1e27 precision)
const rayValue = 1050000000000000000000000000n;
formatRayValue(rayValue); // "1.05"

// Format token balance (wei to human-readable)
const balance = 1000000000000000000n; // 1 ETH in wei
formatTokenBalance(balance, 18); // "1.0"

const usdcBalance = 1000000n; // 1 USDC in wei
formatTokenBalance(usdcBalance, 6); // "1.0"
```

---

### `dateUtils.ts` - Date/Time Utilities
UTC-based date and timestamp utilities for consistent time handling.

**Exports:**
- `getMonthTimestamps(year, month)` - Get start/end timestamps for a month in UTC
- `getYearMonthFromTimestamp(timestamp)` - Extract year and month from timestamp

**Usage:**
```typescript
import { getMonthTimestamps, getYearMonthFromTimestamp } from "./aave";

// Get September 2025 timestamps
const { startTimestamp, endTimestamp } = getMonthTimestamps(2025, 9);
// startTimestamp: Sep-01 00:00:00 UTC
// endTimestamp: Sep-30 23:59:59 UTC

// Extract year/month from timestamp
const { year, month } = getYearMonthFromTimestamp(1757318900);
// year: 2025, month: 9
```

---

### `index.ts` - Main Export
Re-exports all utilities from submodules for convenient importing.

**Usage:**
```typescript
// Import everything from one place
import {
    RAY,
    RayMath,
    calculateLiquidityIndexAtTimestamp,
    calculateActualBalance,
    formatRayValue,
    getMonthTimestamps
} from "./aave";
```

---

## Migration Guide

### Old Import (deprecated):
```typescript
import { ... } from "./aaveProtocolUtils";
import { ... } from "./interestCalculations";
```

### New Import:
```typescript
import { ... } from "./aave";
```

All exports remain the same - only the import path has changed!

---

## Key Concepts

### RAY Precision (1e27)
AAVE uses RAY precision for high-accuracy financial calculations:
- `RAY = 1000000000000000000000000000n` (1e27)
- All liquidity indices, rates, and scaled balances use RAY precision
- Prevents precision loss in interest calculations

### Liquidity Index
A growing multiplier that tracks interest accrual:
- Starts at 1.0 RAY (1e27)
- Grows over time based on liquidity rate
- Used to convert between scaled and actual balances

### Scaled vs Actual Balance
- **Scaled Balance**: Constant value stored in database
- **Actual Balance**: Current withdrawable amount (grows with interest)
- **Relationship**: `actual = scaled * liquidityIndex / RAY`

---

## Testing

All functions are pure (except database queries) and can be easily tested:

```typescript
import { RayMath, RAY } from "./aave";

// Test RAY multiplication
const result = RayMath.rayMul(RAY, RAY);
expect(result).toBe(RAY); // 1.0 * 1.0 = 1.0
```

---

## Performance Notes

- **RAY Math**: O(1) - Simple BigInt operations
- **Liquidity Index Queries**: O(log n) - Indexed database queries
- **Balance Conversions**: O(1) - Simple multiplication/division

---

## Related Files

- `../monthlyInterestCalculator.ts` - Uses these utilities for yield calculations
- `../userPositionManager.ts` - Uses these utilities for position tracking
- `../../index.ts` - Event handlers that use balance conversions
- `../../api/index.ts` - API endpoints that use formatting utilities

