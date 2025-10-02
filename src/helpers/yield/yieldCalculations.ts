import { UserBalanceEvent } from "ponder:schema";
import { eq, and, gte, lte } from "ponder";
import { calculateLiquidityIndexAtTimestamp, calculateActualBalance } from "../aave";
import { getScaledBalanceAtTimestamp } from "./balanceQueries";

/**
 * Calculate interest earned in a specific time segment
 */
export async function calculateSegmentInterest(
    context: any,
    asset: string,
    segment: {
        startTime: number;
        endTime: number;
        scaledBalance: bigint;
    }
): Promise<bigint> {
    if (segment.scaledBalance === 0n || segment.startTime >= segment.endTime) {
        return 0n;
    }

    // Get liquidity indices at segment boundaries
    const startIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime);
    const endIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime);

    // Calculate actual balances
    const startActualBalance = calculateActualBalance(segment.scaledBalance, startIndex);
    const endActualBalance = calculateActualBalance(segment.scaledBalance, endIndex);

    // Interest earned = growth in actual balance (no deposits/withdrawals in this segment)
    const interest = endActualBalance - startActualBalance;

    return interest;
}

/**
 * Create time segments based on balance events
 */
export async function createTimeSegments(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    events: any[]
): Promise<Array<{
    startTime: number;
    endTime: number;
    scaledBalance: bigint;
}>> {
    const segments = [];

    // Start with balance at beginning of period
    let currentTime = startTimestamp;
    let currentBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);

    // Create segments between events
    for (const event of events) {
        if (event.timestamp > currentTime) {
            // Create segment from currentTime to event.timestamp
            segments.push({
                startTime: currentTime,
                endTime: event.timestamp,
                scaledBalance: currentBalance
            });

            currentTime = event.timestamp;
        }

        // Update balance after this event
        currentBalance = event.scaledBalance;
    }

    // Create final segment from last event to end of period
    if (currentTime < endTimestamp) {
        segments.push({
            startTime: currentTime,
            endTime: endTimestamp,
            scaledBalance: currentBalance
        });
    }

    return segments;
}

/**
 * Enhanced monthly yield calculation that handles intra-month positions
 * Breaks down the month into segments based on balance changes and calculates interest for each segment
 *
 * Algorithm:
 * 1. Get all balance events during the month
 * 2. Create time segments: [monthStart, event1, event2, ..., monthEnd]
 * 3. For each segment, calculate: (scaledBalance * liquidityIndexGrowth)
 * 4. Sum interest from all segments
 */
export async function calculateSegmentedMonthlyYield(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    totalYield: bigint;
    segments: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        scaledBalance: bigint;
        actualBalance: bigint;
        startLiquidityIndex: bigint;
        endLiquidityIndex: bigint;
        segmentYield: bigint;
        durationDays: number;
    }>;
}> {
    // Get all balance events during the month, ordered chronologically
    const dbQuery = context.db.sql || context.db;
    const monthlyEvents = await dbQuery
        .select()
        .from(UserBalanceEvent)
        .where(
            and(
                eq(UserBalanceEvent.user, user as `0x${string}`),
                eq(UserBalanceEvent.asset, asset as `0x${string}`),
                gte(UserBalanceEvent.timestamp, startTimestamp),
                lte(UserBalanceEvent.timestamp, endTimestamp)
            )
        )
        .orderBy(UserBalanceEvent.timestamp);

    // Create time segments for interest calculation
    const segments = await createTimeSegments(context, user, asset, startTimestamp, endTimestamp, monthlyEvents);

    // Calculate interest for each segment and collect detailed information
    let totalInterest = 0n;
    const detailedSegments = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue; // Skip if segment is undefined

        const segmentInterest = await calculateSegmentInterest(context, asset, segment);
        totalInterest += segmentInterest;

        // Get liquidity indices for this segment
        const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime);
        const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime);

        const actualBalance = calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        const durationDays = (segment.endTime - segment.startTime) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: segment.startTime,
            endTime: segment.endTime,
            startDate: new Date(segment.startTime * 1000).toISOString(),
            endDate: new Date(segment.endTime * 1000).toISOString(),
            scaledBalance: segment.scaledBalance,
            actualBalance,
            startLiquidityIndex,
            endLiquidityIndex,
            segmentYield: segmentInterest,
            durationDays: Math.round(durationDays * 100) / 100 // Round to 2 decimal places
        });
    }

    return {
        totalYield: totalInterest,
        segments: detailedSegments
    };
}

/**
 * Enhanced custom period yield calculation that handles intra-period positions
 * Adapts the monthly segmented calculation for arbitrary date ranges
 */
export async function calculateSegmentedCustomPeriodYield(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    totalYield: bigint;
    segments: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        scaledBalance: bigint;
        actualBalance: bigint;
        startLiquidityIndex: bigint;
        endLiquidityIndex: bigint;
        segmentYield: bigint;
        durationDays: number;
    }>;
}> {
    // Get all balance events during the period, ordered chronologically
    const dbQuery = context.db.sql || context.db;
    const periodEvents = await dbQuery
        .select()
        .from(UserBalanceEvent)
        .where(
            and(
                eq(UserBalanceEvent.user, user as `0x${string}`),
                eq(UserBalanceEvent.asset, asset as `0x${string}`),
                gte(UserBalanceEvent.timestamp, startTimestamp),
                lte(UserBalanceEvent.timestamp, endTimestamp)
            )
        )
        .orderBy(UserBalanceEvent.timestamp);

    // Create time segments for interest calculation
    const segments = await createTimeSegments(context, user, asset, startTimestamp, endTimestamp, periodEvents);

    // Calculate interest for each segment and collect detailed information
    let totalInterest = 0n;
    const detailedSegments = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue; // Skip if segment is undefined

        const segmentInterest = await calculateSegmentInterest(context, asset, segment);
        totalInterest += segmentInterest;

        // Get liquidity indices for this segment
        const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime);
        const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime);

        const actualBalance = calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        const durationDays = (segment.endTime - segment.startTime) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: segment.startTime,
            endTime: segment.endTime,
            startDate: new Date(segment.startTime * 1000).toISOString(),
            endDate: new Date(segment.endTime * 1000).toISOString(),
            scaledBalance: segment.scaledBalance,
            actualBalance,
            startLiquidityIndex,
            endLiquidityIndex,
            segmentYield: segmentInterest,
            durationDays: Math.round(durationDays * 100) / 100 // Round to 2 decimal places
        });
    }

    return {
        totalYield: totalInterest,
        segments: detailedSegments
    };
}

