/**
 * Isolated Pair Yield Calculations
 * 
 * Core yield calculation logic using segment-based approach.
 * Calculates yield by tracking how shares grow in value as exchange rates increase.
 */

import {
    getIsolatedPairAssetShares,
    getIsolatedPairBorrowShares,
    getIsolatedPairCollateralBalance,
    convertSharesToAssets
} from "./balanceQueries";
import { calculateIsolatedPairExchangeRateAtTimestamp } from "./exchangeRate";
import { getUserPairEvents } from "./eventQueries";
import { getUserIsolatedPairs } from "./pairTracking";
import { EXCHANGE_PRECISION } from "./constants";
import { ExchangeRateCache } from "./exchangeRateCache";
import { IsolatedPairBalanceCache } from "./balanceCache";
import { DepositIsolated, WithdrawIsolated, BorrowAssetIsolated, RepayAssetIsolated } from "ponder:schema";
import { eq, and, gte, lte } from "ponder";

/**
 * Yield data for a single isolated pair over a time period
 */
export interface IsolatedPairYield {
    pair: string;
    assetYield: bigint;
    borrowCost: bigint;
    netYield: bigint;
    startAssetShares: bigint;
    endAssetShares: bigint;
    startBorrowShares: bigint;
    endBorrowShares: bigint;
    startExchangeRate: bigint;
    endExchangeRate: bigint;
    startCollateralBalance: bigint;
    endCollateralBalance: bigint;
    startAssetValue: bigint;
    endAssetValue: bigint;
    startBorrowValue: bigint;
    endBorrowValue: bigint;
}

/**
 * Calculate yield for an isolated pair over a time period
 *
 * For isolated pairs, yield comes from:
 * 1. Asset shares: yield = shares × (endExchangeRate - startExchangeRate) [POSITIVE = earnings]
 * 2. Borrow shares: cost = shares × (endExchangeRate - startExchangeRate) [POSITIVE = cost/interest owed]
 * 3. Collateral: no yield (it's just collateral, not earning)
 *
 * Net yield = assetYield - borrowYield (earnings minus costs)
 *
 * This function uses a segment-based approach to handle changing positions accurately:
 * - Divides the time period into segments between events
 * - Calculates yield for each segment using the shares held during that segment
 * - Sums up all segment yields to get total yield
 *
 * This ensures accurate yield calculation even when the user deposits/withdraws/borrows/repays
 * during the period.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @param exchangeRateCache - Optional cache for exchange rates (improves performance)
 * @param balanceCache - Optional cache for balances (improves performance)
 * @returns Yield data including asset yield, borrow cost, and net yield
 *
 * @example
 * ```typescript
 * const exchangeRateCache = new ExchangeRateCache();
 * const balanceCache = new IsolatedPairBalanceCache();
 * const yield = await calculateIsolatedPairYield(
 *   context, "0x123...", "0xPair...", 1000, 2000,
 *   exchangeRateCache, balanceCache
 * );
 * // Returns: {
 * //   pair: "0xPair...",
 * //   assetYield: 50000000000000000n,    // 50 tokens earned
 * //   borrowCost: 15000000000000000n,    // 15 tokens interest cost
 * //   netYield: 35000000000000000n,      // 35 tokens net profit
 * //   startAssetShares: 1000n,
 * //   endAssetShares: 1200n,
 * //   ...
 * // }
 * ```
 *
 * @note
 * This function also returns collateral balances and asset/borrow values for
 * portfolio/exposure calculations, but collateral is NOT included in yield calculations.
 */
export async function calculateIsolatedPairYield(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number,
    exchangeRateCache?: ExchangeRateCache,
    balanceCache?: IsolatedPairBalanceCache
): Promise<IsolatedPairYield> {
    // Create default caches if not provided (backward compatible)
    const rateCache = exchangeRateCache || new ExchangeRateCache();
    const balCache = balanceCache || new IsolatedPairBalanceCache();

    // Get initial shares, collateral, and exchange rate at start of period
    // Use caches to avoid redundant queries
    const [startAssetShares, startBorrowShares, startCollateralBalance, startExchangeRate] = await Promise.all([
        balCache.getAssetShares(context, user, pair, startTimestamp),
        balCache.getBorrowShares(context, user, pair, startTimestamp),
        balCache.getCollateral(context, user, pair, startTimestamp),
        rateCache.get(context, pair, startTimestamp)
    ]);

    // Get all events during the period
    const events = await getUserPairEvents(context, user, pair, startTimestamp, endTimestamp);

    // Initialize tracking variables
    let currentAssetShares = startAssetShares;
    let currentBorrowShares = startBorrowShares;
    let currentExchangeRate = startExchangeRate;
    let currentTimestamp = startTimestamp;

    let totalAssetYield = 0n;
    let totalBorrowYield = 0n;

    // Process each event and calculate yield for the segment before it
    for (const event of events) {
        // Calculate exchange rate change since last event
        const exchangeRateChange = event.exchangeRate - currentExchangeRate;

        if (exchangeRateChange !== 0n) {
            // Calculate yield for this segment (from last event to this event)
            // Asset yield (positive - earning interest)
            if (currentAssetShares > 0n) {
                const segmentAssetYield = (currentAssetShares * exchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
                totalAssetYield += segmentAssetYield;
            }

            // Borrow yield (cost - positive value represents interest owed)
            if (currentBorrowShares > 0n) {
                const segmentBorrowYield = (currentBorrowShares * exchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
                totalBorrowYield += segmentBorrowYield;
            }
        }

        // Update shares based on this event
        currentAssetShares += event.assetSharesDelta;
        currentBorrowShares += event.borrowSharesDelta;
        currentExchangeRate = event.exchangeRate;
        currentTimestamp = event.timestamp;
    }

    // Calculate yield for the final segment (from last event to end of period)
    // Use cache to get accurate rate even if no event at exact timestamp
    const endExchangeRate = await rateCache.get(context, pair, endTimestamp);
    const finalExchangeRateChange = endExchangeRate - currentExchangeRate;

    if (finalExchangeRateChange !== 0n) {
        // Asset yield for final segment
        if (currentAssetShares > 0n) {
            const finalAssetYield = (currentAssetShares * finalExchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
            totalAssetYield += finalAssetYield;
        }

        // Borrow yield for final segment (cost - positive value represents interest owed)
        if (currentBorrowShares > 0n) {
            const finalBorrowYield = (currentBorrowShares * finalExchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
            totalBorrowYield += finalBorrowYield;
        }
    }

    // Get final shares and collateral for return value
    const endAssetShares = currentAssetShares;
    const endBorrowShares = currentBorrowShares;
    const endCollateralBalance = await balCache.getCollateral(context, user, pair, endTimestamp);

    // Calculate asset and borrow values at start and end
    const startAssetValue = convertSharesToAssets(startAssetShares, startExchangeRate);
    const endAssetValue = convertSharesToAssets(endAssetShares, endExchangeRate);
    const startBorrowValue = convertSharesToAssets(startBorrowShares, startExchangeRate);
    const endBorrowValue = convertSharesToAssets(endBorrowShares, endExchangeRate);

    // Net yield = asset yield - borrow cost
    // totalAssetYield is positive (earnings from deposits)
    // totalBorrowYield is positive (cost of borrowing)
    // Net yield = earnings - costs
    const netYield = totalAssetYield - totalBorrowYield;

    return {
        pair,
        assetYield: totalAssetYield,
        borrowCost: totalBorrowYield,
        netYield,
        startAssetShares,
        endAssetShares,
        startBorrowShares,
        endBorrowShares,
        startExchangeRate,
        endExchangeRate,
        startCollateralBalance,
        endCollateralBalance,
        startAssetValue,
        endAssetValue,
        startBorrowValue,
        endBorrowValue
    };
}

/**
 * Calculate yields for all isolated pairs for a user during a custom period
 *
 * This is used by the custom-period-yield API to show yields with collateral breakdown.
 * It finds all pairs the user has interacted with and calculates yield for each.
 *
 * Pairs with no activity (no shares, no yield) are filtered out.
 *
 * **Performance:** Uses caching to avoid redundant queries when calculating multiple pairs.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @param exchangeRateCache - Optional cache for exchange rates (improves performance)
 * @param balanceCache - Optional cache for balances (improves performance)
 * @returns Array of yield data for all active pairs
 *
 * @example
 * ```typescript
 * // Without caching (simple usage)
 * const yields = await calculateAllIsolatedPairYields(context, "0x123...", 1000, 2000);
 *
 * // With caching (recommended for better performance)
 * const exchangeRateCache = new ExchangeRateCache();
 * const balanceCache = new IsolatedPairBalanceCache();
 * const yields = await calculateAllIsolatedPairYields(
 *   context, "0x123...", 1000, 2000,
 *   exchangeRateCache, balanceCache
 * );
 * // Returns: [
 * //   { pair: "0xPair1...", assetYield: 50n, borrowCost: 15n, netYield: 35n, ... },
 * //   { pair: "0xPair2...", assetYield: 30n, borrowCost: 10n, netYield: 20n, ... }
 * // ]
 * ```
 */
export async function calculateAllIsolatedPairYields(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number,
    exchangeRateCache?: ExchangeRateCache,
    balanceCache?: IsolatedPairBalanceCache
): Promise<IsolatedPairYield[]> {
    // Get all pairs user has interacted with during this period
    const pairs = await getUserIsolatedPairs(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Create caches if not provided
    const rateCache = exchangeRateCache || new ExchangeRateCache();
    const balCache = balanceCache || new IsolatedPairBalanceCache();

    // Prefetch exchange rates for all pairs at start and end timestamps
    // This dramatically improves performance by executing queries in parallel
    const prefetchList = pairs.flatMap(pair => [
        { pair, timestamp: startTimestamp },
        { pair, timestamp: endTimestamp }
    ]);
    await rateCache.prefetch(context, prefetchList);

    // Prefetch balances for all pairs at start and end timestamps
    await balCache.prefetchAll(context, user, pairs, [startTimestamp, endTimestamp]);

    // Calculate yield for each pair in parallel (using cached data)
    const yields = await Promise.all(
        pairs.map(pair => calculateIsolatedPairYield(
            context, user, pair, startTimestamp, endTimestamp,
            rateCache, balCache
        ))
    );

    // Filter out pairs with no activity (no shares at start or end, no yield)
    return yields.filter(y =>
        y.startAssetShares > 0n ||
        y.endAssetShares > 0n ||
        y.startBorrowShares > 0n ||
        y.endBorrowShares > 0n ||
        y.startCollateralBalance > 0n ||
        y.endCollateralBalance > 0n ||
        y.netYield !== 0n
    );
}

/**
 * Calculate segmented yield for an isolated pair with detailed breakdown
 * Similar to calculateSegmentedCustomPeriodYield but for isolated pairs using exchange rates
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @param exchangeRateCache - Optional cache to avoid redundant exchange rate queries
 */
export async function calculateSegmentedIsolatedPairYield(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number,
    exchangeRateCache?: ExchangeRateCache
): Promise<{
    totalYield: bigint;
    segments: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        assetShares: bigint;
        actualAssetAmount: bigint;
        startExchangeRate: bigint;
        endExchangeRate: bigint;
        segmentYield: bigint;
        durationDays: number;
    }>;
}> {
    // Get all deposit and withdraw events during the period, ordered chronologically
    const dbQuery = context.db.sql || context.db;

    const [depositEvents, withdrawEvents] = await Promise.all([
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.owner, user as `0x${string}`),
                eq(DepositIsolated.pair, pair as `0x${string}`),
                gte(DepositIsolated.timestamp, startTimestamp),
                lte(DepositIsolated.timestamp, endTimestamp)
            )
        ).orderBy(DepositIsolated.timestamp),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.owner, user as `0x${string}`),
                eq(WithdrawIsolated.pair, pair as `0x${string}`),
                gte(WithdrawIsolated.timestamp, startTimestamp),
                lte(WithdrawIsolated.timestamp, endTimestamp)
            )
        ).orderBy(WithdrawIsolated.timestamp)
    ]);

    // Combine and sort events with validation
    const allEvents = [
        ...depositEvents.map((e: any) => {
            if (e.shares === undefined || e.shares === null) {
                console.error(`DepositIsolated event has undefined shares:`, e);
                throw new Error(`Invalid DepositIsolated event: shares is ${e.shares}`);
            }
            return { ...e, eventType: 'deposit' as const, sharesDelta: e.shares };
        }),
        ...withdrawEvents.map((e: any) => {
            if (e.shares === undefined || e.shares === null) {
                console.error(`WithdrawIsolated event has undefined shares:`, e);
                throw new Error(`Invalid WithdrawIsolated event: shares is ${e.shares}`);
            }
            return { ...e, eventType: 'withdraw' as const, sharesDelta: 0n - e.shares };
        })
    ].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    // Get starting asset shares
    const startAssetShares = await getIsolatedPairAssetShares(context, user, pair, startTimestamp);

    // Create time segments
    const segments = [];
    let currentShares = startAssetShares;
    let previousTime = startTimestamp;

    // If no events during period, create single segment
    if (allEvents.length === 0) {
        if (startAssetShares > 0n) {
            segments.push({
                startTime: startTimestamp,
                endTime: endTimestamp,
                assetShares: startAssetShares
            });
        }
    } else {
        // Create segments between events
        for (const event of allEvents) {
            // Ensure timestamp is a number (not BigInt)
            const eventTimestamp = Number(event.timestamp);

            // Add segment before this event (if there's time and shares)
            if (eventTimestamp > previousTime && currentShares > 0n) {
                segments.push({
                    startTime: previousTime,
                    endTime: eventTimestamp,
                    assetShares: currentShares
                });
            }

            // Update shares based on event
            currentShares += event.sharesDelta;
            previousTime = eventTimestamp;
        }

        // Add final segment from last event to end of period
        if (previousTime < endTimestamp && currentShares > 0n) {
            segments.push({
                startTime: previousTime,
                endTime: endTimestamp,
                assetShares: currentShares
            });
        }
    }

    // Create cache if not provided
    const rateCache = exchangeRateCache || new ExchangeRateCache();

    // Prefetch all exchange rates for segments
    const prefetchList = segments.flatMap(seg => [
        { pair, timestamp: seg.startTime },
        { pair, timestamp: seg.endTime }
    ]);
    await rateCache.prefetch(context, prefetchList);

    // Calculate yield for each segment and collect detailed information
    let totalYield = 0n;
    const detailedSegments = [];

    for (const segment of segments) {
        // Get exchange rates at start and end of segment (use cache)
        const [startExchangeRate, endExchangeRate] = await Promise.all([
            rateCache.get(context, pair, segment.startTime),
            rateCache.get(context, pair, segment.endTime)
        ]);

        // Calculate yield for this segment
        // yield = shares × (endRate - startRate) / EXCHANGE_PRECISION
        const exchangeRateChange = endExchangeRate - startExchangeRate;
        const segmentYield = (segment.assetShares * exchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
        totalYield += segmentYield;

        // Use endExchangeRate to show actual asset value at end of segment (including yield earned)
        const actualAssetAmount = convertSharesToAssets(segment.assetShares, endExchangeRate);
        const durationDays = (Number(segment.endTime) - Number(segment.startTime)) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: Number(segment.startTime),
            endTime: Number(segment.endTime),
            startDate: new Date(Number(segment.startTime) * 1000).toISOString(),
            endDate: new Date(Number(segment.endTime) * 1000).toISOString(),
            assetShares: segment.assetShares,
            actualAssetAmount,
            startExchangeRate,
            endExchangeRate,
            segmentYield,
            durationDays: Math.round(durationDays * 100) / 100
        });
    }

    return {
        totalYield,
        segments: detailedSegments
    };
}

/**
 * Calculate segmented borrow cost for an isolated pair with detailed breakdown
 * Similar to calculateSegmentedCustomPeriodBorrowCost but for isolated pairs using exchange rates
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @param exchangeRateCache - Optional cache to avoid redundant exchange rate queries
 */
export async function calculateSegmentedIsolatedPairBorrowCost(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number,
    exchangeRateCache?: ExchangeRateCache
): Promise<{
    totalBorrowCost: bigint;
    segments: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        borrowShares: bigint;
        actualBorrowAmount: bigint;
        startExchangeRate: bigint;
        endExchangeRate: bigint;
        segmentBorrowCost: bigint;
        durationDays: number;
    }>;
}> {
    // Get all borrow and repay events during the period, ordered chronologically
    const dbQuery = context.db.sql || context.db;

    const [borrowEvents, repayEvents] = await Promise.all([
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                gte(BorrowAssetIsolated.timestamp, startTimestamp),
                lte(BorrowAssetIsolated.timestamp, endTimestamp)
            )
        ).orderBy(BorrowAssetIsolated.timestamp),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                gte(RepayAssetIsolated.timestamp, startTimestamp),
                lte(RepayAssetIsolated.timestamp, endTimestamp)
            )
        ).orderBy(RepayAssetIsolated.timestamp)
    ]);

    // Combine and sort events with validation
    const allEvents = [
        ...borrowEvents.map((e: any) => {
            if (e.sharesAdded === undefined || e.sharesAdded === null) {
                console.error(`BorrowAssetIsolated event has undefined sharesAdded:`, e);
                throw new Error(`Invalid BorrowAssetIsolated event: sharesAdded is ${e.sharesAdded}`);
            }
            return { ...e, eventType: 'borrow' as const, sharesDelta: e.sharesAdded };
        }),
        ...repayEvents.map((e: any) => {
            if (e.shares === undefined || e.shares === null) {
                console.error(`RepayAssetIsolated event has undefined shares:`, e);
                throw new Error(`Invalid RepayAssetIsolated event: shares is ${e.shares}`);
            }
            return { ...e, eventType: 'repay' as const, sharesDelta: 0n - e.shares };
        })
    ].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    // Get starting borrow shares
    const startBorrowShares = await getIsolatedPairBorrowShares(context, user, pair, startTimestamp);

    // Create time segments
    const segments = [];
    let currentShares = startBorrowShares;
    let previousTime = startTimestamp;

    // If no events during period, create single segment
    if (allEvents.length === 0) {
        if (startBorrowShares > 0n) {
            segments.push({
                startTime: startTimestamp,
                endTime: endTimestamp,
                borrowShares: startBorrowShares
            });
        }
    } else {
        // Create segments between events
        for (const event of allEvents) {
            // Ensure timestamp is a number (not BigInt)
            const eventTimestamp = Number(event.timestamp);

            // Add segment before this event (if there's time and shares)
            if (eventTimestamp > previousTime && currentShares > 0n) {
                segments.push({
                    startTime: previousTime,
                    endTime: eventTimestamp,
                    borrowShares: currentShares
                });
            }

            // Update shares based on event
            currentShares += event.sharesDelta;
            previousTime = eventTimestamp;
        }

        // Add final segment from last event to end of period
        if (previousTime < endTimestamp && currentShares > 0n) {
            segments.push({
                startTime: previousTime,
                endTime: endTimestamp,
                borrowShares: currentShares
            });
        }
    }

    // Create cache if not provided
    const rateCache = exchangeRateCache || new ExchangeRateCache();

    // Prefetch all exchange rates for segments
    const prefetchList = segments.flatMap(seg => [
        { pair, timestamp: seg.startTime },
        { pair, timestamp: seg.endTime }
    ]);
    await rateCache.prefetch(context, prefetchList);

    // Calculate borrow cost for each segment and collect detailed information
    let totalBorrowCost = 0n;
    const detailedSegments = [];

    for (const segment of segments) {
        // Get exchange rates at start and end of segment (use cache)
        const [startExchangeRate, endExchangeRate] = await Promise.all([
            rateCache.get(context, pair, segment.startTime),
            rateCache.get(context, pair, segment.endTime)
        ]);

        // Calculate borrow cost for this segment
        // cost = shares × (endRate - startRate) / EXCHANGE_PRECISION
        const exchangeRateChange = endExchangeRate - startExchangeRate;
        const segmentBorrowCost = (segment.borrowShares * exchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
        totalBorrowCost += segmentBorrowCost;

        // Use endExchangeRate to show actual borrow value at end of segment (including interest accrued)
        const actualBorrowAmount = convertSharesToAssets(segment.borrowShares, endExchangeRate);
        const durationDays = (Number(segment.endTime) - Number(segment.startTime)) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: Number(segment.startTime),
            endTime: Number(segment.endTime),
            startDate: new Date(Number(segment.startTime) * 1000).toISOString(),
            endDate: new Date(Number(segment.endTime) * 1000).toISOString(),
            borrowShares: segment.borrowShares,
            actualBorrowAmount,
            startExchangeRate,
            endExchangeRate,
            segmentBorrowCost,
            durationDays: Math.round(durationDays * 100) / 100
        });
    }

    return {
        totalBorrowCost,
        segments: detailedSegments
    };
}

