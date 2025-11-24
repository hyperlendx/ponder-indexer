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

export { getUserIsolatedPairs } from "./pairTracking";

export {
    getIsolatedPairCollateralBalance,
    getIsolatedPairAssetShares,
    getIsolatedPairBorrowShares,
    convertSharesToAssets
} from "./balanceQueries";

export {
    calculateIsolatedPairExchangeRateAtTimestamp,
    getIsolatedPairExchangeRate
} from "./exchangeRate";

export {
    calculateIsolatedPairPosition,
    calculateAllIsolatedPairPositions,
    calculateCustomPeriodIsolatedPairPositions
} from "./positionCalculations";
export type {
    IsolatedPairPosition,
    IsolatedPairCustomPeriodPosition
} from "./positionCalculations";

export {
    calculateIsolatedPairYield,
    calculateAllIsolatedPairYields
} from "./yieldCalculations";
export type { IsolatedPairYield } from "./yieldCalculations";

export {
    calculateDailyIsolatedPairYields,
} from "./timeAggregations";
export type {
    DailyIsolatedPairYield,
    MonthlyIsolatedPairYield
} from "./timeAggregations";

export { ExchangeRateCache } from "./exchangeRateCache";
export { IsolatedPairBalanceCache } from "./balanceCache";

export { getUserIsolatedPairsForPeriod } from "./periodTracking";

export { calculateUserDailyIsolatedPairPortfolioValue } from "./portfolioValue";

