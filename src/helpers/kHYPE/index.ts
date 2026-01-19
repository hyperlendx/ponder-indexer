/**
 * kHYPE (Kinetiq Liquid Staking) Helper Functions
 * 
 * Provides utilities for calculating kHYPE staking yields.
 * 
 * Key difference from AAVE/Isolated pairs:
 * - Exchange rate is EVENT-BASED, not time-based
 * - Rate only changes on RewardEventReported or SlashingEventReported events
 * - Between events, the rate is CONSTANT
 * - This simplifies calculations significantly
 */

export {
    getKHYPEPoolBalanceAtTimestamp,
    getKHYPEPoolBalanceEvents,
} from "./balanceQueries";

export {
    getExchangeRateAtTimestamp,
    getExchangeRateSnapshots,
} from "./exchangeRate";

export {
    calculateKHYPECustomPeriodYield,
    calculateKHYPEDailyYieldBreakdown,
    type KHYPECustomPeriodYieldResult,
    type KHYPEYieldSegment,
    type KHYPEDailyYieldBreakdownResult,
    type KHYPEDailyYield,
} from "./yieldCalculations";

