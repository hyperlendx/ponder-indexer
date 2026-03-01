/**
 * wstHYPE (Thunderhead Wrapped Staked HYPE) Helper Functions
 * 
 * Provides utilities for calculating wstHYPE staking yields.
 * 
 * Key difference from AAVE/Isolated pairs:
 * - Exchange rate is EVENT-BASED, not time-based
 * - Rate only changes on Rebase events
 * - Between events, the rate is CONSTANT
 * - This simplifies calculations significantly
 */

export {
    getWstHYPEBalanceAtTimestamp,
    getWstHYPEBalanceEvents,
    getWstHYPEPosition,
} from "./balanceQueries";

export {
    getWstHYPEExchangeRateAtTimestamp,
    getWstHYPEExchangeRateSnapshots,
    getFirstWstHYPEExchangeRateAfterTimestamp,
} from "./exchangeRate";

export {
    calculateWstHYPECustomPeriodYield,
    calculateWstHYPEDailyYieldBreakdown,
    calculateWstHYPEDailyPortfolioValue,
} from "./yieldCalculations";

