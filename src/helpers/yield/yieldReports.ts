import { UserBalanceEvent } from "ponder:schema";
import { eq, and, gte, lte } from "ponder";
import {
    getMonthTimestamps,
    calculateLiquidityIndexAtTimestamp,
    calculateActualBalance,
    formatRayValue,
    formatTokenBalance
} from "../aave";
import { calculateNetDeposits, calculateTotalSupplied, calculateTotalBorrowed } from "../userPositionManager";
import {
    getScaledBalanceAtTimestamp,
    getUserAssetsForMonth,
    getUserAssetsForPeriod,
    getMaxBalanceDuringMonth,
    getMaxBalanceDuringPeriod,
    getBorrowedBalanceAtTimestamp,
    getUserBorrowedAssets
} from "./balanceQueries";
import {
    calculateSegmentedMonthlyYield,
    calculateSegmentedCustomPeriodYield
} from "./yieldCalculations";

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

        const results = [];

        for (const asset of assets) {
            try {
                // Get scaled balances at month boundaries
                const startScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);
                const endScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, endTimestamp);

                // Get liquidity indices at month boundaries
                const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, startTimestamp);
                const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, endTimestamp);

                // Calculate actual balances
                const startActualBalance = calculateActualBalance(startScaledBalance, startLiquidityIndex);
                const endActualBalance = calculateActualBalance(endScaledBalance, endLiquidityIndex);

                // Get monthly events for this asset to calculate additional metrics
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
                    );

                // Calculate net deposits during the month
                const netDeposits = await calculateNetDeposits(context, user, asset, startTimestamp, endTimestamp);

                // Enhanced calculation: Handle intra-month positions
                const segmentedResult = await calculateSegmentedMonthlyYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestamp
                );

                const monthlyYield = segmentedResult.totalYield;
                const segments = segmentedResult.segments;

                // Calculate additional metrics for better understanding
                const hadPositionDuringMonth = monthlyEvents.length > 0 || startScaledBalance > 0n;
                const maxBalanceDuringMonth = await getMaxBalanceDuringMonth(context, user, asset, startTimestamp, endTimestamp);

                results.push({
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
                    // Additional context fields
                    hadPositionDuringMonth,
                    maxBalanceDuringMonth,
                    transactionCount: monthlyEvents.length,
                    // Detailed segment information
                    segments
                });

            } catch (error) {
                console.error(`❌ Error calculating yield for asset ${asset}:`, error);
                // Continue with other assets even if one fails
            }
        }

        return results;

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

        const results = [];

        for (const asset of assets) {
            try {
                // Get scaled balances at period boundaries
                const startScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);
                const endScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, endTimestamp);

                // Get liquidity indices at period boundaries
                const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, startTimestamp);
                const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, endTimestamp);

                // Calculate actual balances
                const startActualBalance = calculateActualBalance(startScaledBalance, startLiquidityIndex);
                const endActualBalance = calculateActualBalance(endScaledBalance, endLiquidityIndex);

                // Get period events for this asset to calculate additional metrics
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
                    );

                // Calculate net deposits during the period
                const netDeposits = await calculateNetDeposits(context, user, asset, startTimestamp, endTimestamp);

                // Calculate supplied and borrowed amounts during the period
                const suppliedAmount = await calculateTotalSupplied(context, user, asset, startTimestamp, endTimestamp);
                const borrowedAmount = await calculateTotalBorrowed(context, user, asset, startTimestamp, endTimestamp);

                // Enhanced calculation: Handle intra-period positions
                const segmentedResult = await calculateSegmentedCustomPeriodYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestamp
                );

                const periodYield = segmentedResult.totalYield;
                const segments = segmentedResult.segments;

                // Calculate additional metrics for better understanding
                const hadPositionDuringPeriod = periodEvents.length > 0 || startScaledBalance > 0n;
                const maxBalanceDuringPeriod = await getMaxBalanceDuringPeriod(context, user, asset, startTimestamp, endTimestamp);

                results.push({
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
                    // Additional context fields
                    hadPositionDuringPeriod,
                    maxBalanceDuringPeriod,
                    transactionCount: periodEvents.length,
                    // Detailed segment information
                    segments
                });

            } catch (error) {
                console.error(`❌ Error calculating yield for asset ${asset}:`, error);
                // Continue with other assets even if one fails
            }
        }
      return results;

    } catch (error) {
        console.error(`❌ Error in calculateUserCustomPeriodYield for user ${user}:`, error);
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
    dailyYieldFormatted: string;
    assets: Array<{
        asset: string;
        dailyYield: bigint;
        dailyYieldFormatted: string;
        segments: Array<{
            startTime: number;
            endTime: number;
            scaledBalance: string; // String for JSON serialization
            segmentYield: string;  // String for JSON serialization
            segmentYieldFormatted: string;
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

        // Convert Map results to array format and add formatting
        // Include ALL days in the period, even those with zero yield for continuous time-series
        const formattedResults = Array.from(dailyResults.values())
            .map(dayData => ({
                date: dayData.date,
                timestamp: dayData.timestamp,
                dailyYield: dayData.dailyYield,
                dailyYieldFormatted: formatRayValue(dayData.dailyYield),
                assets: Array.from(dayData.assets.values()).map(assetData => ({
                    asset: assetData.asset,
                    dailyYield: assetData.dailyYield,
                    dailyYieldFormatted: formatRayValue(assetData.dailyYield),
                    segments: (assetData.segments || []).map(seg => ({
                        startTime: seg.startTime,
                        endTime: seg.endTime,
                        scaledBalance: seg.scaledBalance.toString(), // Convert BigInt to string for JSON serialization
                        segmentYield: seg.segmentYield.toString(),   // Convert BigInt to string for JSON serialization
                        segmentYieldFormatted: formatRayValue(seg.segmentYield), // Add formatted value
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
 * Calculate daily portfolio values for a user over a custom time period
 * Portfolio Value = Total Supplied - Total Borrowed
 *
 * Returns daily breakdown showing supplied and borrowed amounts per asset,
 * suitable for portfolio value charts and net worth tracking.
 */
export async function calculateUserDailyPortfolioValue(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    date: string;
    timestamp: number;
    portfolioValue: bigint;
    portfolioValueFormatted: string;
    totalSupplied: bigint;
    totalSuppliedFormatted: string;
    totalBorrowed: bigint;
    totalBorrowedFormatted: string;
    assets: Array<{
        asset: string;
        supplied: bigint;
        suppliedFormatted: string;
        borrowed: bigint;
        borrowedFormatted: string;
        netPosition: bigint;
        netPositionFormatted: string;
    }>;
}>> {
    try {
        // Get all assets user had positions in during this period (supplies)
        const suppliedAssets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);

        // Get all assets user borrowed during this period
        const borrowedAssets = await getUserBorrowedAssets(context, user, startTimestamp, endTimestamp);

        // Combine all unique assets
        const allAssets = Array.from(new Set([...suppliedAssets, ...borrowedAssets]));

        if (allAssets.length === 0) {
            return [];
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

        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + dayOffset);

            const dateStr = currentDate.toISOString().split('T')[0]!;
            // Use UTC to ensure consistent day boundaries regardless of server timezone
            const dayStartTimestamp = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) / 1000);

            dailyResults.set(dateStr, {
                date: dateStr,
                timestamp: dayStartTimestamp,
                totalSupplied: 0n,
                totalBorrowed: 0n,
                assets: new Map()
            });
        }

        // Process each asset
        for (const asset of allAssets) {

            // For each day, calculate supplied and borrowed balances
            for (const [dateStr, dayData] of dailyResults) {
                // Use end of day timestamp (23:59:59) to capture all activity during the day
                // This ensures we see deposits/withdrawals that happened during the day
                const dayEndTimestamp = dayData.timestamp + (24 * 60 * 60) - 1;

                // Get supplied balance at end of day
                const scaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, dayEndTimestamp);
                const liquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, dayEndTimestamp);
                const suppliedBalance = calculateActualBalance(scaledBalance, liquidityIndex);

                // Get borrowed balance at end of day
                const borrowedBalance = await getBorrowedBalanceAtTimestamp(context, user, asset, dayEndTimestamp);

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

        // Convert Map results to array format with formatting
        // Note: Balances are in wei (token decimals), NOT RAY precision
        // We assume 18 decimals for most ERC20 tokens (standard)
        const TOKEN_DECIMALS = 18;

        const formattedResults = Array.from(dailyResults.values())
            .map(dayData => {
                const portfolioValue = dayData.totalSupplied - dayData.totalBorrowed;

                return {
                    date: dayData.date,
                    timestamp: dayData.timestamp,
                    portfolioValue,
                    portfolioValueFormatted: formatTokenBalance(portfolioValue, TOKEN_DECIMALS),
                    totalSupplied: dayData.totalSupplied,
                    totalSuppliedFormatted: formatTokenBalance(dayData.totalSupplied, TOKEN_DECIMALS),
                    totalBorrowed: dayData.totalBorrowed,
                    totalBorrowedFormatted: formatTokenBalance(dayData.totalBorrowed, TOKEN_DECIMALS),
                    assets: Array.from(dayData.assets.values()).map(assetData => {
                        const netPosition = assetData.supplied - assetData.borrowed;
                        return {
                            asset: assetData.asset,
                            supplied: assetData.supplied,
                            suppliedFormatted: formatTokenBalance(assetData.supplied, TOKEN_DECIMALS),
                            borrowed: assetData.borrowed,
                            borrowedFormatted: formatTokenBalance(assetData.borrowed, TOKEN_DECIMALS),
                            netPosition,
                            netPositionFormatted: formatTokenBalance(netPosition, TOKEN_DECIMALS)
                        };
                    })
                };
            })
            .sort((a, b) => a.timestamp - b.timestamp);

        return formattedResults;

    } catch (error) {
        console.error(`❌ Error in calculateUserDailyPortfolioValue for user ${user}:`, error);
        throw error;
    }
}


