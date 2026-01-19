/**
 * beHYPE Helper Functions
 *
 * Re-exports all beHYPE-related helper functions for easy importing.
 *
 * NOTE: beHYPE yield tracking uses POOL POSITIONS (supplies to HyperLend),
 * NOT wallet balances. This matches the kHYPE pattern.
 */

// Pool balance query functions (tracks beHYPE supplied to HyperLend pool)
export {
    getBeHYPEPoolBalanceAtTimestamp,
    getBeHYPEPoolBalanceEvents,
    getBeHYPEPoolPosition,
} from "./balanceQueries";

// Exchange rate functions
export {
    getBeHYPEExchangeRateAtTimestamp,
    getBeHYPEExchangeRateSnapshots,
    getFirstBeHYPEExchangeRateAfterTimestamp,
} from "./exchangeRate";

// Yield calculation functions and types
export {
    calculateBeHYPECustomPeriodYield,
    calculateBeHYPEDailyYieldBreakdown,
    calculateBeHYPEDailyPortfolioValue,
    type BeHYPEYieldSegment,
    type BeHYPECustomPeriodYieldResult,
    type BeHYPEDailyYield,
    type BeHYPEDailyYieldBreakdownResult,
    type BeHYPEDailyPortfolioValue,
    type BeHYPEDailyPortfolioValueResult,
} from "./yieldCalculations";

