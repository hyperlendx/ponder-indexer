/**
 * wstHYPE Yield Calculation Functions
 *
 * Calculate yield for wstHYPE positions over custom time periods.
 *
 * Yield calculation approach:
 * - wstHYPE balance stays constant (non-rebasing wrapper for stHYPE)
 * - Value increases via exchange rate (assetsPerShare)
 * - Yield = balance × (endRate - startRate) / 1e18
 * - For segments with balance changes, calculate yield for each segment
 *
 * NOTE: This tracks wstHYPE supplied to the HyperLend pool, NOT wallet balances.
 * Yield is calculated based on pool positions and exchange rate changes.
 */

import { getWstHYPEBalanceAtTimestamp, getWstHYPEBalanceEvents } from "./balanceQueries";
import { getWstHYPEExchangeRateAtTimestamp } from "./exchangeRate";
import { AssetPriceSnapshot } from "ponder:schema";
import { eq, lte, desc, and } from "ponder";

const DECIMALS_18 = BigInt(1e18);
const ORACLE_DECIMALS = 8;

// HYPE token address (native token wrapped)
const HYPE_ADDRESS = "0x5555555555555555555555555555555555555555" as `0x${string}`;

const WSTHYPE_TOKEN_ADDRESS = "0x94e8396e0869c9F2200760aF0621aFd240E1CF38".toLowerCase();

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
 * Represents a segment of time where the user's wstHYPE pool balance was constant
 */
export interface WstHYPEYieldSegment {
    startTimestamp: number;
    endTimestamp: number;
    startDate: string;
    endDate: string;
    wstHYPEBalance: string;         // Scaled balance in pool
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
 * Result of custom period yield calculation for wstHYPE
 *
 * This is a simplified, yield-focused response that matches the kHYPE/beHYPE pattern.
 * wstHYPE is a non-rebasing wrapper for stHYPE - balance stays constant but value
 * increases via the assetsPerShare exchange rate on Rebase events.
 *
 * NOTE: This tracks wstHYPE supplied to the HyperLend pool, NOT wallet balances.
 */
export interface WstHYPECustomPeriodYieldResult {
    user: string;
    asset: string;                  // wstHYPE token address (for easy mapping)
    fromTimestamp: number;
    toTimestamp: number;

    // Yield calculation (from exchange rate appreciation)
    totalYieldEarned: string;       // Total yield earned during period (in HYPE terms)
    totalYieldEarnedUSD: string;    // Total yield in USD

    // Detailed breakdown by segment
    yieldSegments: WstHYPEYieldSegment[];
}

/**
 * Calculate wstHYPE staking yield for a user over a custom time period.
 *
 * This calculates the yield from exchange rate appreciation (staking rewards).
 * The yield is calculated based on the user's wstHYPE pool position (supplied to HyperLend).
 */
export async function calculateWstHYPECustomPeriodYield(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<WstHYPECustomPeriodYieldResult> {
    const normalizedUser = user.toLowerCase();

    // Get pool balance (scaled balance) at start of period
    const startBalance = await getWstHYPEBalanceAtTimestamp(context, normalizedUser, startTimestamp);

    // Get all pool balance events during the period
    const balanceEvents = await getWstHYPEBalanceEvents(context, normalizedUser, startTimestamp, endTimestamp);

    // Build segments for yield calculation
    const segments: WstHYPEYieldSegment[] = [];
    let totalYieldEarned = 0n;
    let totalYieldEarnedUSDSum = 0;

    // Create time points: start, each balance event, end
    interface TimePoint {
        timestamp: number;
        scaledBalance: bigint;
    }

    const timePoints: TimePoint[] = [
        { timestamp: startTimestamp, scaledBalance: startBalance }
    ];

    // Add balance events as time points (scaledBalance AFTER the event)
    for (const event of balanceEvents) {
        timePoints.push({
            timestamp: event.timestamp,
            scaledBalance: event.scaledBalance,
        });
    }

    // Process each segment
    for (let i = 0; i < timePoints.length; i++) {
        const segmentStart = timePoints[i]!;
        const nextPoint = timePoints[i + 1];
        const segmentEnd = nextPoint !== undefined
            ? nextPoint
            : { timestamp: endTimestamp, scaledBalance: segmentStart.scaledBalance };

        // Skip if segment has no duration or zero balance
        if (segmentEnd.timestamp <= segmentStart.timestamp || segmentStart.scaledBalance === 0n) {
            continue;
        }

        // Get exchange rates for this segment
        const segStartRate = await getWstHYPEExchangeRateAtTimestamp(context, segmentStart.timestamp);
        const segEndRate = await getWstHYPEExchangeRateAtTimestamp(context, segmentEnd.timestamp);

        // Calculate HYPE values (wstHYPE balance × exchange rate = HYPE value)
        const startHYPEValue = (segmentStart.scaledBalance * segStartRate) / DECIMALS_18;
        const endHYPEValue = (segmentStart.scaledBalance * segEndRate) / DECIMALS_18;

        // Yield = balance × (endRate - startRate) / 1e18
        // This represents the HYPE earned from exchange rate appreciation
        const segmentYield = (segmentStart.scaledBalance * (segEndRate - segStartRate)) / DECIMALS_18;

        // Get HYPE price for this segment (use midpoint for more accurate USD value)
        const segmentMidpoint = Math.floor((segmentStart.timestamp + segmentEnd.timestamp) / 2);
        const hypePrice = await getHYPEPriceAtTimestamp(context, segmentMidpoint);

        const segmentYieldUSD = calculateHYPEtoUSD(segmentYield, hypePrice);

        segments.push({
            startTimestamp: segmentStart.timestamp,
            endTimestamp: segmentEnd.timestamp,
            startDate: new Date(segmentStart.timestamp * 1000).toISOString(),
            endDate: new Date(segmentEnd.timestamp * 1000).toISOString(),
            wstHYPEBalance: segmentStart.scaledBalance.toString(),
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
        asset: WSTHYPE_TOKEN_ADDRESS,
        fromTimestamp: startTimestamp,
        toTimestamp: endTimestamp,
        totalYieldEarned: totalYieldEarned.toString(),
        totalYieldEarnedUSD: totalYieldEarnedUSDSum.toFixed(4),
        yieldSegments: segments,
    };
}

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Represents a single day's yield breakdown
 */
export interface WstHYPEDailyYield {
    date: string;
    timestamp: number;
    endTimestamp: number;
    isPartialDay: boolean;
    wstHYPEBalance: string;
    startExchangeRate: string;
    endExchangeRate: string;
    dailyYield: string;
    hypePrice: string;
    dailyYieldUSD: string;
    startHYPEValue: string;
    endHYPEValue: string;
    startHYPEValueUSD: string;
    endHYPEValueUSD: string;
}

/**
 * Result of daily yield breakdown calculation
 */
export interface WstHYPEDailyYieldBreakdownResult {
    user: string;
    fromTimestamp: number;
    toTimestamp: number;
    fromDate: string;
    toDate: string;
    totalYieldEarned: string;
    totalYieldEarnedUSD: string;
    hypePrice: string;
    dailyBreakdown: WstHYPEDailyYield[];
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
 * Format timestamp as YYYY-MM-DD
 */
function formatDateUTC(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0]!;
}

/**
 * Calculate yield for a single day/period segment
 */
async function calculateSegmentYield(
    context: any,
    normalizedUser: string,
    segmentStart: number,
    segmentEnd: number,
    initialBalance: bigint,
    balanceEvents: Array<{ timestamp: number; scaledBalance: bigint }>
): Promise<{ yield: bigint; endBalance: bigint }> {
    const segmentEvents = balanceEvents.filter(
        e => e.timestamp >= segmentStart && e.timestamp < segmentEnd
    );

    let totalYield = 0n;
    let currentSegmentStart = segmentStart;
    let currentBalance = initialBalance;

    for (const event of segmentEvents) {
        if (currentBalance > 0n && event.timestamp > currentSegmentStart) {
            const startRate = await getWstHYPEExchangeRateAtTimestamp(context, currentSegmentStart);
            const endRate = await getWstHYPEExchangeRateAtTimestamp(context, event.timestamp);
            const segmentYield = (currentBalance * (endRate - startRate)) / DECIMALS_18;
            totalYield += segmentYield;
        }
        currentSegmentStart = event.timestamp;
        currentBalance = event.scaledBalance;
    }

    if (currentBalance > 0n && segmentEnd > currentSegmentStart) {
        const startRate = await getWstHYPEExchangeRateAtTimestamp(context, currentSegmentStart);
        const endRate = await getWstHYPEExchangeRateAtTimestamp(context, segmentEnd);
        const segmentYield = (currentBalance * (endRate - startRate)) / DECIMALS_18;
        totalYield += segmentYield;
    }

    return { yield: totalYield, endBalance: currentBalance };
}

/**
 * Calculate wstHYPE daily yield breakdown for a user over a time period
 */
export async function calculateWstHYPEDailyYieldBreakdown(
    context: any,
    user: string,
    fromTimestamp: number,
    toTimestamp: number
): Promise<WstHYPEDailyYieldBreakdownResult> {
    const normalizedUser = user.toLowerCase();
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const effectiveToTimestamp = Math.min(toTimestamp, currentTimestamp);

    const startBalance = await getWstHYPEBalanceAtTimestamp(context, normalizedUser, fromTimestamp);
    const balanceEvents = await getWstHYPEBalanceEvents(context, normalizedUser, fromTimestamp, effectiveToTimestamp);

    const dailyBreakdown: WstHYPEDailyYield[] = [];
    let totalYieldEarned = 0n;
    let currentBalance = startBalance;

    const fromStartOfDay = getStartOfDayUTC(fromTimestamp);
    const toStartOfDay = getStartOfDayUTC(effectiveToTimestamp);
    const startsAtMidnight = fromTimestamp === fromStartOfDay;
    const endsAtMidnight = effectiveToTimestamp === toStartOfDay;

    async function buildDailyEntry(
        date: string,
        dayStart: number,
        dayEnd: number,
        isPartial: boolean,
        startRate: bigint,
        endRate: bigint,
        yieldAmount: bigint,
        balance: bigint
    ): Promise<WstHYPEDailyYield> {
        const midpoint = Math.floor((dayStart + dayEnd) / 2);
        const hypePrice = await getHYPEPriceAtTimestamp(context, midpoint);
        const startHYPEValue = (balance * startRate) / DECIMALS_18;
        const endHYPEValue = (balance * endRate) / DECIMALS_18;

        return {
            date,
            timestamp: dayStart,
            endTimestamp: dayEnd,
            isPartialDay: isPartial,
            wstHYPEBalance: balance.toString(),
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

    // First partial day
    if (!startsAtMidnight) {
        const firstDayEnd = fromStartOfDay + SECONDS_PER_DAY;
        const actualEnd = Math.min(firstDayEnd, effectiveToTimestamp);
        const startRate = await getWstHYPEExchangeRateAtTimestamp(context, fromTimestamp);
        const endRate = await getWstHYPEExchangeRateAtTimestamp(context, actualEnd);
        const result = await calculateSegmentYield(context, normalizedUser, fromTimestamp, actualEnd, currentBalance, balanceEvents);

        if (result.endBalance > 0n || result.yield > 0n) {
            const entry = await buildDailyEntry(formatDateUTC(fromTimestamp), fromTimestamp, actualEnd, true, startRate, endRate, result.yield, result.endBalance);
            dailyBreakdown.push(entry);
        }
        totalYieldEarned += result.yield;
        currentBalance = result.endBalance;
    }

    // Full days
    const firstFullDayStart = startsAtMidnight ? fromStartOfDay : fromStartOfDay + SECONDS_PER_DAY;
    const lastFullDayStart = endsAtMidnight ? toStartOfDay - SECONDS_PER_DAY : toStartOfDay - SECONDS_PER_DAY;

    if (firstFullDayStart <= lastFullDayStart && firstFullDayStart < effectiveToTimestamp) {
        let currentDayStart = firstFullDayStart;
        while (currentDayStart <= lastFullDayStart) {
            const currentDayEnd = currentDayStart + SECONDS_PER_DAY;
            if (currentDayStart >= effectiveToTimestamp) break;

            const startRate = await getWstHYPEExchangeRateAtTimestamp(context, currentDayStart);
            const endRate = await getWstHYPEExchangeRateAtTimestamp(context, currentDayEnd);
            const result = await calculateSegmentYield(context, normalizedUser, currentDayStart, currentDayEnd, currentBalance, balanceEvents);

            if (result.endBalance > 0n || result.yield > 0n) {
                const entry = await buildDailyEntry(formatDateUTC(currentDayStart), currentDayStart, currentDayEnd, false, startRate, endRate, result.yield, result.endBalance);
                dailyBreakdown.push(entry);
            }
            totalYieldEarned += result.yield;
            currentBalance = result.endBalance;
            currentDayStart += SECONDS_PER_DAY;
        }
    }

    // Last partial day
    if (!endsAtMidnight && toStartOfDay > fromStartOfDay) {
        const lastPartialStart = toStartOfDay;
        if (lastPartialStart < effectiveToTimestamp && lastPartialStart >= (startsAtMidnight ? fromStartOfDay : fromStartOfDay + SECONDS_PER_DAY)) {
            const startRate = await getWstHYPEExchangeRateAtTimestamp(context, lastPartialStart);
            const endRate = await getWstHYPEExchangeRateAtTimestamp(context, effectiveToTimestamp);
            const result = await calculateSegmentYield(context, normalizedUser, lastPartialStart, effectiveToTimestamp, currentBalance, balanceEvents);

            if (result.endBalance > 0n || result.yield > 0n) {
                const entry = await buildDailyEntry(formatDateUTC(lastPartialStart), lastPartialStart, effectiveToTimestamp, true, startRate, endRate, result.yield, result.endBalance);
                dailyBreakdown.push(entry);
            }
            totalYieldEarned += result.yield;
        }
    }

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
 * Represents a single day's portfolio value snapshot for wstHYPE
 */
export interface WstHYPEDailyPortfolioValue {
    date: string;
    timestamp: number;
    isPartialDay: boolean;
    wstHYPEBalance: string;
    exchangeRate: string;
    hypeValue: string;
    hypePrice: string;
    hypeValueUSD: string;
}

/**
 * Result of daily portfolio value calculation for wstHYPE
 */
export interface WstHYPEDailyPortfolioValueResult {
    user: string;
    fromTimestamp: number;
    toTimestamp: number;
    fromDate: string;
    toDate: string;
    days: number;
    dailyPortfolioValues: WstHYPEDailyPortfolioValue[];
}

/**
 * Calculate daily portfolio values for wstHYPE holdings over a time period
 */
export async function calculateWstHYPEDailyPortfolioValue(
    context: any,
    user: string,
    fromTimestamp: number,
    toTimestamp: number
): Promise<WstHYPEDailyPortfolioValueResult> {
    const normalizedUser = user.toLowerCase();
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const effectiveToTimestamp = Math.min(toTimestamp, currentTimestamp);

    const startBalance = await getWstHYPEBalanceAtTimestamp(context, normalizedUser, fromTimestamp);
    const balanceEvents = await getWstHYPEBalanceEvents(context, normalizedUser, fromTimestamp, effectiveToTimestamp);

    const fromDate = new Date(fromTimestamp * 1000);
    fromDate.setUTCHours(0, 0, 0, 0);
    const firstDayStart = Math.floor(fromDate.getTime() / 1000);

    const toDate = new Date(effectiveToTimestamp * 1000);
    toDate.setUTCHours(0, 0, 0, 0);
    const lastDayStart = Math.floor(toDate.getTime() / 1000);

    const lastDayEnd = lastDayStart + SECONDS_PER_DAY - 1;
    const isLastDayPartial = effectiveToTimestamp < lastDayEnd;

    const dailyPortfolioValues: WstHYPEDailyPortfolioValue[] = [];

    function getBalanceAtTimestamp(timestamp: number): bigint {
        let balance = startBalance;
        for (const event of balanceEvents) {
            if (event.timestamp <= timestamp) {
                balance = event.scaledBalance;
            } else {
                break;
            }
        }
        return balance;
    }

    for (let dayStart = firstDayStart; dayStart <= lastDayStart; dayStart += SECONDS_PER_DAY) {
        const isLastDay = dayStart === lastDayStart;
        let dayEnd = dayStart + SECONDS_PER_DAY - 1;
        let isPartialDay = false;

        if (isLastDay && isLastDayPartial) {
            dayEnd = effectiveToTimestamp;
            isPartialDay = true;
        }

        const balance = getBalanceAtTimestamp(dayEnd);
        if (balance === 0n) continue;

        const exchangeRate = await getWstHYPEExchangeRateAtTimestamp(context, dayEnd);
        const hypeValue = (balance * exchangeRate) / DECIMALS_18;
        const hypePrice = await getHYPEPriceAtTimestamp(context, dayEnd);

        dailyPortfolioValues.push({
            date: formatDateUTC(dayStart),
            timestamp: dayEnd,
            isPartialDay,
            wstHYPEBalance: balance.toString(),
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

