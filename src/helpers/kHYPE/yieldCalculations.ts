/**
 * kHYPE Yield Calculation Functions
 *
 * Calculates staking yield for kHYPE holders based on exchange rate changes.
 *
 * Yield Formula:
 * yield = kHYPE_balance × (endRate - startRate) / 1e18
 *
 * For positions with balance changes during the period, we calculate
 * yield for each segment between balance changes.
 */

import { getKHYPEPoolBalanceAtTimestamp, getKHYPEPoolBalanceEvents } from "./balanceQueries";
import { getExchangeRateAtTimestamp } from "./exchangeRate";
import { AssetPriceSnapshot } from "ponder:schema";
import { eq, lte, desc, and } from "ponder";

const DECIMALS_18 = BigInt(1e18);
const SECONDS_PER_DAY = 24 * 60 * 60;
const ORACLE_DECIMALS = 8;

// HYPE token address (native token wrapped)
const HYPE_ADDRESS = "0x5555555555555555555555555555555555555555" as `0x${string}`;

/**
 * Get HYPE price at a specific timestamp from AssetPriceSnapshot
 * Returns price with 8 decimals precision
 */
async function getHYPEPriceAtTimestamp(context: any, timestamp: number): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const snapshots = await dbQuery.select().from(AssetPriceSnapshot).where(
            and(
                eq(AssetPriceSnapshot.asset, HYPE_ADDRESS),
                lte(AssetPriceSnapshot.timestamp, timestamp)
            )
        ).orderBy(desc(AssetPriceSnapshot.timestamp)).limit(1);

        if (snapshots.length > 0 && snapshots[0].price > 0n) {
            return snapshots[0].price;
        }

        return 0n;
    } catch (error) {
        console.error(`Error fetching HYPE price at timestamp ${timestamp}:`, error);
        return 0n;
    }
}

/**
 * Calculate USD value from HYPE amount and price
 * @param hypeAmount - HYPE amount (18 decimals)
 * @param hypePrice - HYPE price (8 decimals)
 * @returns USD value as string with 4 decimal places
 */
function calculateHYPEtoUSD(hypeAmount: bigint, hypePrice: bigint): string {
    if (hypePrice === 0n) return "0";

    // Formula: (hypeAmount / 1e18) * (hypePrice / 1e8)
    // = (hypeAmount * hypePrice) / 1e26
    const numerator = hypeAmount * hypePrice;
    const denominator = DECIMALS_18 * BigInt(10 ** ORACLE_DECIMALS);

    const integerPart = numerator / denominator;
    const remainder = numerator % denominator;
    const decimalPart = (remainder * 10000n) / denominator;

    return `${integerPart}.${decimalPart.toString().padStart(4, '0')}`;
}

/**
 * Represents a segment of time where the user's kHYPE balance was constant
 */
export interface KHYPEYieldSegment {
    startTimestamp: number;
    endTimestamp: number;
    startDate: string;
    endDate: string;
    kHYPEBalance: string;
    startExchangeRate: string;
    endExchangeRate: string;
    startHYPEValue: string;
    endHYPEValue: string;
    yieldEarned: string;
    // USD values
    hypePrice: string;              // HYPE price in USD (8 decimals)
    startHYPEValueUSD: string;      // USD value at start
    endHYPEValueUSD: string;        // USD value at end
    yieldEarnedUSD: string;         // Yield in USD
    durationSeconds: number;
}

/**
 * Result of custom period yield calculation for kHYPE
 *
 * This is a simplified, yield-focused response that complements the core pool endpoint.
 * The core pool endpoint (/custom-period-yield) returns kHYPE with correct deposit/withdraw/borrow/repay
 * data and borrow costs, but yield = 0 (since liquidity index doesn't capture LST staking rewards).
 *
 * This endpoint returns ONLY the staking yield from exchange rate appreciation.
 * Frontend should add this yield to the kHYPE row from the core pool response.
 */
export interface KHYPECustomPeriodYieldResult {
    user: string;
    asset: string;                  // kHYPE token address (for easy mapping to core pool response)
    fromTimestamp: number;
    toTimestamp: number;

    // Yield calculation (from exchange rate appreciation)
    totalYieldEarned: string;       // Total yield earned during period (in HYPE terms)
    totalYieldEarnedUSD: string;    // Total yield in USD

    // Detailed breakdown by segment
    yieldSegments: KHYPEYieldSegment[];
}

// kHYPE token address
const KHYPE_TOKEN_ADDRESS = "0xB4E0dB23D8573990bF0A89e4a438B5b8E3f4f5E6".toLowerCase();

/**
 * Calculate kHYPE staking yield for a user over a custom time period.
 *
 * This calculates ONLY the yield from exchange rate appreciation (staking rewards).
 * It complements the core pool endpoint which handles deposits/withdrawals/borrows/repays
 * and borrow costs, but returns yield = 0 for kHYPE.
 *
 * The yield is calculated based on the user's kHYPE pool balance (supplied to HyperLend),
 * NOT their wallet balance.
 */
export async function calculateKHYPECustomPeriodYield(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<KHYPECustomPeriodYieldResult> {
    const normalizedUser = user.toLowerCase();

    // Get pool balance at start of period (scaled balance from UserBalanceEvent)
    const startBalance = await getKHYPEPoolBalanceAtTimestamp(context, normalizedUser, startTimestamp);

    // Get all pool balance events during the period
    const balanceEvents = await getKHYPEPoolBalanceEvents(context, normalizedUser, startTimestamp, endTimestamp);

    // Build segments for yield calculation
    const segments: KHYPEYieldSegment[] = [];
    let totalYieldEarned = 0n;
    let totalYieldEarnedUSDSum = 0;

    // Create time points: start, each balance event, end
    interface TimePoint {
        timestamp: number;
        balance: bigint;
    }

    const timePoints: TimePoint[] = [
        { timestamp: startTimestamp, balance: startBalance }
    ];

    // Add balance events as time points (balance AFTER the event)
    for (const event of balanceEvents) {
        timePoints.push({
            timestamp: event.timestamp,
            balance: event.scaledBalance,
        });
    }

    // Process each segment
    for (let i = 0; i < timePoints.length; i++) {
        const segmentStart = timePoints[i]!;
        const nextPoint = timePoints[i + 1];
        const segmentEnd = nextPoint !== undefined
            ? nextPoint
            : { timestamp: endTimestamp, balance: segmentStart.balance };

        // Skip if segment has no duration or zero balance
        if (segmentEnd.timestamp <= segmentStart.timestamp || segmentStart.balance === 0n) {
            continue;
        }

        // Get exchange rates for this segment
        const segStartRate = await getExchangeRateAtTimestamp(context, segmentStart.timestamp);
        const segEndRate = await getExchangeRateAtTimestamp(context, segmentEnd.timestamp);

        // Calculate HYPE values (kHYPE balance * exchange rate = HYPE value)
        const startHYPEValue = (segmentStart.balance * segStartRate) / DECIMALS_18;
        const endHYPEValue = (segmentStart.balance * segEndRate) / DECIMALS_18;

        // Yield = balance × (endRate - startRate) / 1e18
        // This represents the HYPE earned from exchange rate appreciation
        const segmentYield = (segmentStart.balance * (segEndRate - segStartRate)) / DECIMALS_18;

        // Get HYPE price for this segment (use midpoint for more accurate USD value)
        const segmentMidpoint = Math.floor((segmentStart.timestamp + segmentEnd.timestamp) / 2);
        const hypePrice = await getHYPEPriceAtTimestamp(context, segmentMidpoint);

        const segmentYieldUSD = calculateHYPEtoUSD(segmentYield, hypePrice);

        segments.push({
            startTimestamp: segmentStart.timestamp,
            endTimestamp: segmentEnd.timestamp,
            startDate: new Date(segmentStart.timestamp * 1000).toISOString(),
            endDate: new Date(segmentEnd.timestamp * 1000).toISOString(),
            kHYPEBalance: segmentStart.balance.toString(),
            startExchangeRate: segStartRate.toString(),
            endExchangeRate: segEndRate.toString(),
            startHYPEValue: startHYPEValue.toString(),
            endHYPEValue: endHYPEValue.toString(),
            yieldEarned: segmentYield.toString(),
            hypePrice: hypePrice.toString(),
            startHYPEValueUSD: calculateHYPEtoUSD(startHYPEValue, hypePrice),
            endHYPEValueUSD: calculateHYPEtoUSD(endHYPEValue, hypePrice),
            yieldEarnedUSD: segmentYieldUSD,
            durationSeconds: segmentEnd.timestamp - segmentStart.timestamp,
        });

        totalYieldEarned += segmentYield;
        totalYieldEarnedUSDSum += parseFloat(segmentYieldUSD);
    }

    return {
        user: normalizedUser,
        asset: KHYPE_TOKEN_ADDRESS,
        fromTimestamp: startTimestamp,
        toTimestamp: endTimestamp,
        totalYieldEarned: totalYieldEarned.toString(),
        totalYieldEarnedUSD: totalYieldEarnedUSDSum.toFixed(4),
        yieldSegments: segments,
    };
}

/**
 * Represents a single day's yield breakdown
 */
export interface KHYPEDailyYield {
    date: string;                   // YYYY-MM-DD format
    timestamp: number;              // Start of the period for this day entry
    endTimestamp: number;           // End of the period for this day entry
    isPartialDay: boolean;          // Whether this is a partial day (start or end of period)
    kHYPEBalance: string;           // Balance at end of the day/period
    startExchangeRate: string;      // Exchange rate at start of period
    endExchangeRate: string;        // Exchange rate at end of period
    dailyYield: string;             // Yield earned during this day/period (in HYPE)
    // USD values
    hypePrice: string;              // HYPE price in USD (8 decimals)
    dailyYieldUSD: string;          // Yield in USD
    startHYPEValue: string;         // HYPE value at start of day
    endHYPEValue: string;           // HYPE value at end of day
    startHYPEValueUSD: string;      // USD value at start of day
    endHYPEValueUSD: string;        // USD value at end of day
}

/**
 * Result of daily yield breakdown calculation
 */
export interface KHYPEDailyYieldBreakdownResult {
    user: string;
    fromTimestamp: number;
    toTimestamp: number;
    fromDate: string;
    toDate: string;
    totalYieldEarned: string;
    totalYieldEarnedUSD: string;
    hypePrice: string;              // HYPE price at end of period
    dailyBreakdown: KHYPEDailyYield[];
}

/**
 * Get the start of day (midnight UTC) for a given timestamp
 */
function getStartOfDayUTC(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    date.setUTCHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

/**
 * Get the end of day (23:59:59.999 UTC) for a given timestamp
 */
function getEndOfDayUTC(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    date.setUTCHours(23, 59, 59, 999);
    return Math.floor(date.getTime() / 1000);
}

/**
 * Format timestamp as YYYY-MM-DD
 */
function formatDateUTC(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0]!;
}

/**
 * Calculate yield for a single day/period segment
 * Helper function to avoid code duplication
 */
async function calculateSegmentYield(
    context: any,
    normalizedUser: string,
    segmentStart: number,
    segmentEnd: number,
    initialBalance: bigint,
    balanceEvents: Array<{ timestamp: number; balance: bigint }>
): Promise<{ yield: bigint; endBalance: bigint }> {
    // Filter events for this segment
    const segmentEvents = balanceEvents.filter(
        e => e.timestamp >= segmentStart && e.timestamp < segmentEnd
    );

    let totalYield = 0n;
    let currentSegmentStart = segmentStart;
    let currentBalance = initialBalance;

    for (const event of segmentEvents) {
        // Calculate yield for period before this event
        if (currentBalance > 0n && event.timestamp > currentSegmentStart) {
            const startRate = await getExchangeRateAtTimestamp(context, currentSegmentStart);
            const endRate = await getExchangeRateAtTimestamp(context, event.timestamp);
            const segmentYield = (currentBalance * (endRate - startRate)) / DECIMALS_18;
            totalYield += segmentYield;
        }

        // Update for next segment
        currentSegmentStart = event.timestamp;
        currentBalance = event.balance;
    }

    // Calculate yield for the final segment (from last event to end)
    if (currentBalance > 0n && segmentEnd > currentSegmentStart) {
        const startRate = await getExchangeRateAtTimestamp(context, currentSegmentStart);
        const endRate = await getExchangeRateAtTimestamp(context, segmentEnd);
        const segmentYield = (currentBalance * (endRate - startRate)) / DECIMALS_18;
        totalYield += segmentYield;
    }

    return { yield: totalYield, endBalance: currentBalance };
}

/**
 * Calculate kHYPE daily yield breakdown for a user over a time period
 *
 * This function breaks down yield into days, including partial days at the start and end.
 * - If fromTimestamp is mid-day: first entry covers fromTimestamp to midnight
 * - Full days: midnight to midnight UTC
 * - If toTimestamp is mid-day: last entry covers midnight to toTimestamp
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param fromTimestamp - Start of period (inclusive)
 * @param toTimestamp - End of period (inclusive)
 * @returns Daily yield breakdown with total yield earned
 */
export async function calculateKHYPEDailyYieldBreakdown(
    context: any,
    user: string,
    fromTimestamp: number,
    toTimestamp: number
): Promise<KHYPEDailyYieldBreakdownResult> {
    const normalizedUser = user.toLowerCase();
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const effectiveToTimestamp = Math.min(toTimestamp, currentTimestamp);

    // Get balance at the start of the period
    const startBalance = await getKHYPEPoolBalanceAtTimestamp(context, normalizedUser, fromTimestamp);

    // Get all balance events during the entire period
    const rawBalanceEvents = await getKHYPEPoolBalanceEvents(
        context,
        normalizedUser,
        fromTimestamp,
        effectiveToTimestamp
    );

    // Map to the format expected by calculateSegmentYield
    const balanceEvents = rawBalanceEvents.map(e => ({
        timestamp: e.timestamp,
        balance: e.scaledBalance,
    }));

    // Build daily breakdown
    const dailyBreakdown: KHYPEDailyYield[] = [];
    let totalYieldEarned = 0n;
    let currentBalance = startBalance;

    // Determine day boundaries
    const fromStartOfDay = getStartOfDayUTC(fromTimestamp);
    const toStartOfDay = getStartOfDayUTC(effectiveToTimestamp);

    // Check if fromTimestamp starts at midnight
    const startsAtMidnight = fromTimestamp === fromStartOfDay;
    // Check if toTimestamp ends at midnight (start of next day)
    const endsAtMidnight = effectiveToTimestamp === toStartOfDay;

    // Helper to build daily entry with USD values
    async function buildDailyEntry(
        date: string,
        dayStart: number,
        dayEnd: number,
        isPartial: boolean,
        startRate: bigint,
        endRate: bigint,
        yieldAmount: bigint,
        balance: bigint
    ): Promise<KHYPEDailyYield> {
        // Get HYPE price for this day (use midpoint)
        const midpoint = Math.floor((dayStart + dayEnd) / 2);
        const hypePrice = await getHYPEPriceAtTimestamp(context, midpoint);

        // Calculate HYPE values
        const startHYPEValue = (balance * startRate) / DECIMALS_18;
        const endHYPEValue = (balance * endRate) / DECIMALS_18;

        return {
            date,
            timestamp: dayStart,
            endTimestamp: dayEnd,
            isPartialDay: isPartial,
            kHYPEBalance: balance.toString(),
            startExchangeRate: startRate.toString(),
            endExchangeRate: endRate.toString(),
            dailyYield: yieldAmount.toString(),
            hypePrice: hypePrice.toString(),
            dailyYieldUSD: calculateHYPEtoUSD(yieldAmount, hypePrice),
            startHYPEValue: startHYPEValue.toString(),
            endHYPEValue: endHYPEValue.toString(),
            startHYPEValueUSD: calculateHYPEtoUSD(startHYPEValue, hypePrice),
            endHYPEValueUSD: calculateHYPEtoUSD(endHYPEValue, hypePrice),
        };
    }

    // Calculate first partial day (if fromTimestamp is not at midnight)
    if (!startsAtMidnight) {
        const firstDayEnd = fromStartOfDay + SECONDS_PER_DAY; // Next midnight
        const actualEnd = Math.min(firstDayEnd, effectiveToTimestamp);

        const startRate = await getExchangeRateAtTimestamp(context, fromTimestamp);
        const endRate = await getExchangeRateAtTimestamp(context, actualEnd);

        const result = await calculateSegmentYield(
            context, normalizedUser, fromTimestamp, actualEnd, currentBalance, balanceEvents
        );

        if (result.endBalance > 0n || result.yield > 0n) {
            const entry = await buildDailyEntry(
                formatDateUTC(fromTimestamp),
                fromTimestamp,
                actualEnd,
                true,
                startRate,
                endRate,
                result.yield,
                result.endBalance
            );
            dailyBreakdown.push(entry);
        }

        totalYieldEarned += result.yield;
        currentBalance = result.endBalance;
    }

    // Calculate full days
    const firstFullDayStart = startsAtMidnight ? fromStartOfDay : fromStartOfDay + SECONDS_PER_DAY;
    const lastFullDayStart = endsAtMidnight ? toStartOfDay - SECONDS_PER_DAY : toStartOfDay - SECONDS_PER_DAY;

    // Only process full days if there are any
    if (firstFullDayStart <= lastFullDayStart && firstFullDayStart < effectiveToTimestamp) {
        let currentDayStart = firstFullDayStart;

        while (currentDayStart <= lastFullDayStart) {
            const currentDayEnd = currentDayStart + SECONDS_PER_DAY;

            // Skip if this day is beyond our effective end
            if (currentDayStart >= effectiveToTimestamp) break;

            const startRate = await getExchangeRateAtTimestamp(context, currentDayStart);
            const endRate = await getExchangeRateAtTimestamp(context, currentDayEnd);

            const result = await calculateSegmentYield(
                context, normalizedUser, currentDayStart, currentDayEnd, currentBalance, balanceEvents
            );

            if (result.endBalance > 0n || result.yield > 0n) {
                const entry = await buildDailyEntry(
                    formatDateUTC(currentDayStart),
                    currentDayStart,
                    currentDayEnd,
                    false,
                    startRate,
                    endRate,
                    result.yield,
                    result.endBalance
                );
                dailyBreakdown.push(entry);
            }

            totalYieldEarned += result.yield;
            currentBalance = result.endBalance;
            currentDayStart += SECONDS_PER_DAY;
        }
    }

    // Calculate last partial day (if toTimestamp is not at midnight and we haven't already covered it)
    if (!endsAtMidnight && toStartOfDay > fromStartOfDay) {
        // Only add last partial day if it's a different day than the first partial day
        const lastPartialStart = toStartOfDay;

        if (lastPartialStart < effectiveToTimestamp && lastPartialStart >= (startsAtMidnight ? fromStartOfDay : fromStartOfDay + SECONDS_PER_DAY)) {
            const startRate = await getExchangeRateAtTimestamp(context, lastPartialStart);
            const endRate = await getExchangeRateAtTimestamp(context, effectiveToTimestamp);

            const result = await calculateSegmentYield(
                context, normalizedUser, lastPartialStart, effectiveToTimestamp, currentBalance, balanceEvents
            );

            if (result.endBalance > 0n || result.yield > 0n) {
                const entry = await buildDailyEntry(
                    formatDateUTC(lastPartialStart),
                    lastPartialStart,
                    effectiveToTimestamp,
                    true,
                    startRate,
                    endRate,
                    result.yield,
                    result.endBalance
                );
                dailyBreakdown.push(entry);
            }

            totalYieldEarned += result.yield;
        }
    }

    // Get HYPE price at end of period for total USD calculation
    const endHypePrice = await getHYPEPriceAtTimestamp(context, effectiveToTimestamp);

    return {
        user: normalizedUser,
        fromTimestamp,
        toTimestamp,
        fromDate: new Date(fromTimestamp * 1000).toISOString(),
        toDate: new Date(toTimestamp * 1000).toISOString(),
        totalYieldEarned: totalYieldEarned.toString(),
        totalYieldEarnedUSD: calculateHYPEtoUSD(totalYieldEarned, endHypePrice),
        hypePrice: endHypePrice.toString(),
        dailyBreakdown,
    };
}

/**
 * Represents a single day's portfolio value snapshot for kHYPE
 */
export interface KHYPEDailyPortfolioValue {
    date: string;                   // YYYY-MM-DD format
    timestamp: number;              // End of day timestamp (or toTimestamp for partial day)
    isPartialDay: boolean;          // Whether this is a partial day (current day)
    kHYPEBalance: string;           // kHYPE balance at end of day
    exchangeRate: string;           // Exchange rate at end of day
    hypeValue: string;              // HYPE value (kHYPE × exchangeRate)
    hypePrice: string;              // HYPE price in USD (8 decimals)
    hypeValueUSD: string;           // USD value of holdings
}

/**
 * Result of daily portfolio value calculation for kHYPE
 */
export interface KHYPEDailyPortfolioValueResult {
    user: string;
    fromTimestamp: number;
    toTimestamp: number;
    fromDate: string;
    toDate: string;
    days: number;
    dailyPortfolioValues: KHYPEDailyPortfolioValue[];
}

/**
 * Calculate daily portfolio values for kHYPE holdings over a time period
 *
 * Returns daily snapshots at END of each day (23:59:59 UTC) showing:
 * - kHYPE balance
 * - Exchange rate
 * - HYPE value (kHYPE × exchangeRate)
 * - USD value
 *
 * For partial days (when toTimestamp is not at midnight), includes the current
 * value at toTimestamp.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param fromTimestamp - Start of period (Unix timestamp)
 * @param toTimestamp - End of period (Unix timestamp)
 * @returns Daily portfolio value snapshots
 */
export async function calculateKHYPEDailyPortfolioValue(
    context: any,
    user: string,
    fromTimestamp: number,
    toTimestamp: number
): Promise<KHYPEDailyPortfolioValueResult> {
    const normalizedUser = user.toLowerCase();
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const effectiveToTimestamp = Math.min(toTimestamp, currentTimestamp);

    // Get balance at the start of the period
    const startBalance = await getKHYPEPoolBalanceAtTimestamp(context, normalizedUser, fromTimestamp);

    // Get all balance events during the entire period
    const rawBalanceEvents = await getKHYPEPoolBalanceEvents(
        context,
        normalizedUser,
        fromTimestamp,
        effectiveToTimestamp
    );

    // Map to simpler format for internal use
    const balanceEvents = rawBalanceEvents.map(e => ({
        timestamp: e.timestamp,
        balance: e.scaledBalance,
    }));

    // Calculate day boundaries
    const fromDate = new Date(fromTimestamp * 1000);
    fromDate.setUTCHours(0, 0, 0, 0);
    const firstDayStart = Math.floor(fromDate.getTime() / 1000);

    const toDate = new Date(effectiveToTimestamp * 1000);
    toDate.setUTCHours(0, 0, 0, 0);
    const lastDayStart = Math.floor(toDate.getTime() / 1000);

    // Check if toTimestamp is a partial day (not at midnight)
    const lastDayEnd = lastDayStart + SECONDS_PER_DAY - 1;
    const isLastDayPartial = effectiveToTimestamp < lastDayEnd;

    const dailyPortfolioValues: KHYPEDailyPortfolioValue[] = [];

    // Helper to get balance at a specific timestamp from events
    function getBalanceAtTimestamp(timestamp: number): bigint {
        // Start with the balance at the beginning of the period
        let balance = startBalance;

        // Apply all events up to and including the timestamp
        for (const event of balanceEvents) {
            if (event.timestamp <= timestamp) {
                balance = event.balance;
            } else {
                break;
            }
        }

        return balance;
    }

    // Generate portfolio values for each day at END of day
    for (let dayStart = firstDayStart; dayStart <= lastDayStart; dayStart += SECONDS_PER_DAY) {
        const isLastDay = dayStart === lastDayStart;
        let dayEnd = dayStart + SECONDS_PER_DAY - 1;
        let isPartialDay = false;

        // For the last day, if it's partial, use effectiveToTimestamp
        if (isLastDay && isLastDayPartial) {
            dayEnd = effectiveToTimestamp;
            isPartialDay = true;
        }

        // Get balance at end of day
        const balance = getBalanceAtTimestamp(dayEnd);

        // Skip days with zero balance
        if (balance === 0n) {
            continue;
        }

        // Get exchange rate at end of day
        const exchangeRate = await getExchangeRateAtTimestamp(context, dayEnd);

        // Calculate HYPE value
        const hypeValue = (balance * exchangeRate) / DECIMALS_18;

        // Get HYPE price for USD calculation
        const hypePrice = await getHYPEPriceAtTimestamp(context, dayEnd);

        dailyPortfolioValues.push({
            date: formatDateUTC(dayStart),
            timestamp: dayEnd,
            isPartialDay,
            kHYPEBalance: balance.toString(),
            exchangeRate: exchangeRate.toString(),
            hypeValue: hypeValue.toString(),
            hypePrice: hypePrice.toString(),
            hypeValueUSD: calculateHYPEtoUSD(hypeValue, hypePrice),
        });
    }

    return {
        user: normalizedUser,
        fromTimestamp,
        toTimestamp,
        fromDate: new Date(fromTimestamp * 1000).toISOString(),
        toDate: new Date(toTimestamp * 1000).toISOString(),
        days: dailyPortfolioValues.length,
        dailyPortfolioValues,
    };
}
