import { UserBalanceEvent } from "ponder:schema";
import { eq, and, gte, lte } from "ponder";
import {
    getMonthTimestamps,
    calculateLiquidityIndexAtTimestamp,
    calculateActualBalance
} from "../aave";
import { calculateNetDeposits } from "../userPositionManager";
import {
    getScaledBalanceAtTimestamp,
    getUserAssetsForMonth,
    getUserAssetsForPeriod,
    getMaxBalanceDuringMonth,
    getMaxBalanceDuringPeriod,
    getBorrowedBalanceAtTimestamp,
    getScaledBorrowBalanceAtTimestamp,
    getUserBorrowedAssets
} from "./balanceQueries";
import {
    calculateSegmentedMonthlyYield,
    calculateSegmentedCustomPeriodYield
} from "./yieldCalculations";
import { LiquidityIndexCache } from "./liquidityIndexCache";
import { BorrowIndexCache } from "./borrowIndexCache";
import { getCachedMonthlyYield, cacheMonthlyYield, isCompletedMonth } from "./monthlyAggregationCache";

/**
 * Calculate monthly yield data for a specific user and month
 * Returns yield data for all assets the user had positions in during that month
 */
export async function calculateUserMonthlyYield(
    context: any,
    user: string,
    year: number,
    month: number
): Promise<Array<{
    user: string;
    asset: string;
    year: number;
    month: number;
    monthlyYield: bigint;
    startScaledBalance: bigint;
    endScaledBalance: bigint;
    startActualBalance: bigint;
    endActualBalance: bigint;
    startLiquidityIndex: bigint;
    endLiquidityIndex: bigint;
    netDeposits: bigint;
    startTimestamp: number;
    endTimestamp: number;
    hadPositionDuringMonth: boolean;
    maxBalanceDuringMonth: bigint;
    transactionCount: number;
    segments?: Array<{
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
}>> {
    try {
        // Get month boundaries
        const { startTimestamp, endTimestamp } = getMonthTimestamps(year, month);

        // Get all assets user had positions in during this month
        const assets = await getUserAssetsForMonth(context, user, startTimestamp, endTimestamp);

        if (assets.length === 0) {
            return [];
        }

        // Check if this is a completed month (eligible for caching)
        const shouldCache = isCompletedMonth(year, month);

        // Initialize liquidity index cache for this request
        const indexCache = new LiquidityIndexCache();

        // Batch fetch all monthly events for all assets in ONE query
        const dbQuery = context.db.sql || context.db;
        const allMonthlyEvents = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            );

        // Group events by asset
        const eventsByAsset = new Map<string, any[]>();
        for (const event of allMonthlyEvents) {
            if (!eventsByAsset.has(event.asset)) {
                eventsByAsset.set(event.asset, []);
            }
            eventsByAsset.get(event.asset)!.push(event);
        }

        // Prefetch all liquidity indices we'll need
        const indexPrefetchList = [];
        for (const asset of assets) {
            indexPrefetchList.push(
                { asset, timestamp: startTimestamp },
                { asset, timestamp: endTimestamp }
            );
        }
        await indexCache.prefetch(context, indexPrefetchList);

        // Process all assets in parallel
        const assetPromises = assets.map(async (asset) => {
            try {
                // Check cache first for completed months
                if (shouldCache) {
                    const cached = await getCachedMonthlyYield(context, user, asset, year, month);
                    if (cached) {
                        // Recalculate actual balances from cached indices
                        cached.startActualBalance = calculateActualBalance(
                            cached.startScaledBalance,
                            cached.startLiquidityIndex
                        );
                        cached.endActualBalance = calculateActualBalance(
                            cached.endScaledBalance,
                            cached.endLiquidityIndex
                        );
                        cached.startTimestamp = startTimestamp;
                        cached.endTimestamp = endTimestamp;
                        return cached;
                    }
                }

                // Get scaled balances at month boundaries
                const [startScaledBalance, endScaledBalance] = await Promise.all([
                    getScaledBalanceAtTimestamp(context, user, asset, startTimestamp),
                    getScaledBalanceAtTimestamp(context, user, asset, endTimestamp)
                ]);

                // Get liquidity indices from cache (already prefetched)
                const [startLiquidityIndex, endLiquidityIndex] = await Promise.all([
                    indexCache.get(context, asset, startTimestamp),
                    indexCache.get(context, asset, endTimestamp)
                ]);

                // Calculate actual balances
                const startActualBalance = calculateActualBalance(startScaledBalance, startLiquidityIndex);
                const endActualBalance = calculateActualBalance(endScaledBalance, endLiquidityIndex);

                // Get monthly events for this asset from pre-fetched data
                const monthlyEvents = eventsByAsset.get(asset) || [];

                // Calculate net deposits and max balance in parallel
                const [netDeposits, maxBalanceDuringMonth] = await Promise.all([
                    calculateNetDeposits(context, user, asset, startTimestamp, endTimestamp),
                    getMaxBalanceDuringMonth(context, user, asset, startTimestamp, endTimestamp)
                ]);

                // Enhanced calculation: Handle intra-month positions
                const segmentedResult = await calculateSegmentedMonthlyYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestamp,
                    indexCache // Pass cache to avoid redundant queries
                );

                const monthlyYield = segmentedResult.totalYield;
                const segments = segmentedResult.segments;

                // Calculate additional metrics
                const hadPositionDuringMonth = monthlyEvents.length > 0 || startScaledBalance > 0n;

                const result = {
                    user,
                    asset,
                    year,
                    month,
                    monthlyYield,
                    startScaledBalance,
                    endScaledBalance,
                    startActualBalance,
                    endActualBalance,
                    startLiquidityIndex,
                    endLiquidityIndex,
                    netDeposits,
                    startTimestamp,
                    endTimestamp,
                    hadPositionDuringMonth,
                    maxBalanceDuringMonth,
                    transactionCount: monthlyEvents.length,
                    segments
                };

                // Cache result for completed months
                if (shouldCache) {
                    await cacheMonthlyYield(context, result);
                }

                return result;

            } catch (error) {
                console.error(`❌ Error calculating yield for asset ${asset}:`, error);
                return null;
            }
        });

        // Wait for all assets to complete
        const results = await Promise.all(assetPromises);

        // Filter out null results (failed calculations)
        return results.filter((r): r is NonNullable<typeof r> => r !== null);

    } catch (error) {
        console.error(`❌ Error calculating monthly yield for user ${user}:`, error);
        return [];
    }
}

/**
 * Calculate yield data for a specific user over a custom time period
 * Returns yield data for all assets the user had positions in during that period
 * Uses the same calculation logic as monthly yield but for arbitrary date ranges
 */
export async function calculateUserCustomPeriodYield(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    user: string;
    asset: string;
    periodYield: bigint;
    startScaledBalance: bigint;
    endScaledBalance: bigint;
    startActualBalance: bigint;
    endActualBalance: bigint;
    startLiquidityIndex: bigint;
    endLiquidityIndex: bigint;
    netDeposits: bigint;
    suppliedAmount: bigint;
    borrowedAmount: bigint;
    startTimestamp: number;
    endTimestamp: number;
    hadPositionDuringPeriod: boolean;
    maxBalanceDuringPeriod: bigint;
    transactionCount: number;
    segments?: Array<{
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
}>> {
    try {
        // Get all assets user had positions in during this period
        const assets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);

        if (assets.length === 0) {
            return [];
        }

        // Initialize liquidity index cache and borrow index cache for this request
        const indexCache = new LiquidityIndexCache();
        const borrowIndexCache = new BorrowIndexCache();

        // Batch fetch all period events for all assets in ONE query
        const dbQuery = context.db.sql || context.db;
        const allPeriodEvents = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            );

        // Group events by asset
        const eventsByAsset = new Map<string, any[]>();
        for (const event of allPeriodEvents) {
            if (!eventsByAsset.has(event.asset)) {
                eventsByAsset.set(event.asset, []);
            }
            eventsByAsset.get(event.asset)!.push(event);
        }

        // Prefetch all liquidity indices and borrow indices we'll need
        const indexPrefetchList = [];
        for (const asset of assets) {
            indexPrefetchList.push(
                { asset, timestamp: startTimestamp },
                { asset, timestamp: endTimestamp }
            );
        }
        await Promise.all([
            indexCache.prefetch(context, indexPrefetchList),
            borrowIndexCache.prefetch(context, indexPrefetchList)
        ]);

        // Process all assets in parallel
        const assetPromises = assets.map(async (asset) => {
            try {
                // Get scaled balances at period boundaries in parallel
                const [startScaledBalance, endScaledBalance] = await Promise.all([
                    getScaledBalanceAtTimestamp(context, user, asset, startTimestamp),
                    getScaledBalanceAtTimestamp(context, user, asset, endTimestamp)
                ]);

                // Get liquidity indices from cache (already prefetched)
                const [startLiquidityIndex, endLiquidityIndex] = await Promise.all([
                    indexCache.get(context, asset, startTimestamp),
                    indexCache.get(context, asset, endTimestamp)
                ]);

                // Calculate actual balances
                const startActualBalance = calculateActualBalance(startScaledBalance, startLiquidityIndex);
                const endActualBalance = calculateActualBalance(endScaledBalance, endLiquidityIndex);

                // Get period events for this asset from pre-fetched data
                const periodEvents = eventsByAsset.get(asset) || [];

                // Calculate metrics in parallel
                // Note: For supplied/borrowed amounts, we use the actual balance at the end of the period
                // This includes both existing positions from before the period AND new positions during the period
                const [netDeposits, maxBalanceDuringPeriod] = await Promise.all([
                    calculateNetDeposits(context, user, asset, startTimestamp, endTimestamp),
                    getMaxBalanceDuringPeriod(context, user, asset, startTimestamp, endTimestamp)
                ]);

                // For supplied amount, use the actual balance at the end of the period
                // This represents the total amount supplied (including positions opened before the period)
                const suppliedAmount = endActualBalance;

                // For borrowed amount, use the same pattern as supply side
                const scaledBorrowBalance = await getScaledBorrowBalanceAtTimestamp(context, user, asset, endTimestamp);
                const variableBorrowIndex = await borrowIndexCache.get(context, asset, endTimestamp);
                const borrowedAmount = calculateActualBalance(scaledBorrowBalance, variableBorrowIndex);

                // Enhanced calculation: Handle intra-period positions
                const segmentedResult = await calculateSegmentedCustomPeriodYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestamp,
                    indexCache // Pass cache to avoid redundant queries
                );

                const periodYield = segmentedResult.totalYield;
                const segments = segmentedResult.segments;

                // Calculate additional metrics
                const hadPositionDuringPeriod = periodEvents.length > 0 || startScaledBalance > 0n;

                return {
                    user,
                    asset,
                    periodYield,
                    startScaledBalance,
                    endScaledBalance,
                    startActualBalance,
                    endActualBalance,
                    startLiquidityIndex,
                    endLiquidityIndex,
                    netDeposits,
                    suppliedAmount,
                    borrowedAmount,
                    startTimestamp,
                    endTimestamp,
                    hadPositionDuringPeriod,
                    maxBalanceDuringPeriod,
                    transactionCount: periodEvents.length,
                    segments
                };

            } catch (error) {
                console.error(`❌ Error calculating yield for asset ${asset}:`, error);
                return null;
            }
        });

        // Wait for all assets to complete
        const results = await Promise.all(assetPromises);

        // Filter out null results (failed calculations)
        return results.filter((r): r is NonNullable<typeof r> => r !== null);

    } catch (error) {
        console.error(`❌ Error in calculateUserCustomPeriodYield for user ${user}:`, error);
        throw error;
    }
}

/**
 * Helper: Parse date range into individual months
 * Returns array of {year, month} objects for each month in the range
 */
function getMonthsInRange(fromTimestamp: number, toTimestamp: number): Array<{ year: number; month: number }> {
    const months: Array<{ year: number; month: number }> = [];

    const startDate = new Date(fromTimestamp * 1000);
    const endDate = new Date(toTimestamp * 1000);

    let currentYear = startDate.getUTCFullYear();
    let currentMonth = startDate.getUTCMonth() + 1; // JavaScript months are 0-indexed

    const endYear = endDate.getUTCFullYear();
    const endMonth = endDate.getUTCMonth() + 1;

    // Iterate through all months in the range
    while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
        months.push({ year: currentYear, month: currentMonth });

        // Move to next month
        currentMonth++;
        if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
        }
    }

    return months;
}

/**
 * Helper: Get month name from month number
 */
function getMonthName(year: number, month: number): string {
    const date = new Date(Date.UTC(year, month - 1, 1));
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Calculate monthly yield breakdown for a user over a custom date range
 * Returns yield data aggregated by month for all assets
 *
 * This is optimized for long-term analysis (≥ 1 month periods) and leverages
 * the existing monthly caching system for completed months.
 *
 * **Partial Month Support:** If endTimestamp is not at a month boundary (first day of next month),
 * also calculates current month's yield at endTimestamp and returns it separately.
 */
export async function calculateUserMonthlyYieldBreakdown(
    context: any,
    user: string,
    fromTimestamp: number,
    toTimestamp: number
): Promise<{
    monthlyValues: Array<{
        year: number;
        month: number;
        monthName: string;
        startDate: string;
        endDate: string;
        totalYield: bigint;
        assets: Array<{
            asset: string;
            monthlyYield: bigint;
            netDeposits: bigint;
            hadPositionDuringMonth: boolean;
            maxBalanceDuringMonth: bigint;
        }>;
    }>;
    currentValue?: {
        year: number;
        month: number;
        monthName: string;
        startDate: string;
        endDate: string;
        totalYield: bigint;
        isPartialMonth: boolean;
        daysInPeriod: number;
        assets: Array<{
            asset: string;
            monthlyYield: bigint;
            netDeposits: bigint;
            hadPositionDuringMonth: boolean;
            maxBalanceDuringMonth: bigint;
        }>;
    };
}> {
    try {
        // Check if endTimestamp is at a month boundary
        const endDate = new Date(toTimestamp * 1000);
        const currentMonthStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
        const nextMonthStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1));
        const nextMonthStartTimestamp = Math.floor(nextMonthStart.getTime() / 1000);
        const isPartialMonth = toTimestamp < nextMonthStartTimestamp;

        // Parse date range into individual complete months only
        const endTimestampForMonths = isPartialMonth
            ? Math.floor(currentMonthStart.getTime() / 1000)
            : toTimestamp;
        const months = getMonthsInRange(fromTimestamp, endTimestampForMonths);


        // Calculate yield for each month in parallel
        const monthlyResults = await Promise.all(
            months.map(async ({ year, month }) => {
                try {
                    // Use existing calculateUserMonthlyYield which leverages caching
                    const yieldData = await calculateUserMonthlyYield(context, user, year, month);

                    const { startTimestamp, endTimestamp } = getMonthTimestamps(year, month);

                    // Aggregate yield across all assets for this month
                    const totalYield = yieldData.reduce((sum, asset) => sum + asset.monthlyYield, 0n);

                    return {
                        year,
                        month,
                        monthName: getMonthName(year, month),
                        startDate: new Date(startTimestamp * 1000).toISOString(),
                        endDate: new Date(endTimestamp * 1000).toISOString(),
                        totalYield,
                        assets: yieldData.map(asset => ({
                            asset: asset.asset,
                            monthlyYield: asset.monthlyYield,
                            netDeposits: asset.netDeposits,
                            hadPositionDuringMonth: asset.hadPositionDuringMonth,
                            maxBalanceDuringMonth: asset.maxBalanceDuringMonth
                        }))
                    };
                } catch (error) {
                    console.error(`❌ Error calculating yield for ${year}-${month}:`, error);
                    // Return empty result for this month on error
                    const { startTimestamp, endTimestamp } = getMonthTimestamps(year, month);
                    return {
                        year,
                        month,
                        monthName: getMonthName(year, month),
                        startDate: new Date(startTimestamp * 1000).toISOString(),
                        endDate: new Date(endTimestamp * 1000).toISOString(),
                        totalYield: 0n,
                        assets: []
                    };
                }
            })
        );

        // Calculate current partial month yield if needed
        let currentValue: {
            year: number;
            month: number;
            monthName: string;
            startDate: string;
            endDate: string;
            totalYield: bigint;
            isPartialMonth: boolean;
            daysInPeriod: number;
            assets: Array<{
                asset: string;
                monthlyYield: bigint;
                netDeposits: bigint;
                hadPositionDuringMonth: boolean;
                maxBalanceDuringMonth: bigint;
            }>;
        } | undefined;

        if (isPartialMonth) {
            try {
                const currentMonthStartTimestamp = Math.floor(currentMonthStart.getTime() / 1000);
                const currentYear = endDate.getUTCFullYear();
                const currentMonth = endDate.getUTCMonth() + 1;

                // Calculate yield for current partial month using custom period calculation
                const yieldData = await calculateUserCustomPeriodYield(context, user, currentMonthStartTimestamp, toTimestamp);

                // Aggregate yield across all assets
                const totalYield = yieldData.reduce((sum, asset) => sum + asset.periodYield, 0n);

                // Calculate days in partial month period
                const daysInPeriod = Math.ceil((toTimestamp - currentMonthStartTimestamp) / (24 * 60 * 60));

                currentValue = {
                    year: currentYear,
                    month: currentMonth,
                    monthName: getMonthName(currentYear, currentMonth),
                    startDate: currentMonthStart.toISOString().split('T')[0]!,
                    endDate: endDate.toISOString().split('T')[0]!,
                    totalYield,
                    isPartialMonth: true,
                    daysInPeriod,
                    assets: yieldData.map(asset => ({
                        asset: asset.asset,
                        monthlyYield: asset.periodYield,
                        netDeposits: asset.netDeposits,
                        hadPositionDuringMonth: asset.hadPositionDuringPeriod,
                        maxBalanceDuringMonth: asset.maxBalanceDuringPeriod
                    }))
                };
            } catch (error) {
                console.error(`❌ Error calculating current partial month yield:`, error);
                // Continue without current value on error
                currentValue = undefined;
            }
        }

        return {
            monthlyValues: monthlyResults,
            currentValue
        };

    } catch (error) {
        console.error(`❌ Error in calculateUserMonthlyYieldBreakdown for user ${user}:`, error);
        throw error;
    }
}

/**
 * Calculate monthly portfolio positions for a user over a custom date range
 * Returns comprehensive position data for each asset during each month
 *
 * This is optimized for long-term portfolio tracking (≥ 1 month periods).
 * Uses the same calculation logic as custom-period-positions for consistency.
 *
 * **Partial Month Support:** If endTimestamp is not at a month boundary (first day of next month),
 * also calculates current month's positions at endTimestamp and returns it separately.
 */
export async function calculateUserMonthlyPortfolioValue(
    context: any,
    user: string,
    fromTimestamp: number,
    toTimestamp: number
): Promise<{
    monthlyValues: Array<{
        year: number;
        month: number;
        monthName: string;
        endDate: string;
        endTimestamp: number;
        assets: Array<{
            asset: string;
            totalDeposited: bigint;
            totalWithdrawn: bigint;
            totalBorrowed: bigint;
            totalRepaid: bigint;
            totalYieldEarned: bigint;
            maxSupplyBalance: bigint;
            maxBorrowBalance: bigint;
            currentSupplyBalance: bigint;
            currentBorrowBalance: bigint;
            netDeposits: bigint;
            netBorrows: bigint;
        }>;
    }>;
    currentValue?: {
        year: number;
        month: number;
        monthName: string;
        startDate: string;
        endDate: string;
        endTimestamp: number;
        isPartialMonth: boolean;
        daysInPeriod: number;
        assets: Array<{
            asset: string;
            totalDeposited: bigint;
            totalWithdrawn: bigint;
            totalBorrowed: bigint;
            totalRepaid: bigint;
            totalYieldEarned: bigint;
            maxSupplyBalance: bigint;
            maxBorrowBalance: bigint;
            currentSupplyBalance: bigint;
            currentBorrowBalance: bigint;
            netDeposits: bigint;
            netBorrows: bigint;
        }>;
    };
}> {
    try {
        // Import the position calculation function
        const { calculateUserCustomPeriodPositions } = await import("./positionCalculations");

        // Check if endTimestamp is at a month boundary (first day of next month at midnight UTC)
        const endDate = new Date(toTimestamp * 1000);
        const currentMonthStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
        const nextMonthStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1));
        const nextMonthStartTimestamp = Math.floor(nextMonthStart.getTime() / 1000);
        const isPartialMonth = toTimestamp < nextMonthStartTimestamp;

        // Parse date range into individual complete months only
        const endTimestampForMonths = isPartialMonth
            ? Math.floor(currentMonthStart.getTime() / 1000)
            : toTimestamp;
        const months = getMonthsInRange(fromTimestamp, endTimestampForMonths);

        if (months.length === 0 && !isPartialMonth) {
            return {
                monthlyValues: [],
                currentValue: undefined
            };
        }

        // Calculate positions for each month in parallel
        const monthlyResults = await Promise.all(
            months.map(async ({ year, month }) => {
                try {
                    const { startTimestamp, endTimestamp } = getMonthTimestamps(year, month);

                    // Use the same calculation logic as custom-period-positions
                    const positions = await calculateUserCustomPeriodPositions(
                        context,
                        user,
                        startTimestamp,
                        endTimestamp
                    );

                    return {
                        year,
                        month,
                        monthName: getMonthName(year, month),
                        endDate: new Date(endTimestamp * 1000).toISOString(),
                        endTimestamp,
                        assets: positions.map(pos => ({
                            asset: pos.asset,
                            totalDeposited: pos.totalDeposited,
                            totalWithdrawn: pos.totalWithdrawn,
                            totalBorrowed: pos.totalBorrowed,
                            totalRepaid: pos.totalRepaid,
                            totalYieldEarned: pos.totalYieldEarned,
                            maxSupplyBalance: pos.maxSupplyBalance,
                            maxBorrowBalance: pos.maxBorrowBalance,
                            currentSupplyBalance: pos.currentSupplyBalance,
                            currentBorrowBalance: pos.currentBorrowBalance,
                            netDeposits: pos.netDeposits,
                            netBorrows: pos.netBorrows
                        }))
                    };
                } catch (error) {
                    console.error(`❌ Error calculating positions for ${year}-${month}:`, error);
                    // Return empty result for this month on error
                    const { endTimestamp } = getMonthTimestamps(year, month);
                    return {
                        year,
                        month,
                        monthName: getMonthName(year, month),
                        endDate: new Date(endTimestamp * 1000).toISOString(),
                        endTimestamp,
                        assets: []
                    };
                }
            })
        );

        // Calculate current partial month positions if needed
        let currentValue: {
            year: number;
            month: number;
            monthName: string;
            startDate: string;
            endDate: string;
            endTimestamp: number;
            isPartialMonth: boolean;
            daysInPeriod: number;
            assets: Array<{
                asset: string;
                totalDeposited: bigint;
                totalWithdrawn: bigint;
                totalBorrowed: bigint;
                totalRepaid: bigint;
                totalYieldEarned: bigint;
                maxSupplyBalance: bigint;
                maxBorrowBalance: bigint;
                currentSupplyBalance: bigint;
                currentBorrowBalance: bigint;
                netDeposits: bigint;
                netBorrows: bigint;
            }>;
        } | undefined;

        if (isPartialMonth) {
            try {
                const currentMonthStartTimestamp = Math.floor(currentMonthStart.getTime() / 1000);
                const currentYear = endDate.getUTCFullYear();
                const currentMonth = endDate.getUTCMonth() + 1;

                // Use the same calculation logic as custom-period-positions
                const positions = await calculateUserCustomPeriodPositions(
                    context,
                    user,
                    currentMonthStartTimestamp,
                    toTimestamp
                );

                // Calculate days in partial month period
                const daysInPeriod = Math.ceil((toTimestamp - currentMonthStartTimestamp) / (24 * 60 * 60));

                currentValue = {
                    year: currentYear,
                    month: currentMonth,
                    monthName: getMonthName(currentYear, currentMonth),
                    startDate: currentMonthStart.toISOString().split('T')[0]!,
                    endDate: endDate.toISOString().split('T')[0]!,
                    endTimestamp: toTimestamp,
                    isPartialMonth: true,
                    daysInPeriod,
                    assets: positions.map(pos => ({
                        asset: pos.asset,
                        totalDeposited: pos.totalDeposited,
                        totalWithdrawn: pos.totalWithdrawn,
                        totalBorrowed: pos.totalBorrowed,
                        totalRepaid: pos.totalRepaid,
                        totalYieldEarned: pos.totalYieldEarned,
                        maxSupplyBalance: pos.maxSupplyBalance,
                        maxBorrowBalance: pos.maxBorrowBalance,
                        currentSupplyBalance: pos.currentSupplyBalance,
                        currentBorrowBalance: pos.currentBorrowBalance,
                        netDeposits: pos.netDeposits,
                        netBorrows: pos.netBorrows
                    }))
                };
            } catch (error) {
                console.error(`❌ Error calculating current partial month positions:`, error);
                // Continue without current value on error
                currentValue = undefined;
            }
        }

        return {
            monthlyValues: monthlyResults,
            currentValue
        };

    } catch (error) {
        console.error(`❌ Error in calculateUserMonthlyPortfolioValue for user ${user}:`, error);
        throw error;
    }
}

/**
 * Calculate daily yield breakdown for a specific user over a custom time period
 * Returns yield data broken down by individual days for charting/graphing purposes
 *
 * This function builds upon the existing custom period yield calculation but aggregates
 * the results by day, making it suitable for time-series visualization.
 *
 * Note on precision: Daily yields are calculated with AAVE-compatible rounding at each
 * day boundary. This introduces a small cumulative rounding difference (~0.0002% or 2 ppm)
 * compared to calculating the entire period at once. This is expected behavior and maintains
 * consistency with AAVE's onchain rounding semantics. Each day uses half-open intervals
 * [dayStart, dayEnd) where each day is exactly 86,400 seconds (24 hours).
 */
export async function calculateUserDailyYieldBreakdown(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    date: string;
    timestamp: number;
    dailyYield: bigint;
    assets: Array<{
        asset: string;
        dailyYield: bigint;
        segments: Array<{
            startTime: number;
            endTime: number;
            scaledBalance: string; // String for JSON serialization
            segmentYield: string;  // String for JSON serialization
            durationHours: number;
        }>;
    }>;
}>> {
    try {
        // Get all assets user had positions in during this period
        const assets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);

        if (assets.length === 0) {
            return [];
        }

        // Create daily time buckets
        const dailyResults = new Map<string, {
            date: string;
            timestamp: number;
            dailyYield: bigint;
            assets: Map<string, {
                asset: string;
                dailyYield: bigint;
                segments: Array<{
                    startTime: number;
                    endTime: number;
                    scaledBalance: bigint;
                    segmentYield: bigint;
                    durationHours: number;
                }>;
            }>;
        }>();

        // Initialize daily buckets
        const startDate = new Date(startTimestamp * 1000);

        // Calculate number of days to iterate (add 1 to include both start and end dates)
        const totalDays = Math.ceil((endTimestamp - startTimestamp) / (24 * 60 * 60)) + 1;

        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + dayOffset);

            const dateStr = currentDate.toISOString().split('T')[0]!; // YYYY-MM-DD format
            // Use UTC to ensure consistent day boundaries regardless of server timezone
            const dayStartTimestamp = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) / 1000);

            dailyResults.set(dateStr, {
                date: dateStr,
                timestamp: dayStartTimestamp,
                dailyYield: 0n,
                assets: new Map()
            });
        }

        // Process each asset
        for (const asset of assets) {
            try {

                // Initialize this asset in all days with zero yield (for consistent asset-level breakdown)
                for (const [dateStr, dayData] of dailyResults) {
                    if (!dayData.assets.has(asset)) {
                        dayData.assets.set(asset, {
                            asset,
                            dailyYield: 0n,
                            segments: []
                        });
                    }
                }

                // Get segmented yield data for this asset over the entire period
                const segmentedResult = await calculateSegmentedCustomPeriodYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestamp
                );

                // Process each segment and assign yield to appropriate days
                for (const segment of segmentedResult.segments) {
                    // Process all segments, including zero-yield ones for completeness

                    // Determine which day(s) this segment spans
                    const segmentStartDate = new Date(segment.startTime * 1000);
                    const segmentEndDate = new Date(segment.endTime * 1000);

                    // If segment is within a single day, assign all yield to that day
                    const segmentStartDay = segmentStartDate.toISOString().split('T')[0]!;
                    const segmentEndDay = segmentEndDate.toISOString().split('T')[0]!;

                    if (segmentStartDay === segmentEndDay) {
                        // Segment is within a single day
                        const dayData = dailyResults.get(segmentStartDay);
                        if (dayData) {
                            dayData.dailyYield += segment.segmentYield;

                            if (!dayData.assets.has(asset)) {
                                dayData.assets.set(asset, {
                                    asset,
                                    dailyYield: 0n,
                                    segments: []
                                });
                            }

                            const assetData = dayData.assets.get(asset)!;
                            assetData.dailyYield += segment.segmentYield;
                            assetData.segments.push({
                                startTime: segment.startTime,
                                endTime: segment.endTime,
                                scaledBalance: segment.scaledBalance,
                                segmentYield: segment.segmentYield,
                                durationHours: segment.durationDays * 24
                            });
                        }
                    } else {
                        // Segment spans multiple days - calculate accurate yield for each day
                        // by computing liquidity index at day boundaries

                        // OPTIMIZATION: Collect all unique timestamps first, then batch calculate indices
                        const timestampsNeeded = new Set<number>();
                        const segmentDays = Math.ceil((segmentEndDate.getTime() - segmentStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

                        // First pass: collect all timestamps we need
                        const dayOverlaps: Array<{dateStr: string, overlapStart: number, overlapEnd: number}> = [];
                        for (let dayOffset = 0; dayOffset < segmentDays; dayOffset++) {
                            const currentDate = new Date(segmentStartDate);
                            currentDate.setDate(segmentStartDate.getDate() + dayOffset);
                            const currentDateStr = currentDate.toISOString().split('T')[0]!;
                            const dayData = dailyResults.get(currentDateStr);
                            if (!dayData) continue;

                            const dayStart = Math.floor(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime() / 1000);
                            // Use full 86,400-second days with half-open interval [dayStart, dayEnd)
                            // This ensures each day is exactly 24 hours (86,400 seconds)
                            const dayEnd = dayStart + 24 * 60 * 60;
                            const overlapStart = Math.max(segment.startTime, dayStart);
                            const overlapEnd = Math.min(segment.endTime, dayEnd);

                            if (overlapEnd > overlapStart) {
                                timestampsNeeded.add(overlapStart);
                                timestampsNeeded.add(overlapEnd);
                                dayOverlaps.push({dateStr: currentDateStr, overlapStart, overlapEnd});
                            }
                        }

                        // Batch calculate all liquidity indices at once
                        const indexCache = new Map<number, bigint>();

                        for (const timestamp of timestampsNeeded) {
                            const index = await calculateLiquidityIndexAtTimestamp(context, asset, timestamp);
                            indexCache.set(timestamp, index);
                        }

                        // Second pass: use cached indices to calculate yields
                        for (const {dateStr, overlapStart, overlapEnd} of dayOverlaps) {
                            const dayData = dailyResults.get(dateStr)!;
                            const startIndex = indexCache.get(overlapStart)!;
                            const endIndex = indexCache.get(overlapEnd)!;

                            // Calculate actual yield for this specific time period
                            const startBalance = calculateActualBalance(segment.scaledBalance, startIndex);
                            const endBalance = calculateActualBalance(segment.scaledBalance, endIndex);
                            const actualYield = endBalance - startBalance;

                            dayData.dailyYield += actualYield;

                            if (!dayData.assets.has(asset)) {
                                dayData.assets.set(asset, {
                                    asset,
                                    dailyYield: 0n,
                                    segments: []
                                });
                            }

                            const assetData = dayData.assets.get(asset)!;
                            assetData.dailyYield += actualYield;
                            assetData.segments.push({
                                startTime: overlapStart,
                                endTime: overlapEnd,
                                scaledBalance: segment.scaledBalance,
                                segmentYield: actualYield,
                                durationHours: (overlapEnd - overlapStart) / 3600
                            });
                        }
                    }
                }

            } catch (error) {
                console.error(`❌ Error processing asset ${asset} for daily breakdown:`, error);
                // Continue with other assets even if one fails
            }
        }

        // Convert Map results to array format
        // Include ALL days in the period, even those with zero yield for continuous time-series
        const formattedResults = Array.from(dailyResults.values())
            .map(dayData => ({
                date: dayData.date,
                timestamp: dayData.timestamp,
                dailyYield: dayData.dailyYield,
                assets: Array.from(dayData.assets.values()).map(assetData => ({
                    asset: assetData.asset,
                    dailyYield: assetData.dailyYield,
                    segments: (assetData.segments || []).map(seg => ({
                        startTime: seg.startTime,
                        endTime: seg.endTime,
                        scaledBalance: seg.scaledBalance.toString(), // Convert BigInt to string for JSON serialization
                        segmentYield: seg.segmentYield.toString(),   // Convert BigInt to string for JSON serialization
                        durationHours: seg.durationHours
                    }))
                }))
            }))
            .sort((a, b) => a.timestamp - b.timestamp); // Sort chronologically

        return formattedResults;

    } catch (error) {
        console.error(`❌ Error in calculateUserDailyYieldBreakdown for user ${user}:`, error);
        throw error;
    }
}


/**
 * Helper: Calculate scaled balance at a specific timestamp from pre-fetched events
 * This avoids database queries by using in-memory event data
 */
function calculateBalanceFromEvents(
    events: any[],
    timestamp: number
): bigint {
    // Find the most recent event at or before the timestamp
    let balance = 0n;

    for (const event of events) {
        if (event.timestamp <= timestamp) {
            balance = event.scaledBalance;
        } else {
            break; // Events are sorted, so we can stop here
        }
    }

    return balance;
}

/**
 * Helper: Calculate scaled borrow balance at a specific timestamp from pre-fetched events
 * This avoids database queries by using in-memory event data
 * Returns the SCALED balance (constant value before applying borrow index)
 *
 * @param borrows - Pre-fetched borrow events
 * @param repays - Pre-fetched repay events
 * @param timestamp - Target timestamp
 * @returns Scaled borrow balance (constant value)
 */
function calculateScaledBorrowBalanceFromEvents(
    borrows: any[],
    repays: any[],
    timestamp: number
): bigint {
    // Calculate scaled borrow balance (constant value)
    let scaledBorrowBalance = 0n;

    // Add all borrows up to timestamp
    for (const borrow of borrows) {
        if (borrow.timestamp <= timestamp) {
            scaledBorrowBalance += borrow.amount;
        }
    }

    // Subtract all repays up to timestamp
    for (const repay of repays) {
        if (repay.timestamp <= timestamp) {
            scaledBorrowBalance -= repay.amount;
        }
    }

    return scaledBorrowBalance > 0n ? scaledBorrowBalance : 0n;
}

/**
 * Helper: Calculate borrowed balance at a specific timestamp from pre-fetched events
 * This avoids database queries by using in-memory event data
 *
 * IMPORTANT: This function now properly accounts for accrued borrow interest
 * by applying the variableBorrowIndex to the scaled borrow balance.
 *
 * @param borrows - Pre-fetched borrow events
 * @param repays - Pre-fetched repay events
 * @param timestamp - Target timestamp
 * @param variableBorrowIndex - Variable borrow index at the target timestamp
 * @returns Actual borrowed balance with accrued interest
 */
function calculateBorrowedFromEvents(
    borrows: any[],
    repays: any[],
    timestamp: number,
    variableBorrowIndex: bigint
): bigint {
    // Calculate scaled borrow balance (constant value)
    const scaledBorrowBalance = calculateScaledBorrowBalanceFromEvents(borrows, repays, timestamp);

    // If no net borrowed amount, return 0
    if (scaledBorrowBalance <= 0n) {
        return 0n;
    }

    // Calculate actual borrowed amount with accrued interest
    // Formula: actualBorrow = scaledBorrow * variableBorrowIndex / RAY
    const actualBorrowedBalance = calculateActualBalance(
        scaledBorrowBalance,
        variableBorrowIndex
    );

    return actualBorrowedBalance > 0n ? actualBorrowedBalance : 0n;
}

/**
 * Calculate portfolio value at a specific timestamp
 * Helper function used by both daily and current value calculations
 */
async function calculatePortfolioValueAtTimestamp(
    context: any,
    user: string,
    timestamp: number,
    allAssets: string[],
    balanceEventsByAsset: Map<string, any[]>,
    borrowsByAsset: Map<string, any[]>,
    repaysByAsset: Map<string, any[]>,
    indexCache: LiquidityIndexCache,
    borrowIndexCache: BorrowIndexCache
): Promise<{
    portfolioValue: bigint;
    totalSupplied: bigint;
    totalBorrowed: bigint;
    assets: Array<{
        asset: string;
        supplied: bigint;
        borrowed: bigint;
        netPosition: bigint;
    }>;
}> {
    let totalSupplied = 0n;
    let totalBorrowed = 0n;
    const assets: Array<{
        asset: string;
        supplied: bigint;
        borrowed: bigint;
        netPosition: bigint;
    }> = [];

    for (const asset of allAssets) {
        const balanceEvents = balanceEventsByAsset.get(asset) || [];
        const borrows = borrowsByAsset.get(asset) || [];
        const repays = repaysByAsset.get(asset) || [];

        // Calculate supplied balance
        const scaledBalance = calculateBalanceFromEvents(balanceEvents, timestamp);
        const liquidityIndex = await indexCache.get(context, asset, timestamp);
        const suppliedBalance = calculateActualBalance(scaledBalance, liquidityIndex);

        // Calculate borrowed balance
        const variableBorrowIndex = await borrowIndexCache.get(context, asset, timestamp);
        const borrowedBalance = calculateBorrowedFromEvents(borrows, repays, timestamp, variableBorrowIndex);

        if (suppliedBalance > 0n || borrowedBalance > 0n) {
            totalSupplied += suppliedBalance;
            totalBorrowed += borrowedBalance;
            assets.push({
                asset,
                supplied: suppliedBalance,
                borrowed: borrowedBalance,
                netPosition: suppliedBalance - borrowedBalance
            });
        }
    }

    return {
        portfolioValue: totalSupplied - totalBorrowed,
        totalSupplied,
        totalBorrowed,
        assets
    };
}

/**
 * Calculate daily portfolio values for a user over a custom time period
 * Portfolio Value = Total Supplied - Total Borrowed
 *
 * Returns daily breakdown showing supplied and borrowed amounts per asset,
 * suitable for portfolio value charts and net worth tracking.
 *
 * Batch fetches all data upfront, eliminating O(days × assets × 2) query pattern
 *
 * If toTimestamp is not at a day boundary (midnight UTC), also calculates current
 * portfolio value at toTimestamp and returns it separately.
 */
export async function calculateUserDailyPortfolioValue(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    dailyValues: Array<{
        date: string;
        timestamp: number;
        portfolioValue: bigint;
        totalSupplied: bigint;
        totalBorrowed: bigint;
        assets: Array<{
            asset: string;
            supplied: bigint;
            borrowed: bigint;
            netPosition: bigint;
        }>;
    }>;
    currentValue?: {
        date: string;
        timestamp: number;
        portfolioValue: bigint;
        totalSupplied: bigint;
        totalBorrowed: bigint;
        isPartialDay: boolean;
        assets: Array<{
            asset: string;
            supplied: bigint;
            borrowed: bigint;
            netPosition: bigint;
        }>;
    };
}> {
    try {
        // Get all assets user had positions in during this period (supplies)
        const suppliedAssets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);

        // Get all assets user borrowed during this period
        const borrowedAssets = await getUserBorrowedAssets(context, user, startTimestamp, endTimestamp);

        // Combine all unique assets
        const allAssets = Array.from(new Set([...suppliedAssets, ...borrowedAssets]));

        if (allAssets.length === 0) {
            return {
                dailyValues: [],
                currentValue: undefined
            };
        }

        // Initialize liquidity index cache and borrow index cache
        const indexCache = new LiquidityIndexCache();
        const borrowIndexCache = new BorrowIndexCache();

        // Batch fetch ALL balance events for ALL assets in ONE query
        const dbQuery = context.db.sql || context.db;
        const { Borrow, Repay } = await import("ponder:schema");

        const [allBalanceEvents, allBorrows, allRepays] = await Promise.all([
            dbQuery
                .select()
                .from(UserBalanceEvent)
                .where(eq(UserBalanceEvent.user, user as `0x${string}`))
                .orderBy(UserBalanceEvent.timestamp),
            dbQuery
                .select()
                .from(Borrow)
                .where(eq(Borrow.onBehalfOf, user as `0x${string}`))
                .orderBy(Borrow.timestamp),
            dbQuery
                .select()
                .from(Repay)
                .where(eq(Repay.user, user as `0x${string}`))
                .orderBy(Repay.timestamp)
        ]);

        // Group events by asset
        const balanceEventsByAsset = new Map<string, any[]>();
        for (const event of allBalanceEvents) {
            if (!balanceEventsByAsset.has(event.asset)) {
                balanceEventsByAsset.set(event.asset, []);
            }
            balanceEventsByAsset.get(event.asset)!.push(event);
        }

        const borrowsByAsset = new Map<string, any[]>();
        for (const borrow of allBorrows) {
            if (!borrowsByAsset.has(borrow.reserve)) {
                borrowsByAsset.set(borrow.reserve, []);
            }
            borrowsByAsset.get(borrow.reserve)!.push(borrow);
        }

        const repaysByAsset = new Map<string, any[]>();
        for (const repay of allRepays) {
            if (!repaysByAsset.has(repay.reserve)) {
                repaysByAsset.set(repay.reserve, []);
            }
            repaysByAsset.get(repay.reserve)!.push(repay);
        }

        // Create daily time buckets
        const dailyResults = new Map<string, {
            date: string;
            timestamp: number;
            totalSupplied: bigint;
            totalBorrowed: bigint;
            assets: Map<string, {
                asset: string;
                supplied: bigint;
                borrowed: bigint;
            }>;
        }>();

        // Initialize daily buckets
        const startDate = new Date(startTimestamp * 1000);
        const totalDays = Math.ceil((endTimestamp - startTimestamp) / (24 * 60 * 60)) + 1;

        const dayTimestamps: number[] = [];
        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + dayOffset);

            const dateStr = currentDate.toISOString().split('T')[0]!;
            const dayStartTimestamp = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) / 1000);
            const dayEndTimestamp = dayStartTimestamp + (24 * 60 * 60) - 1;

            dayTimestamps.push(dayEndTimestamp);
            dailyResults.set(dateStr, {
                date: dateStr,
                timestamp: dayStartTimestamp,
                totalSupplied: 0n,
                totalBorrowed: 0n,
                assets: new Map()
            });
        }

        // Prefetch all liquidity indices and borrow indices we'll need (days × assets)
        const indexPrefetchList = [];
        for (const asset of allAssets) {
            for (const dayEndTimestamp of dayTimestamps) {
                indexPrefetchList.push({ asset, timestamp: dayEndTimestamp });
            }
        }
        await Promise.all([
            indexCache.prefetch(context, indexPrefetchList),
            borrowIndexCache.prefetch(context, indexPrefetchList)
        ]);

        // Process each asset using pre-fetched data (NO database queries in loop)
        for (const asset of allAssets) {
            const balanceEvents = balanceEventsByAsset.get(asset) || [];
            const borrows = borrowsByAsset.get(asset) || [];
            const repays = repaysByAsset.get(asset) || [];

            // For each day, calculate supplied and borrowed balances from pre-fetched events
            for (const [dateStr, dayData] of dailyResults) {
                const dayEndTimestamp = dayData.timestamp + (24 * 60 * 60) - 1;

                // Calculate supplied balance from events (no DB query)
                const scaledBalance = calculateBalanceFromEvents(balanceEvents, dayEndTimestamp);
                const liquidityIndex = await indexCache.get(context, asset, dayEndTimestamp);
                const suppliedBalance = calculateActualBalance(scaledBalance, liquidityIndex);

                // Calculate borrowed balance from events with accrued interest (no DB query)
                const variableBorrowIndex = await borrowIndexCache.get(context, asset, dayEndTimestamp);
                const borrowedBalance = calculateBorrowedFromEvents(borrows, repays, dayEndTimestamp, variableBorrowIndex);

                // Only add to assets map if there's a non-zero position
                if (suppliedBalance > 0n || borrowedBalance > 0n) {
                    dayData.assets.set(asset, {
                        asset,
                        supplied: suppliedBalance,
                        borrowed: borrowedBalance
                    });

                    dayData.totalSupplied += suppliedBalance;
                    dayData.totalBorrowed += borrowedBalance;
                }
            }
        }

        // Convert Map results to array format
        const dailyValues = Array.from(dailyResults.values())
            .map(dayData => {
                const portfolioValue = dayData.totalSupplied - dayData.totalBorrowed;

                return {
                    date: dayData.date,
                    timestamp: dayData.timestamp,
                    portfolioValue,
                    totalSupplied: dayData.totalSupplied,
                    totalBorrowed: dayData.totalBorrowed,
                    assets: Array.from(dayData.assets.values()).map(assetData => {
                        const netPosition = assetData.supplied - assetData.borrowed;
                        return {
                            asset: assetData.asset,
                            supplied: assetData.supplied,
                            borrowed: assetData.borrowed,
                            netPosition
                        };
                    })
                };
            })
            .sort((a, b) => a.timestamp - b.timestamp);

        // Check if endTimestamp is at a day boundary (midnight UTC)
        const endDate = new Date(endTimestamp * 1000);
        const endDayStart = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) / 1000;
        const isPartialDay = endTimestamp !== endDayStart;

        // If endTimestamp is in the middle of a day, calculate current portfolio value
        let currentValue: {
            date: string;
            timestamp: number;
            portfolioValue: bigint;
            totalSupplied: bigint;
            totalBorrowed: bigint;
            isPartialDay: boolean;
            assets: Array<{
                asset: string;
                supplied: bigint;
                borrowed: bigint;
                netPosition: bigint;
            }>;
        } | undefined;

        if (isPartialDay) {
            // Prefetch indices for current timestamp
            const currentIndexPrefetchList = allAssets.map(asset => ({ asset, timestamp: endTimestamp }));
            await Promise.all([
                indexCache.prefetch(context, currentIndexPrefetchList),
                borrowIndexCache.prefetch(context, currentIndexPrefetchList)
            ]);

            // Calculate portfolio value at current timestamp
            const currentPortfolio = await calculatePortfolioValueAtTimestamp(
                context,
                user,
                endTimestamp,
                allAssets,
                balanceEventsByAsset,
                borrowsByAsset,
                repaysByAsset,
                indexCache,
                borrowIndexCache
            );

            currentValue = {
                date: endDate.toISOString().split('T')[0]!,
                timestamp: endTimestamp,
                portfolioValue: currentPortfolio.portfolioValue,
                totalSupplied: currentPortfolio.totalSupplied,
                totalBorrowed: currentPortfolio.totalBorrowed,
                isPartialDay: true,
                assets: currentPortfolio.assets
            };
        }

        return {
            dailyValues,
            currentValue
        };

    } catch (error) {
        console.error(`❌ Error in calculateUserDailyPortfolioValue for user ${user}:`, error);
        throw error;
    }
}


