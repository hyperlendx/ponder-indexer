import { UserBalanceEvent, Borrow, Repay, LiquidationCall } from "ponder:schema";
import { eq, and, gte, lte, desc } from "ponder";
import { calculateLiquidityIndexAtTimestamp, calculateActualBalance } from "../aave";
import { getScaledBalanceAtTimestamp, getScaledBorrowBalanceAtTimestamp } from "./balanceQueries";
import { LiquidityIndexCache } from "./liquidityIndexCache";
import { calculateVariableBorrowIndexAtTimestamp } from "../aave/borrowIndex";
import { calculateUSDValueNumber } from "../usdCalculations";

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
 * Custom period yield calculation that handles intra-period positions
 * Adapts the monthly segmented calculation for arbitrary date ranges
 *
 * @param indexCache - Optional cache to avoid redundant liquidity index queries
 * @param decimals - Token decimals for USD calculation
 */
export async function calculateSegmentedCustomPeriodYield(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    decimals: number,
    indexCache?: LiquidityIndexCache
): Promise<{
    totalYield: bigint;
    totalYieldUSD: string;
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
        segmentYieldUSD: string;
        durationDays: number;
    }>;
}> {
    // Get all balance events during the period, ordered chronologically
    const dbQuery = context.db.sql || context.db;
    const [periodEvents, liquidationEvents] = await Promise.all([
        dbQuery
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
            .orderBy(UserBalanceEvent.timestamp),
        // Get liquidations where this asset was the collateral
        dbQuery
            .select()
            .from(LiquidationCall)
            .where(
                and(
                    eq(LiquidationCall.user, user as `0x${string}`),
                    eq(LiquidationCall.collateralAsset, asset as `0x${string}`),
                    gte(LiquidationCall.timestamp, startTimestamp),
                    lte(LiquidationCall.timestamp, endTimestamp)
                )
            )
            .orderBy(LiquidationCall.timestamp)
    ]);

    // Combine balance events and liquidation events, treating liquidations as balance-changing events
    // For liquidations, we need to create synthetic events with the new scaled balance after liquidation
    const allEvents = [...periodEvents];

    // Add liquidation events as synthetic balance events
    for (const liquidation of liquidationEvents) {
        // Get the scaled balance at the liquidation timestamp (after accounting for the liquidation)
        const scaledBalanceAfterLiquidation = await getScaledBalanceAtTimestamp(
            context,
            user,
            asset,
            Number(liquidation.timestamp)
        );

        allEvents.push({
            timestamp: liquidation.timestamp,
            scaledBalance: scaledBalanceAfterLiquidation,
            eventType: 'liquidation',
            txHash: liquidation.txHash
        } as any);
    }

    // Sort all events by timestamp
    allEvents.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    // Create time segments for interest calculation
    const segments = await createTimeSegments(context, user, asset, startTimestamp, endTimestamp, allEvents);

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

    // Get the most recent price from UserBalanceEvent for USD calculations
    // This avoids needing to make a blockchain call to the oracle
    const recentEvent = await dbQuery
        .select()
        .from(UserBalanceEvent)
        .where(
            and(
                eq(UserBalanceEvent.user, user as `0x${string}`),
                eq(UserBalanceEvent.asset, asset as `0x${string}`),
                lte(UserBalanceEvent.timestamp, endTimestamp)
            )
        )
        .orderBy(desc(UserBalanceEvent.timestamp))
        .limit(1);

    // Use the most recent price, or 0 if no events found
    const currentPrice = recentEvent.length > 0 ? recentEvent[0].assetPrice : 0n;

    // Calculate interest for each segment and collect detailed information
    let totalInterest = 0n;
    let totalInterestUSD = 0;
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

        // Calculate USD value for this segment's yield using current price
        const segmentYieldUSD = calculateUSDValueNumber(segmentInterest, currentPrice, decimals);
        totalInterestUSD += segmentYieldUSD;

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
            segmentYieldUSD: segmentYieldUSD.toFixed(4),
            durationDays: Math.round(durationDays * 100) / 100 // Round to 2 decimal places
        });
    }

    return {
        totalYield: totalInterest,
        totalYieldUSD: totalInterestUSD.toFixed(4),
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
 * @param decimals - Token decimals for USD calculation
 * @param borrowIndexCache - Optional cache to avoid redundant borrow index queries
 */
export async function calculateSegmentedCustomPeriodBorrowCost(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    decimals: number,
    borrowIndexCache?: Map<string, bigint>
): Promise<{
    totalBorrowCost: bigint;
    totalBorrowCostUSD: string;
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
        segmentBorrowCostUSD: string;
        durationDays: number;
    }>;
}> {
    // Get all borrow and repay events during the period, ordered chronologically
    const dbQuery = context.db.sql || context.db;

    const [borrowEvents, repayEvents, liquidationEvents] = await Promise.all([
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
        ).orderBy(Repay.timestamp),
        // Get liquidations where this asset was the debt asset
        dbQuery.select().from(LiquidationCall).where(
            and(
                eq(LiquidationCall.user, user as `0x${string}`),
                eq(LiquidationCall.debtAsset, asset as `0x${string}`),
                gte(LiquidationCall.timestamp, startTimestamp),
                lte(LiquidationCall.timestamp, endTimestamp)
            )
        ).orderBy(LiquidationCall.timestamp)
    ]);

    // Combine and sort events
    // Treat liquidations as repay events (forced repayment)
    const allEvents = [
        ...borrowEvents.map((e: any) => ({ ...e, eventType: 'borrow' as const })),
        ...repayEvents.map((e: any) => ({ ...e, eventType: 'repay' as const })),
        ...liquidationEvents.map((e: any) => ({
            ...e,
            eventType: 'repay' as const,
            amount: e.debtToCover  // Use debtToCover as the repay amount
        }))
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

    // Get the most recent price from Borrow/Repay events for USD calculations
    // This avoids needing to make a blockchain call to the oracle
    // Try to get price from recent Borrow events first
    const recentBorrow = await dbQuery
        .select()
        .from(Borrow)
        .where(
            and(
                eq(Borrow.onBehalfOf, user as `0x${string}`),
                eq(Borrow.reserve, asset as `0x${string}`),
                lte(Borrow.timestamp, endTimestamp)
            )
        )
        .orderBy(desc(Borrow.timestamp))
        .limit(1);

    let currentPrice = 0n;
    if (recentBorrow.length > 0) {
        currentPrice = recentBorrow[0].price;
    } else {
        // If no borrow events, try Repay events
        const recentRepay = await dbQuery
            .select()
            .from(Repay)
            .where(
                and(
                    eq(Repay.user, user as `0x${string}`),
                    eq(Repay.reserve, asset as `0x${string}`),
                    lte(Repay.timestamp, endTimestamp)
                )
            )
            .orderBy(desc(Repay.timestamp))
            .limit(1);

        if (recentRepay.length > 0) {
            currentPrice = recentRepay[0].price;
        }
    }

    // Calculate borrow cost for each segment and collect detailed information
    let totalBorrowCost = 0n;
    let totalBorrowCostUSD = 0;
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

        // Calculate USD value for this segment's borrow cost using current price
        const segmentBorrowCostUSD = calculateUSDValueNumber(segmentBorrowCost, currentPrice, decimals);
        totalBorrowCostUSD += segmentBorrowCostUSD;

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
            segmentBorrowCostUSD: segmentBorrowCostUSD.toFixed(4),
            durationDays: Math.round(durationDays * 100) / 100
        });
    }

    return {
        totalBorrowCost,
        totalBorrowCostUSD: totalBorrowCostUSD.toFixed(4),
        segments: detailedSegments
    };
}

