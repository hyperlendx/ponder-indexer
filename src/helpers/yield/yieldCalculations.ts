import { UserBalanceEvent, Borrow, Repay } from "ponder:schema";
import { eq, and, gte, lte } from "ponder";
import { calculateLiquidityIndexAtTimestamp, calculateActualBalance } from "../aave";
import { getScaledBalanceAtTimestamp, getScaledBorrowBalanceAtTimestamp } from "./balanceQueries";
import { LiquidityIndexCache } from "./liquidityIndexCache";
import { calculateVariableBorrowIndexAtTimestamp } from "../aave/borrowIndex";

/**
 * Calculate interest earned in a specific time segment
 * @param indexCache - Optional cache to avoid redundant liquidity index queries
 */
export async function calculateSegmentInterest(
    context: any,
    asset: string,
    segment: {
        startTime: number;
        endTime: number;
        scaledBalance: bigint;
    },
    indexCache?: LiquidityIndexCache
): Promise<bigint> {
    if (segment.scaledBalance === 0n || segment.startTime >= segment.endTime) {
        return 0n;
    }

    // Get liquidity indices at segment boundaries (use cache if available)
    let startIndex: bigint;
    let endIndex: bigint;

    if (indexCache) {
        [startIndex, endIndex] = await Promise.all([
            indexCache.get(context, asset, segment.startTime),
            indexCache.get(context, asset, segment.endTime)
        ]);
    } else {
        [startIndex, endIndex] = await Promise.all([
            calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime),
            calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime)
        ]);
    }

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
        // Ensure timestamp is a number (not BigInt)
        const eventTimestamp = Number(event.timestamp);

        if (eventTimestamp > currentTime) {
            // Create segment from currentTime to event.timestamp
            segments.push({
                startTime: currentTime,
                endTime: eventTimestamp,
                scaledBalance: currentBalance
            });

            currentTime = eventTimestamp;
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
 *
 * @param indexCache - Optional cache to avoid redundant liquidity index queries
 */
export async function calculateSegmentedMonthlyYield(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    indexCache?: LiquidityIndexCache
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

    // Prefetch all liquidity indices for segments if cache provided
    if (indexCache) {
        const indexPrefetchList = [];
        for (const segment of segments) {
            indexPrefetchList.push(
                { asset, timestamp: segment.startTime },
                { asset, timestamp: segment.endTime }
            );
        }
        await indexCache.prefetch(context, indexPrefetchList);
    }

    // Calculate interest for each segment and collect detailed information
    let totalInterest = 0n;
    const detailedSegments = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue; // Skip if segment is undefined

        const segmentInterest = await calculateSegmentInterest(context, asset, segment, indexCache);
        totalInterest += segmentInterest;

        // Get liquidity indices for this segment (use cache if available)
        let startLiquidityIndex: bigint;
        let endLiquidityIndex: bigint;

        if (indexCache) {
            [startLiquidityIndex, endLiquidityIndex] = await Promise.all([
                indexCache.get(context, asset, segment.startTime),
                indexCache.get(context, asset, segment.endTime)
            ]);
        } else {
            [startLiquidityIndex, endLiquidityIndex] = await Promise.all([
                calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime),
                calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime)
            ]);
        }

        const actualBalance = calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        const durationDays = (Number(segment.endTime) - Number(segment.startTime)) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: Number(segment.startTime),
            endTime: Number(segment.endTime),
            startDate: new Date(Number(segment.startTime) * 1000).toISOString(),
            endDate: new Date(Number(segment.endTime) * 1000).toISOString(),
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
 * Custom period yield calculation that handles intra-period positions
 * Adapts the monthly segmented calculation for arbitrary date ranges
 *
 * @param indexCache - Optional cache to avoid redundant liquidity index queries
 */
export async function calculateSegmentedCustomPeriodYield(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    indexCache?: LiquidityIndexCache
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

    // Prefetch all liquidity indices for segments if cache provided
    if (indexCache) {
        const indexPrefetchList = [];
        for (const segment of segments) {
            indexPrefetchList.push(
                { asset, timestamp: segment.startTime },
                { asset, timestamp: segment.endTime }
            );
        }
        await indexCache.prefetch(context, indexPrefetchList);
    }

    // Calculate interest for each segment and collect detailed information
    let totalInterest = 0n;
    const detailedSegments = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue; // Skip if segment is undefined

        const segmentInterest = await calculateSegmentInterest(context, asset, segment, indexCache);
        totalInterest += segmentInterest;

        // Get liquidity indices for this segment (use cache if available)
        let startLiquidityIndex: bigint;
        let endLiquidityIndex: bigint;

        if (indexCache) {
            [startLiquidityIndex, endLiquidityIndex] = await Promise.all([
                indexCache.get(context, asset, segment.startTime),
                indexCache.get(context, asset, segment.endTime)
            ]);
        } else {
            [startLiquidityIndex, endLiquidityIndex] = await Promise.all([
                calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime),
                calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime)
            ]);
        }

        const actualBalance = calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        const durationDays = (Number(segment.endTime) - Number(segment.startTime)) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: Number(segment.startTime),
            endTime: Number(segment.endTime),
            startDate: new Date(Number(segment.startTime) * 1000).toISOString(),
            endDate: new Date(Number(segment.endTime) * 1000).toISOString(),
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
 * Calculate borrow cost (interest paid) in a specific time segment
 * Similar to calculateSegmentInterest but for borrows using variable borrow index
 *
 * @param context - Ponder context with database access
 * @param asset - Asset address
 * @param segment - Time segment with scaled borrow balance
 * @param borrowIndexCache - Optional cache to avoid redundant borrow index queries
 */
export async function calculateSegmentBorrowCost(
    context: any,
    asset: string,
    segment: {
        startTime: number;
        endTime: number;
        scaledBorrowBalance: bigint;
    },
    borrowIndexCache?: Map<string, bigint>
): Promise<bigint> {
    if (segment.scaledBorrowBalance === 0n || segment.startTime >= segment.endTime) {
        return 0n;
    }

    // Get borrow indices at segment boundaries (use cache if available)
    let startIndex: bigint;
    let endIndex: bigint;

    if (borrowIndexCache) {
        const startKey = `${asset}_${segment.startTime}`;
        const endKey = `${asset}_${segment.endTime}`;

        let cachedStart = borrowIndexCache.get(startKey);
        let cachedEnd = borrowIndexCache.get(endKey);

        if (!cachedStart) {
            cachedStart = await calculateVariableBorrowIndexAtTimestamp(context, asset, segment.startTime);
            borrowIndexCache.set(startKey, cachedStart);
        }
        if (!cachedEnd) {
            cachedEnd = await calculateVariableBorrowIndexAtTimestamp(context, asset, segment.endTime);
            borrowIndexCache.set(endKey, cachedEnd);
        }

        startIndex = cachedStart;
        endIndex = cachedEnd;
    } else {
        [startIndex, endIndex] = await Promise.all([
            calculateVariableBorrowIndexAtTimestamp(context, asset, segment.startTime),
            calculateVariableBorrowIndexAtTimestamp(context, asset, segment.endTime)
        ]);
    }

    // Calculate actual borrow balances
    const startActualBalance = calculateActualBalance(segment.scaledBorrowBalance, startIndex);
    const endActualBalance = calculateActualBalance(segment.scaledBorrowBalance, endIndex);

    // Borrow cost = growth in actual borrow balance (interest accrued)
    const borrowCost = endActualBalance - startActualBalance;

    return borrowCost;
}

/**
 * Helper function to create time segments for borrow cost calculation
 * Similar to createTimeSegments but for borrow events
 */
async function createBorrowTimeSegments(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    borrowEvents: any[]
): Promise<Array<{ startTime: number; endTime: number; scaledBorrowBalance: bigint }>> {
    const segments = [];

    // Get scaled borrow balance at start of period
    const startScaledBorrowBalance = await getScaledBorrowBalanceAtTimestamp(context, user, asset, startTimestamp);

    // If no events during period, create single segment
    if (borrowEvents.length === 0) {
        if (startScaledBorrowBalance > 0n) {
            segments.push({
                startTime: startTimestamp,
                endTime: endTimestamp,
                scaledBorrowBalance: startScaledBorrowBalance
            });
        }
        return segments;
    }

    // Create segments between events
    let currentScaledBalance = startScaledBorrowBalance;
    let previousTime = startTimestamp;

    for (const event of borrowEvents) {
        // Ensure timestamp is a number (not BigInt)
        const eventTimestamp = Number(event.timestamp);

        // Add segment before this event (if there's time)
        if (eventTimestamp > previousTime && currentScaledBalance > 0n) {
            segments.push({
                startTime: previousTime,
                endTime: eventTimestamp,
                scaledBorrowBalance: currentScaledBalance
            });
        }

        // Update scaled balance based on event type
        if (event.eventType === 'borrow') {
            currentScaledBalance += event.amount;
        } else if (event.eventType === 'repay') {
            currentScaledBalance -= event.amount;
        }

        previousTime = eventTimestamp;
    }

    // Add final segment from last event to end of period
    if (previousTime < endTimestamp && currentScaledBalance > 0n) {
        segments.push({
            startTime: previousTime,
            endTime: endTimestamp,
            scaledBorrowBalance: currentScaledBalance
        });
    }

    return segments;
}

/**
 * Calculate segmented borrow cost for a custom period with detailed breakdown
 * Similar to calculateSegmentedCustomPeriodYield but for borrow interest
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param asset - Asset address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @param borrowIndexCache - Optional cache to avoid redundant borrow index queries
 */
export async function calculateSegmentedCustomPeriodBorrowCost(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    borrowIndexCache?: Map<string, bigint>
): Promise<{
    totalBorrowCost: bigint;
    segments: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        scaledBorrowBalance: bigint;
        actualBorrowBalance: bigint;
        startBorrowIndex: bigint;
        endBorrowIndex: bigint;
        segmentBorrowCost: bigint;
        durationDays: number;
    }>;
}> {
    // Get all borrow and repay events during the period, ordered chronologically
    const dbQuery = context.db.sql || context.db;

    const [borrowEvents, repayEvents] = await Promise.all([
        dbQuery.select().from(Borrow).where(
            and(
                eq(Borrow.onBehalfOf, user as `0x${string}`),
                eq(Borrow.reserve, asset as `0x${string}`),
                gte(Borrow.timestamp, startTimestamp),
                lte(Borrow.timestamp, endTimestamp)
            )
        ).orderBy(Borrow.timestamp),
        dbQuery.select().from(Repay).where(
            and(
                eq(Repay.user, user as `0x${string}`),
                eq(Repay.reserve, asset as `0x${string}`),
                gte(Repay.timestamp, startTimestamp),
                lte(Repay.timestamp, endTimestamp)
            )
        ).orderBy(Repay.timestamp)
    ]);

    // Combine and sort events
    const allEvents = [
        ...borrowEvents.map((e: any) => ({ ...e, eventType: 'borrow' as const })),
        ...repayEvents.map((e: any) => ({ ...e, eventType: 'repay' as const }))
    ].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    // Create time segments for borrow cost calculation
    const segments = await createBorrowTimeSegments(context, user, asset, startTimestamp, endTimestamp, allEvents);

    // Prefetch all borrow indices for segments if cache provided
    if (borrowIndexCache) {
        const prefetchPromises = [];
        for (const segment of segments) {
            const startKey = `${asset}_${segment.startTime}`;
            const endKey = `${asset}_${segment.endTime}`;

            if (!borrowIndexCache.has(startKey)) {
                prefetchPromises.push(
                    calculateVariableBorrowIndexAtTimestamp(context, asset, segment.startTime)
                        .then(index => borrowIndexCache.set(startKey, index))
                );
            }
            if (!borrowIndexCache.has(endKey)) {
                prefetchPromises.push(
                    calculateVariableBorrowIndexAtTimestamp(context, asset, segment.endTime)
                        .then(index => borrowIndexCache.set(endKey, index))
                );
            }
        }
        await Promise.all(prefetchPromises);
    }

    // Calculate borrow cost for each segment and collect detailed information
    let totalBorrowCost = 0n;
    const detailedSegments = [];

    for (const segment of segments) {
        const segmentBorrowCost = await calculateSegmentBorrowCost(context, asset, segment, borrowIndexCache);
        totalBorrowCost += segmentBorrowCost;

        // Get borrow indices for this segment (use cache if available)
        let startBorrowIndex: bigint;
        let endBorrowIndex: bigint;

        if (borrowIndexCache) {
            const startKey = `${asset}_${segment.startTime}`;
            const endKey = `${asset}_${segment.endTime}`;
            startBorrowIndex = borrowIndexCache.get(startKey)!;
            endBorrowIndex = borrowIndexCache.get(endKey)!;
        } else {
            [startBorrowIndex, endBorrowIndex] = await Promise.all([
                calculateVariableBorrowIndexAtTimestamp(context, asset, segment.startTime),
                calculateVariableBorrowIndexAtTimestamp(context, asset, segment.endTime)
            ]);
        }

        const actualBorrowBalance = calculateActualBalance(segment.scaledBorrowBalance, startBorrowIndex);
        const durationDays = (Number(segment.endTime) - Number(segment.startTime)) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: Number(segment.startTime),
            endTime: Number(segment.endTime),
            startDate: new Date(Number(segment.startTime) * 1000).toISOString(),
            endDate: new Date(Number(segment.endTime) * 1000).toISOString(),
            scaledBorrowBalance: segment.scaledBorrowBalance,
            actualBorrowBalance,
            startBorrowIndex,
            endBorrowIndex,
            segmentBorrowCost,
            durationDays: Math.round(durationDays * 100) / 100
        });
    }

    return {
        totalBorrowCost,
        segments: detailedSegments
    };
}

