/**
 * beHYPE Helper Functions
 * 
 * Re-exports all beHYPE-related helper functions for easy importing.
 */

// Balance query functions
export {
    getBeHYPEBalanceAtTimestamp,
    getBeHYPEBalanceEvents,
    getBeHYPEPosition,
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

