/**
 * Isolated Pair Utilities - Main Export
 * 
 * This module provides utilities for working with isolated lending pairs.
 * Isolated pairs use ERC4626-style shares-based accounting, different from
 * the index-based accounting used in the regular AAVE pool.
 * 
 * @module isolatedPair
 */

// Re-export constants
export { EXCHANGE_PRECISION } from "./constants";

// Re-export pair tracking functions
export { getUserIsolatedPairs } from "./pairTracking";

// Re-export balance query functions
export {
    getIsolatedPairCollateralBalance,
    getIsolatedPairAssetShares,
    getIsolatedPairBorrowShares,
    convertSharesToAssets
} from "./balanceQueries";

// Re-export exchange rate functions
export {
    calculateIsolatedPairExchangeRateAtTimestamp,
    getIsolatedPairExchangeRate
} from "./exchangeRate";

// Re-export position calculation functions
export {
    calculateIsolatedPairPosition,
    calculateAllIsolatedPairPositions
} from "./positionCalculations";
export type { IsolatedPairPosition } from "./positionCalculations";

// Re-export yield calculation functions
export {
    calculateIsolatedPairYield,
    calculateAllIsolatedPairYields
} from "./yieldCalculations";
export type { IsolatedPairYield } from "./yieldCalculations";

// Re-export time aggregation functions
export {
    calculateDailyIsolatedPairYields,
    calculateMonthlyIsolatedPairYields
} from "./timeAggregations";
export type {
    DailyIsolatedPairYield,
    MonthlyIsolatedPairYield
} from "./timeAggregations";

// Re-export caching utilities
export { ExchangeRateCache } from "./exchangeRateCache";
export { IsolatedPairBalanceCache } from "./balanceCache";

// Note: getUserPairEvents is intentionally NOT exported as it's an internal helper

