/**
 * beHYPE Yield Calculation Functions
 *
 * Calculates staking yield for beHYPE holders based on exchange rate changes.
 *
 * Yield Formula:
 * yield = beHYPE_balance × (endRate - startRate) / 1e18
 *
 * For positions with balance changes during the period, we calculate
 * yield for each segment between balance changes.
 */

import {getBeHYPEPoolBalanceAtTimestamp, getBeHYPEPoolBalanceEvents} from "./balanceQueries";
import {getBeHYPEExchangeRateAtTimestamp} from "./exchangeRate";
import {AssetPriceSnapshot} from "ponder:schema";
import {eq, lte, desc, and} from "ponder";

const DECIMALS_18 = BigInt(1e18);
const SECONDS_PER_DAY = 24 * 60 * 60;
const ORACLE_DECIMALS = 8;

// HYPE token address (native token wrapped)
const HYPE_ADDRESS = "0x5555555555555555555555555555555555555555" as `0x${string}`;

// beHYPE token address
const BEHYPE_TOKEN_ADDRESS = "0xd8FC8F0b03eBA61F64D08B0bef69d80916E5DdA9".toLowerCase();

/**
 * Get HYPE price at a specific timestamp from AssetPriceSnapshot
 * Returns price with 8 decimals precision
 */
async function getHYPEPriceAtTimestamp(context: any, timestamp: number): Promise<bigint> {
    const {db} = context;
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
 * Represents a segment of time where the user's beHYPE balance was constant
 */
export interface BeHYPEYieldSegment {
    startTimestamp: number;
    endTimestamp: number;
    startDate: string;
    endDate: string;
    beHYPEBalance: string;
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
 * Result of custom period yield calculation for beHYPE
 *
 * This is a simplified, yield-focused response that complements the core pool endpoint.
 * The core pool endpoint (/custom-period-yield) returns beHYPE with correct deposit/withdraw/borrow/repay
 * data and borrow costs, but yield = 0 (since liquidity index doesn't capture LST staking rewards).
 *
 * This endpoint returns ONLY the staking yield from exchange rate appreciation.
 * Frontend should add this yield to the beHYPE row from the core pool response.
 */
export interface BeHYPECustomPeriodYieldResult {
    user: string;
    asset: string;                  // beHYPE token address (for easy mapping to core pool response)
    fromTimestamp: number;
    toTimestamp: number;

    // Yield calculation (from exchange rate appreciation)
    totalYieldEarned: string;       // Total yield earned during period (in HYPE terms)
    totalYieldEarnedUSD: string;    // Total yield in USD

    // Detailed breakdown by segment
    yieldSegments: BeHYPEYieldSegment[];
}

/**
 * Calculate beHYPE staking yield for a user over a custom time period.
 *
 * This calculates ONLY the yield from exchange rate appreciation (staking rewards).
 * It complements the core pool endpoint which handles deposits/withdrawals/borrows/repays
 * and borrow costs, but returns yield = 0 for beHYPE.
 *
 * The yield is calculated based on the user's beHYPE pool balance (supplied to HyperLend),
 * NOT their wallet balance.
 */
export async function calculateBeHYPECustomPeriodYield(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<BeHYPECustomPeriodYieldResult> {
    const normalizedUser = user.toLowerCase();

    // Get pool balance at start of period (scaled balance from UserBalanceEvent)
    const startBalance = await getBeHYPEPoolBalanceAtTimestamp(context, normalizedUser, startTimestamp);

    // Get all pool balance events during the period
    const balanceEvents = await getBeHYPEPoolBalanceEvents(context, normalizedUser, startTimestamp, endTimestamp);

    // Build segments for yield calculation
    const segments: BeHYPEYieldSegment[] = [];
    let totalYieldEarned = 0n;
    let totalYieldEarnedUSDSum = 0;

    // Create time points: start, each balance event, end
    interface TimePoint {
        timestamp: number;
        balance: bigint;
    }

    const timePoints: TimePoint[] = [
        {timestamp: startTimestamp, balance: startBalance}
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
            : {timestamp: endTimestamp, balance: segmentStart.balance};

        // Skip if segment has no duration or zero balance
        if (segmentEnd.timestamp <= segmentStart.timestamp || segmentStart.balance === 0n) {
            continue;
        }

        // Get exchange rates for this segment
        const segStartRate = await getBeHYPEExchangeRateAtTimestamp(context, segmentStart.timestamp);
        const segEndRate = await getBeHYPEExchangeRateAtTimestamp(context, segmentEnd.timestamp);

        // Calculate HYPE values (beHYPE balance * exchange rate = HYPE value)
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
            beHYPEBalance: segmentStart.balance.toString(),
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
        asset: BEHYPE_TOKEN_ADDRESS,
        fromTimestamp: startTimestamp,
        toTimestamp: endTimestamp,
        totalYieldEarned: totalYieldEarned.toString(),
        totalYieldEarnedUSD: totalYieldEarnedUSDSum.toFixed(4),
        yieldSegments: segments,
    };
}

/** Represents a single day's yield breakdown */
export interface BeHYPEDailyYield {
    date: string;
    timestamp: number;
    endTimestamp: number;
    isPartialDay: boolean;
    beHYPEBalance: string;
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

/** Result of daily yield breakdown calculation */
export interface BeHYPEDailyYieldBreakdownResult {
    user: string;
    fromTimestamp: number;
    toTimestamp: number;
    fromDate: string;
    toDate: string;
    totalYieldEarned: string;
    totalYieldEarnedUSD: string;
    hypePrice: string;
    dailyBreakdown: BeHYPEDailyYield[];
}

function getStartOfDayUTC(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    date.setUTCHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

function formatDateUTC(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0]!;
}

async function calculateSegmentYield(
    context: any, normalizedUser: string, segmentStart: number, segmentEnd: number,
    initialBalance: bigint, balanceEvents: Array<{ timestamp: number; scaledBalance: bigint }>
): Promise<{ yield: bigint; endBalance: bigint }> {
    const segmentEvents = balanceEvents.filter(e => e.timestamp >= segmentStart && e.timestamp < segmentEnd);
    let totalYield = 0n, currentSegmentStart = segmentStart, currentBalance = initialBalance;

    for (const event of segmentEvents) {
        if (currentBalance > 0n && event.timestamp > currentSegmentStart) {
            const startRate = await getBeHYPEExchangeRateAtTimestamp(context, currentSegmentStart);
            const endRate = await getBeHYPEExchangeRateAtTimestamp(context, event.timestamp);
            totalYield += (currentBalance * (endRate - startRate)) / DECIMALS_18;
        }
        currentSegmentStart = event.timestamp;
        currentBalance = event.scaledBalance;
    }

    if (currentBalance > 0n && segmentEnd > currentSegmentStart) {
        const startRate = await getBeHYPEExchangeRateAtTimestamp(context, currentSegmentStart);
        const endRate = await getBeHYPEExchangeRateAtTimestamp(context, segmentEnd);
        totalYield += (currentBalance * (endRate - startRate)) / DECIMALS_18;
    }

    return {yield: totalYield, endBalance: currentBalance};
}


/** Calculate beHYPE daily yield breakdown for a user over a time period */
export async function calculateBeHYPEDailyYieldBreakdown(
    context: any, user: string, fromTimestamp: number, toTimestamp: number
): Promise<BeHYPEDailyYieldBreakdownResult> {
    const normalizedUser = user.toLowerCase();
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const effectiveToTimestamp = Math.min(toTimestamp, currentTimestamp);
    const startBalance = await getBeHYPEPoolBalanceAtTimestamp(context, normalizedUser, fromTimestamp);
    const balanceEvents = await getBeHYPEPoolBalanceEvents(context, normalizedUser, fromTimestamp, effectiveToTimestamp);

    const dailyBreakdown: BeHYPEDailyYield[] = [];
    let totalYieldEarned = 0n, currentBalance = startBalance;
    const fromStartOfDay = getStartOfDayUTC(fromTimestamp);
    const toStartOfDay = getStartOfDayUTC(effectiveToTimestamp);
    const startsAtMidnight = fromTimestamp === fromStartOfDay;
    const endsAtMidnight = effectiveToTimestamp === toStartOfDay;

    async function buildDailyEntry(
        date: string, dayStart: number, dayEnd: number, isPartial: boolean,
        startRate: bigint, endRate: bigint, yieldAmount: bigint, balance: bigint
    ): Promise<BeHYPEDailyYield> {
        const midpoint = Math.floor((dayStart + dayEnd) / 2);
        const hypePrice = await getHYPEPriceAtTimestamp(context, midpoint);
        const startHYPEValue = (balance * startRate) / DECIMALS_18;
        const endHYPEValue = (balance * endRate) / DECIMALS_18;
        return {
            date, timestamp: dayStart, endTimestamp: dayEnd, isPartialDay: isPartial,
            beHYPEBalance: balance.toString(),
            startExchangeRate: startRate.toString(), endExchangeRate: endRate.toString(),
            dailyYield: yieldAmount.toString(), hypePrice: hypePrice.toString(),
            dailyYieldUSD: calculateHYPEtoUSD(yieldAmount, hypePrice),
            startHYPEValue: startHYPEValue.toString(), endHYPEValue: endHYPEValue.toString(),
            startHYPEValueUSD: calculateHYPEtoUSD(startHYPEValue, hypePrice),
            endHYPEValueUSD: calculateHYPEtoUSD(endHYPEValue, hypePrice),
        };
    }

    // First partial day
    if (!startsAtMidnight) {
        const firstDayEnd = fromStartOfDay + SECONDS_PER_DAY;
        const actualEnd = Math.min(firstDayEnd, effectiveToTimestamp);
        const startRate = await getBeHYPEExchangeRateAtTimestamp(context, fromTimestamp);
        const endRate = await getBeHYPEExchangeRateAtTimestamp(context, actualEnd);
        const result = await calculateSegmentYield(context, normalizedUser, fromTimestamp, actualEnd, currentBalance, balanceEvents);
        if (result.endBalance > 0n || result.yield > 0n) {
            dailyBreakdown.push(await buildDailyEntry(formatDateUTC(fromTimestamp), fromTimestamp, actualEnd, true, startRate, endRate, result.yield, result.endBalance));
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
            const startRate = await getBeHYPEExchangeRateAtTimestamp(context, currentDayStart);
            const endRate = await getBeHYPEExchangeRateAtTimestamp(context, currentDayEnd);
            const result = await calculateSegmentYield(context, normalizedUser, currentDayStart, currentDayEnd, currentBalance, balanceEvents);
            if (result.endBalance > 0n || result.yield > 0n) {
                dailyBreakdown.push(await buildDailyEntry(formatDateUTC(currentDayStart), currentDayStart, currentDayEnd, false, startRate, endRate, result.yield, result.endBalance));
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
            const startRate = await getBeHYPEExchangeRateAtTimestamp(context, lastPartialStart);
            const endRate = await getBeHYPEExchangeRateAtTimestamp(context, effectiveToTimestamp);
            const result = await calculateSegmentYield(context, normalizedUser, lastPartialStart, effectiveToTimestamp, currentBalance, balanceEvents);
            if (result.endBalance > 0n || result.yield > 0n) {
                dailyBreakdown.push(await buildDailyEntry(formatDateUTC(lastPartialStart), lastPartialStart, effectiveToTimestamp, true, startRate, endRate, result.yield, result.endBalance));
            }
            totalYieldEarned += result.yield;
        }
    }

    const endHypePrice = await getHYPEPriceAtTimestamp(context, effectiveToTimestamp);
    return {
        user: normalizedUser, fromTimestamp, toTimestamp,
        fromDate: new Date(fromTimestamp * 1000).toISOString(),
        toDate: new Date(toTimestamp * 1000).toISOString(),
        totalYieldEarned: totalYieldEarned.toString(),
        totalYieldEarnedUSD: calculateHYPEtoUSD(totalYieldEarned, endHypePrice),
        hypePrice: endHypePrice.toString(), dailyBreakdown,
    };
}

/** Represents a single day's portfolio value snapshot for beHYPE */
export interface BeHYPEDailyPortfolioValue {
    date: string;
    timestamp: number;
    isPartialDay: boolean;
    beHYPEBalance: string;
    exchangeRate: string;
    hypeValue: string;
    hypePrice: string;
    hypeValueUSD: string;
}

/** Result of daily portfolio value calculation for beHYPE */
export interface BeHYPEDailyPortfolioValueResult {
    user: string;
    fromTimestamp: number;
    toTimestamp: number;
    fromDate: string;
    toDate: string;
    days: number;
    dailyPortfolioValues: BeHYPEDailyPortfolioValue[];
}

/** Calculate daily portfolio values for beHYPE holdings over a time period */
export async function calculateBeHYPEDailyPortfolioValue(
    context: any, user: string, fromTimestamp: number, toTimestamp: number
): Promise<BeHYPEDailyPortfolioValueResult> {
    const normalizedUser = user.toLowerCase();
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const effectiveToTimestamp = Math.min(toTimestamp, currentTimestamp);
    const startBalance = await getBeHYPEPoolBalanceAtTimestamp(context, normalizedUser, fromTimestamp);
    const balanceEvents = await getBeHYPEPoolBalanceEvents(context, normalizedUser, fromTimestamp, effectiveToTimestamp);

    const fromDate = new Date(fromTimestamp * 1000);
    fromDate.setUTCHours(0, 0, 0, 0);
    const firstDayStart = Math.floor(fromDate.getTime() / 1000);

    const toDate = new Date(effectiveToTimestamp * 1000);
    toDate.setUTCHours(0, 0, 0, 0);
    const lastDayStart = Math.floor(toDate.getTime() / 1000);

    const lastDayEnd = lastDayStart + SECONDS_PER_DAY - 1;
    const isLastDayPartial = effectiveToTimestamp < lastDayEnd;

    const dailyPortfolioValues: BeHYPEDailyPortfolioValue[] = [];

    function getBalanceAtTimestamp(timestamp: number): bigint {
        let balance = startBalance;
        for (const event of balanceEvents) {
            if (event.timestamp <= timestamp) balance = event.scaledBalance;
            else break;
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

        const exchangeRate = await getBeHYPEExchangeRateAtTimestamp(context, dayEnd);
        const hypeValue = (balance * exchangeRate) / DECIMALS_18;
        const hypePrice = await getHYPEPriceAtTimestamp(context, dayEnd);

        dailyPortfolioValues.push({
            date: formatDateUTC(dayStart),
            timestamp: dayEnd,
            isPartialDay,
            beHYPEBalance: balance.toString(),
            exchangeRate: exchangeRate.toString(),
            hypeValue: hypeValue.toString(),
            hypePrice: hypePrice.toString(),
            hypeValueUSD: calculateHYPEtoUSD(hypeValue, hypePrice),
        });
    }

    return {
        user: normalizedUser, fromTimestamp, toTimestamp,
        fromDate: new Date(fromTimestamp * 1000).toISOString(),
        toDate: new Date(toTimestamp * 1000).toISOString(),
        days: dailyPortfolioValues.length,
        dailyPortfolioValues,
    };
}

