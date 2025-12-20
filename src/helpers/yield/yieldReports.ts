import {UserBalanceEvent, AssetPriceSnapshot} from "ponder:schema";
import {eq, and, lte, desc} from "ponder";
import {
    calculateLiquidityIndexAtTimestamp,
    calculateActualBalance,
    calculateScaledBalance,
    calculateVariableBorrowIndexAtTimestamp
} from "../aave";
import {
    getUserAssetsForPeriod,
    getUserBorrowedAssets
} from "./balanceQueries";
import {
    calculateSegmentedCustomPeriodYield,
    calculateSegmentedCustomPeriodBorrowCost
} from "./yieldCalculations";
import {LiquidityIndexCache} from "./liquidityIndexCache";
import {BorrowIndexCache} from "./borrowIndexCache";
import {calculateUSDValueNumber} from "../usdCalculations";

/**
 * Get decimals for an asset from the most recent AssetPriceSnapshot
 * Falls back to default if no snapshot found
 */
async function getDecimalsFromSnapshot(
    dbQuery: any,
    asset: string,
    timestamp: number,
    defaultDecimals: number = 18
): Promise<number> {
    const snapshots = await dbQuery
        .select()
        .from(AssetPriceSnapshot)
        .where(
            and(
                eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                lte(AssetPriceSnapshot.timestamp, timestamp)
            )
        )
        .orderBy(desc(AssetPriceSnapshot.timestamp))
        .limit(1);

    return snapshots.length > 0 && snapshots[0].decimals != null
        ? snapshots[0].decimals
        : defaultDecimals;
}

/**
 * Get asset price at a specific timestamp from AssetPriceSnapshot
 * Returns the most recent price snapshot at or before the given timestamp
 */
async function getAssetPriceAtTimestamp(
    dbQuery: any,
    asset: string,
    timestamp: number
): Promise<{price: bigint, priceTimestamp: number}> {
    const snapshots = await dbQuery
        .select()
        .from(AssetPriceSnapshot)
        .where(
            and(
                eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                lte(AssetPriceSnapshot.timestamp, timestamp)
            )
        )
        .orderBy(desc(AssetPriceSnapshot.timestamp))
        .limit(1);

    if (snapshots.length > 0 && snapshots[0].price != null) {
        return {
            price: snapshots[0].price,
            priceTimestamp: Number(snapshots[0].timestamp)
        };
    }
    return { price: 0n, priceTimestamp: 0 };
}

/**
 * Daily yield data structure
 */
export interface DailyYieldData {
    date: string;
    timestamp: number;
    assetYield: bigint;
    borrowCost: bigint;
    netYield: bigint;
    assetYieldUSD: string;  // USD value of daily asset yield
    borrowCostUSD: string;  // USD value of daily borrow cost
    netYieldUSD: string;    // USD value of daily net yield
    assets: Array<{
        asset: string;
        assetPrice?: string;     // Asset USD price (8 decimals)
        assetPriceTimestamp?: number; // Timestamp of the price snapshot
        assetYield: bigint;
        borrowCost: bigint;
        netYield: bigint;
        assetYieldUSD: string;  // USD value of asset yield
        borrowCostUSD: string;  // USD value of borrow cost
        netYieldUSD: string;    // USD value of net yield
        segments: Array<{
            startTime: number;
            endTime: number;
            scaledBalance: string; // String for JSON serialization
            segmentYield: string;  // String for JSON serialization
            segmentYieldUSD: string; // USD value of segment yield
            assetPrice: string; // Asset USD price (8 decimals)
            assetPriceTimestamp: number; // Timestamp of the price snapshot
            durationHours: number;
        }>;
        borrowSegments: Array<{
            startTime: number;
            endTime: number;
            scaledBorrowBalance: string; // String for JSON serialization
            segmentBorrowCost: string;  // String for JSON serialization
            segmentBorrowCostUSD: string; // USD value of segment borrow cost
            assetPrice: string; // Asset USD price (8 decimals)
            assetPriceTimestamp: number; // Timestamp of the price snapshot
            durationHours: number;
        }>;
    }>;
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
 *
 * **Partial Day Support:** If endTimestamp is not at a day boundary (midnight UTC),
 * also calculates current day's yield at endTimestamp and returns it separately.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Object with dailyValues (complete days) and optional currentValue (partial day)
 */
export async function calculateUserDailyYieldBreakdown(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    dailyValues: DailyYieldData[];
    currentValue?: DailyYieldData & { isPartialDay: boolean };
}> {
    try {
        const dbQuery = context.db.sql || context.db;

        // Get all assets user had positions in during this period
        // Include both supply assets AND borrow-only assets
        const supplyAssets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);
        const borrowAssets = await getUserBorrowedAssets(context, user, startTimestamp, endTimestamp);
        const assets = [...new Set([...supplyAssets, ...borrowAssets])];

        if (assets.length === 0) {
            return {
                dailyValues: [],
                currentValue: undefined
            };
        }

        // Calculate daily yields including partial days
        // For the last day, if endTimestamp is before midnight, calculate yield up to endTimestamp
        const endDate = new Date(endTimestamp * 1000);
        const endDayStart = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) / 1000;
        // Check if endTimestamp is a partial day (not at or after midnight of next day)
        const endOfLastDay = endDayStart + 24 * 60 * 60;
        const isPartialDay = endTimestamp < endOfLastDay;
        // Use endTimestamp for partial days, otherwise use end of day
        const endTimestampForDays = isPartialDay ? endTimestamp : endOfLastDay;

        // Create daily time buckets
        const dailyResults = new Map<string, {
            date: string;
            timestamp: number;
            assetYield: bigint;
            borrowCost: bigint;
            netYield: bigint;
            assetYieldUSD: number;
            borrowCostUSD: number;
            netYieldUSD: number;
            assets: Map<string, {
                asset: string;
                assetPrice?: bigint;
                assetPriceTimestamp?: number;
                assetYield: bigint;
                borrowCost: bigint;
                netYield: bigint;
                assetYieldUSD: number;
                borrowCostUSD: number;
                netYieldUSD: number;
                segments: Array<{
                    startTime: number;
                    endTime: number;
                    scaledBalance: string;
                    segmentYield: string;
                    segmentYieldUSD: string;
                    assetPrice: string;
                    assetPriceTimestamp: number;
                    durationHours: number;
                }>;
                borrowSegments: Array<{
                    startTime: number;
                    endTime: number;
                    scaledBorrowBalance: string;
                    segmentBorrowCost: string;
                    segmentBorrowCostUSD: string;
                    assetPrice: string;
                    assetPriceTimestamp: number;
                    durationHours: number;
                }>;
            }>;
        }>();

        // Initialize daily buckets (including partial day if applicable)
        const startDate = new Date(startTimestamp * 1000);
        const oneDaySeconds = 24 * 60 * 60;

        // Calculate number of days to iterate (use endDayStart to include the last day)
        // endDayStart represents the last day in the query period
        const totalDays = Math.ceil((endDayStart - startTimestamp) / oneDaySeconds) + 1;

        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
            const currentDate = new Date(startDate);
            currentDate.setUTCDate(startDate.getUTCDate() + dayOffset);

            const dateStr = currentDate.toISOString().split('T')[0]!; // YYYY-MM-DD format
            // Use UTC to ensure consistent day boundaries regardless of server timezone
            const dayStartTimestamp = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) / 1000);
            // Use END of day timestamp (23:59:59 UTC) for complete days
            // For the last day, if it's a partial day, use endTimestamp instead
            let dayEndTimestamp = dayStartTimestamp + oneDaySeconds - 1;
            const isLastDay = dayOffset === totalDays - 1;
            if (isLastDay && isPartialDay) {
                dayEndTimestamp = endTimestamp;
            }

            dailyResults.set(dateStr, {
                date: dateStr,
                timestamp: dayEndTimestamp,
                assetYield: 0n,
                borrowCost: 0n,
                netYield: 0n,
                assetYieldUSD: 0,
                borrowCostUSD: 0,
                netYieldUSD: 0,
                assets: new Map()
            });
        }

        // Process each asset
        for (const asset of assets) {
            try {
                // Get decimals from AssetPriceSnapshot (use endTimestamp to get most recent)
                const decimals = await getDecimalsFromSnapshot(dbQuery, asset, endTimestamp);

                // Initialize this asset in all days with zero yield and fetch price for each day
                for (const [dateStr, dayData] of dailyResults) {
                    if (!dayData.assets.has(asset)) {
                        // Get asset price for this day's timestamp
                        const priceSnapshots = await dbQuery
                            .select()
                            .from(AssetPriceSnapshot)
                            .where(
                                and(
                                    eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                                    lte(AssetPriceSnapshot.timestamp, dayData.timestamp)
                                )
                            )
                            .orderBy(desc(AssetPriceSnapshot.timestamp))
                            .limit(1);

                        const assetPrice = priceSnapshots.length > 0 ? priceSnapshots[0].price : undefined;
                        const assetPriceTimestamp = priceSnapshots.length > 0 ? Number(priceSnapshots[0].timestamp) : undefined;

                        dayData.assets.set(asset, {
                            asset,
                            assetPrice,
                            assetPriceTimestamp,
                            assetYield: 0n,
                            borrowCost: 0n,
                            netYield: 0n,
                            assetYieldUSD: 0,
                            borrowCostUSD: 0,
                            netYieldUSD: 0,
                            segments: [],
                            borrowSegments: []
                        });
                    }
                }

                // Get segmented yield data for this asset over complete days only
                const segmentedResult = await calculateSegmentedCustomPeriodYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestampForDays,
                    decimals  // Pass decimals for USD calculations
                );

                // Get segmented borrow cost data for this asset over complete days only
                const borrowCostResult = await calculateSegmentedCustomPeriodBorrowCost(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestampForDays,
                    decimals  // Pass decimals for USD calculations
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
                            dayData.assetYield += segment.segmentYield;

                            if (!dayData.assets.has(asset)) {
                                dayData.assets.set(asset, {
                                    asset,
                                    assetYield: 0n,
                                    borrowCost: 0n,
                                    netYield: 0n,
                                    assetYieldUSD: 0,
                                    borrowCostUSD: 0,
                                    netYieldUSD: 0,
                                    segments: [],
                                    borrowSegments: []
                                });
                            }

                            const assetData = dayData.assets.get(asset)!;
                            assetData.assetYield += segment.segmentYield;

                            // Get price at segment end for USD calculation
                            const priceData = await getAssetPriceAtTimestamp(dbQuery, asset, segment.endTime);
                            const segmentYieldUSD = calculateUSDValueNumber(segment.segmentYield, priceData.price, decimals);
                            assetData.assetYieldUSD += segmentYieldUSD;
                            dayData.assetYieldUSD += segmentYieldUSD;

                            assetData.segments.push({
                                startTime: segment.startTime,
                                endTime: segment.endTime,
                                scaledBalance: segment.scaledBalance.toString(),
                                segmentYield: segment.segmentYield.toString(),
                                segmentYieldUSD: segmentYieldUSD.toString(),
                                assetPrice: priceData.price.toString(),
                                assetPriceTimestamp: priceData.priceTimestamp,
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
                        const dayOverlaps: Array<{ dateStr: string, overlapStart: number, overlapEnd: number }> = [];
                        for (let dayOffset = 0; dayOffset < segmentDays; dayOffset++) {
                            const currentDate = new Date(segmentStartDate);
                            currentDate.setUTCDate(segmentStartDate.getUTCDate() + dayOffset);
                            const currentDateStr = currentDate.toISOString().split('T')[0]!;
                            const dayData = dailyResults.get(currentDateStr);
                            if (!dayData) continue;

                            const dayStart = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) / 1000);
                            // Use full 86,400-second days with half-open interval [dayStart, dayEnd)
                            // For partial days (last day when endTimestamp < midnight), cap at endTimestamp
                            let dayEnd = dayStart + 24 * 60 * 60;
                            if (dayEnd > endTimestampForDays) {
                                dayEnd = endTimestampForDays;
                            }
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

                            dayData.assetYield += actualYield;

                            if (!dayData.assets.has(asset)) {
                                dayData.assets.set(asset, {
                                    asset,
                                    assetYield: 0n,
                                    borrowCost: 0n,
                                    netYield: 0n,
                                    assetYieldUSD: 0,
                                    borrowCostUSD: 0,
                                    netYieldUSD: 0,
                                    segments: [],
                                    borrowSegments: []
                                });
                            }

                            const assetData = dayData.assets.get(asset)!;
                            assetData.assetYield += actualYield;

                            // Calculate USD value using actual yield and price at end of overlap
                            const priceData = await getAssetPriceAtTimestamp(dbQuery, asset, overlapEnd);
                            const yieldUSD = calculateUSDValueNumber(actualYield, priceData.price, decimals);
                            assetData.assetYieldUSD += yieldUSD;
                            dayData.assetYieldUSD += yieldUSD;

                            assetData.segments.push({
                                startTime: overlapStart,
                                endTime: overlapEnd,
                                scaledBalance: segment.scaledBalance.toString(),
                                segmentYield: actualYield.toString(),
                                segmentYieldUSD: yieldUSD.toString(),
                                assetPrice: priceData.price.toString(),
                                assetPriceTimestamp: priceData.priceTimestamp,
                                durationHours: (overlapEnd - overlapStart) / 3600
                            });
                        }
                    }
                }

                // Process borrow cost segments and assign to appropriate days
                for (const segment of borrowCostResult.segments) {
                    // Process all segments, including zero-cost ones for completeness

                    // Determine which day(s) this segment spans
                    const segmentStartDate = new Date(segment.startTime * 1000);
                    const segmentEndDate = new Date(segment.endTime * 1000);

                    // If segment is within a single day, assign all cost to that day
                    const segmentStartDay = segmentStartDate.toISOString().split('T')[0]!;
                    const segmentEndDay = segmentEndDate.toISOString().split('T')[0]!;

                    if (segmentStartDay === segmentEndDay) {
                        // Segment is within a single day
                        const dayData = dailyResults.get(segmentStartDay);
                        if (dayData) {
                            dayData.borrowCost += segment.segmentBorrowCost;

                            if (!dayData.assets.has(asset)) {
                                dayData.assets.set(asset, {
                                    asset,
                                    assetYield: 0n,
                                    borrowCost: 0n,
                                    netYield: 0n,
                                    assetYieldUSD: 0,
                                    borrowCostUSD: 0,
                                    netYieldUSD: 0,
                                    segments: [],
                                    borrowSegments: []
                                });
                            }

                            const assetData = dayData.assets.get(asset)!;
                            assetData.borrowCost += segment.segmentBorrowCost;

                            // Calculate USD value using actual borrow cost and price at segment end
                            const priceData = await getAssetPriceAtTimestamp(dbQuery, asset, segment.endTime);
                            const borrowCostUSD = calculateUSDValueNumber(segment.segmentBorrowCost, priceData.price, decimals);
                            assetData.borrowCostUSD += borrowCostUSD;
                            dayData.borrowCostUSD += borrowCostUSD;

                            assetData.borrowSegments.push({
                                startTime: segment.startTime,
                                endTime: segment.endTime,
                                scaledBorrowBalance: segment.scaledBorrowBalance.toString(),
                                segmentBorrowCost: segment.segmentBorrowCost.toString(),
                                segmentBorrowCostUSD: borrowCostUSD.toString(),
                                assetPrice: priceData.price.toString(),
                                assetPriceTimestamp: priceData.priceTimestamp,
                                durationHours: segment.durationDays * 24
                            });
                        }
                    } else {
                        // Segment spans multiple days - calculate accurate borrow cost using borrow indices
                        const segmentDays = Math.ceil((segmentEndDate.getTime() - segmentStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

                        // Collect day overlaps for this borrow segment
                        const borrowDayOverlaps: Array<{dateStr: string, overlapStart: number, overlapEnd: number}> = [];
                        for (let dayOffset = 0; dayOffset < segmentDays; dayOffset++) {
                            const currentDate = new Date(segmentStartDate);
                            currentDate.setUTCDate(segmentStartDate.getUTCDate() + dayOffset);
                            const currentDateStr = currentDate.toISOString().split('T')[0]!;
                            const dayData = dailyResults.get(currentDateStr);
                            if (!dayData) continue;

                            const dayStart = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) / 1000);
                            // For partial days (last day when endTimestamp < midnight), cap at endTimestamp
                            let dayEnd = dayStart + 24 * 60 * 60;
                            if (dayEnd > endTimestampForDays) {
                                dayEnd = endTimestampForDays;
                            }
                            const overlapStart = Math.max(segment.startTime, dayStart);
                            const overlapEnd = Math.min(segment.endTime, dayEnd);

                            if (overlapEnd > overlapStart) {
                                borrowDayOverlaps.push({dateStr: currentDateStr, overlapStart, overlapEnd});
                            }
                        }

                        // Collect all unique timestamps needed for borrow index calculation
                        const borrowTimestampsNeeded = new Set<number>();
                        for (const {overlapStart, overlapEnd} of borrowDayOverlaps) {
                            borrowTimestampsNeeded.add(overlapStart);
                            borrowTimestampsNeeded.add(overlapEnd);
                        }

                        // First pass: calculate all borrow indices in parallel
                        const borrowIndexCache = new Map<number, bigint>();
                        for (const timestamp of borrowTimestampsNeeded) {
                            const index = await calculateVariableBorrowIndexAtTimestamp(context, asset, timestamp);
                            borrowIndexCache.set(timestamp, index);
                        }

                        // Second pass: use cached indices to calculate borrow costs
                        for (const {dateStr, overlapStart, overlapEnd} of borrowDayOverlaps) {
                            const dayData = dailyResults.get(dateStr)!;
                            const startIndex = borrowIndexCache.get(overlapStart)!;
                            const endIndex = borrowIndexCache.get(overlapEnd)!;

                            // Calculate actual borrow cost for this specific time period
                            const startBalance = calculateActualBalance(segment.scaledBorrowBalance, startIndex);
                            const endBalance = calculateActualBalance(segment.scaledBorrowBalance, endIndex);
                            const actualBorrowCost = endBalance - startBalance;

                            dayData.borrowCost += actualBorrowCost;

                            if (!dayData.assets.has(asset)) {
                                dayData.assets.set(asset, {
                                    asset,
                                    assetYield: 0n,
                                    borrowCost: 0n,
                                    netYield: 0n,
                                    assetYieldUSD: 0,
                                    borrowCostUSD: 0,
                                    netYieldUSD: 0,
                                    segments: [],
                                    borrowSegments: []
                                });
                            }

                            const assetData = dayData.assets.get(asset)!;
                            assetData.borrowCost += actualBorrowCost;

                            // Calculate USD value using actual borrow cost and price at end of overlap
                            const priceData = await getAssetPriceAtTimestamp(dbQuery, asset, overlapEnd);
                            const borrowCostUSD = calculateUSDValueNumber(actualBorrowCost, priceData.price, decimals);
                            assetData.borrowCostUSD += borrowCostUSD;
                            dayData.borrowCostUSD += borrowCostUSD;

                            assetData.borrowSegments.push({
                                startTime: overlapStart,
                                endTime: overlapEnd,
                                scaledBorrowBalance: segment.scaledBorrowBalance.toString(),
                                segmentBorrowCost: actualBorrowCost.toString(),
                                segmentBorrowCostUSD: borrowCostUSD.toString(),
                                assetPrice: priceData.price.toString(),
                                assetPriceTimestamp: priceData.priceTimestamp,
                                durationHours: (overlapEnd - overlapStart) / 3600
                            });
                        }
                    }
                }

                // Calculate net yield for all days after both yield and borrow cost processing
                for (const [dateStr, dayData] of dailyResults) {
                    if (dayData.assets.has(asset)) {
                        const assetData = dayData.assets.get(asset)!;
                        assetData.netYield = assetData.assetYield - assetData.borrowCost;
                        assetData.netYieldUSD = assetData.assetYieldUSD - assetData.borrowCostUSD;
                    }
                }

                // Update day-level net yield USD after all assets are processed
                for (const [dateStr, dayData] of dailyResults) {
                    dayData.netYield = dayData.assetYield - dayData.borrowCost;
                    dayData.netYieldUSD = dayData.assetYieldUSD - dayData.borrowCostUSD;
                }

            } catch (error) {
                console.error(`❌ Error processing asset ${asset} for daily breakdown:`, error);
                // Continue with other assets even if one fails
            }
        }

        const formattedResults = Array.from(dailyResults.values())
            .map(dayData => ({
                date: dayData.date,
                timestamp: dayData.timestamp,
                assetYield: dayData.assetYield,
                borrowCost: dayData.borrowCost,
                netYield: dayData.netYield,
                assetYieldUSD: dayData.assetYieldUSD,
                borrowCostUSD: dayData.borrowCostUSD,
                netYieldUSD: dayData.netYieldUSD,
                assets: Array.from(dayData.assets.values()).map(assetData => ({
                    asset: assetData.asset,
                    assetPrice: assetData.assetPrice?.toString(),
                    assetPriceTimestamp: assetData.assetPriceTimestamp,
                    assetYield: assetData.assetYield,
                    borrowCost: assetData.borrowCost,
                    netYield: assetData.netYield,
                    assetYieldUSD: assetData.assetYieldUSD,
                    borrowCostUSD: assetData.borrowCostUSD,
                    netYieldUSD: assetData.netYieldUSD,
                    segments: (assetData.segments || []).map(seg => ({
                        startTime: seg.startTime,
                        endTime: seg.endTime,
                        scaledBalance: seg.scaledBalance, // Already a string
                        segmentYield: seg.segmentYield,   // Already a string
                        segmentYieldUSD: seg.segmentYieldUSD,
                        assetPrice: seg.assetPrice,
                        assetPriceTimestamp: seg.assetPriceTimestamp,
                        durationHours: seg.durationHours
                    })),
                    borrowSegments: (assetData.borrowSegments || []).map(seg => ({
                        startTime: seg.startTime,
                        endTime: seg.endTime,
                        scaledBorrowBalance: seg.scaledBorrowBalance, // Already a string
                        segmentBorrowCost: seg.segmentBorrowCost,     // Already a string
                        segmentBorrowCostUSD: seg.segmentBorrowCostUSD,
                        assetPrice: seg.assetPrice,
                        assetPriceTimestamp: seg.assetPriceTimestamp,
                        durationHours: seg.durationHours
                    }))
                }))
            }))
            .sort((a, b) => a.timestamp - b.timestamp); // Sort chronologically

        return {
            dailyValues: formattedResults,
        };

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
 * IMPORTANT: In AAVE, borrow/repay events emit ACTUAL amounts (what the user receives/pays),
 * not scaled amounts. To get the true scaled balance, we must convert each event's amount
 * to scaled form using the variableBorrowIndex at that event's timestamp:
 *   scaledAmount = actualAmount * RAY / variableBorrowIndex
 *
 * @param borrows - Pre-fetched borrow events (with amount as ACTUAL borrowed)
 * @param repays - Pre-fetched repay events (with amount as ACTUAL repaid)
 * @param timestamp - Target timestamp
 * @param borrowIndexAtEventTime - Map of event timestamp -> variableBorrowIndex at that time
 * @returns Scaled borrow balance (constant value that can be multiplied by current index)
 */
function calculateScaledBorrowBalanceFromEvents(
    borrows: any[],
    repays: any[],
    timestamp: number,
    borrowIndexAtEventTime: Map<number, bigint>
): bigint {
    // Calculate scaled borrow balance by converting each event's actual amount to scaled
    let scaledBorrowBalance = 0n;

    // Add all borrows up to timestamp (convert actual to scaled)
    for (const borrow of borrows) {
        if (borrow.timestamp <= timestamp) {
            const indexAtBorrow = borrowIndexAtEventTime.get(borrow.timestamp);
            if (indexAtBorrow && indexAtBorrow > 0n) {
                // Convert actual amount to scaled: scaled = actual * RAY / index
                const scaledAmount = calculateScaledBalance(BigInt(borrow.amount), indexAtBorrow);
                scaledBorrowBalance += scaledAmount;
            } else {
                throw new Error(
                    `Missing borrow index for event at timestamp ${borrow.timestamp}. ` +
                    `Cannot calculate scaled borrow balance without index data.`
                );
            }
        }
    }

    // Subtract all repays up to timestamp (convert actual to scaled)
    for (const repay of repays) {
        if (repay.timestamp <= timestamp) {
            const indexAtRepay = borrowIndexAtEventTime.get(repay.timestamp);
            if (indexAtRepay && indexAtRepay > 0n) {
                // Convert actual amount to scaled: scaled = actual * RAY / index
                const scaledAmount = calculateScaledBalance(BigInt(repay.amount), indexAtRepay);
                scaledBorrowBalance -= scaledAmount;
            } else {
                throw new Error(
                    `Missing borrow index for repay event at timestamp ${repay.timestamp}. ` +
                    `Cannot calculate scaled borrow balance without index data.`
                );
            }
        }
    }

    return scaledBorrowBalance > 0n ? scaledBorrowBalance : 0n;
}

/**
 * Helper: Calculate borrowed balance at a specific timestamp from pre-fetched events
 * This avoids database queries by using in-memory event data
 *
 * IMPORTANT: This function properly accounts for accrued borrow interest by:
 * 1. Converting each borrow/repay event's actual amount to scaled using the index at event time
 * 2. Applying the current variableBorrowIndex to get the actual borrowed balance with interest
 *
 * @param borrows - Pre-fetched borrow events
 * @param repays - Pre-fetched repay events
 * @param timestamp - Target timestamp
 * @param variableBorrowIndex - Variable borrow index at the target timestamp
 * @param borrowIndexAtEventTime - Map of event timestamp -> variableBorrowIndex at that time
 * @returns Actual borrowed balance with accrued interest
 */
function calculateBorrowedFromEvents(
    borrows: any[],
    repays: any[],
    timestamp: number,
    variableBorrowIndex: bigint,
    borrowIndexAtEventTime: Map<number, bigint>
): bigint {
    // Calculate scaled borrow balance (properly converted from actual amounts)
    const scaledBorrowBalance = calculateScaledBorrowBalanceFromEvents(
        borrows,
        repays,
        timestamp,
        borrowIndexAtEventTime
    );

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
        portfolioValueUSD: string;
        totalSuppliedUSD: string;
        totalBorrowedUSD: string;
        assets: Array<{
            asset: string;
            supplied: bigint;
            borrowed: bigint;
            netPosition: bigint;
            suppliedUSD: string;
            borrowedUSD: string;
            netPositionUSD: string;
            assetPrice?: string; // Oracle price used for USD calculations (8 decimals)
            assetPriceTimestamp?: number; // Timestamp when the price was recorded
        }>;
    }>;
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
                dailyValues: []
            };
        }

        // Initialize liquidity index cache and borrow index cache
        const indexCache = new LiquidityIndexCache();
        const borrowIndexCache = new BorrowIndexCache();

        // Batch fetch ALL balance events for ALL assets in ONE query
        const dbQuery = context.db.sql || context.db;
        const {Borrow, Repay} = await import("ponder:schema");

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
            totalSuppliedUSD: number;
            totalBorrowedUSD: number;
            assets: Map<string, {
                asset: string;
                supplied: bigint;
                borrowed: bigint;
                suppliedUSD: number;
                borrowedUSD: number;
                assetPrice?: bigint; // Oracle price used for USD calculations
                assetPriceTimestamp?: number; // Timestamp when the price was recorded
            }>;
        }>();

        // Initialize daily buckets - calculate portfolio values at END of each day (23:59:59 UTC)
        // For partial days (today), use the actual endTimestamp instead of 23:59:59 UTC
        const startDate = new Date(startTimestamp * 1000);
        const endDate = new Date(endTimestamp * 1000);

        // Get the start of the first day (midnight UTC)
        const firstDayStart = Math.floor(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) / 1000);

        // Get the start of the last day (midnight UTC)
        const lastDayStart = Math.floor(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) / 1000);

        const oneDaySeconds = 24 * 60 * 60;
        const dayTimestamps: number[] = [];

        for (let dayStart = firstDayStart; dayStart <= lastDayStart; dayStart += oneDaySeconds) {
            const dateStr = new Date(dayStart * 1000).toISOString().split('T')[0]!;
            // Calculate at END of day (23:59:59 UTC) instead of start
            let dayEnd = dayStart + oneDaySeconds - 1;

            // For the last day, if dayEnd is in the future, use endTimestamp instead
            // This handles partial days (e.g., today) correctly
            if (dayEnd > endTimestamp) {
                dayEnd = endTimestamp;
            }

            dayTimestamps.push(dayEnd);
            dailyResults.set(dateStr, {
                date: dateStr,
                timestamp: dayEnd,
                totalSupplied: 0n,
                totalBorrowed: 0n,
                totalSuppliedUSD: 0,
                totalBorrowedUSD: 0,
                assets: new Map()
            });
        }

        // Prefetch all liquidity indices and borrow indices we'll need (days × assets)
        const indexPrefetchList = [];
        for (const asset of allAssets) {
            for (const dayStartTimestamp of dayTimestamps) {
                indexPrefetchList.push({asset, timestamp: dayStartTimestamp});
            }
        }

        // Also collect all borrow/repay event timestamps to prefetch indices at event times
        // This is needed for accurate scaled balance calculation
        const eventTimestampPrefetchList: Array<{asset: string, timestamp: number}> = [];
        for (const asset of allAssets) {
            const borrows = borrowsByAsset.get(asset) || [];
            const repays = repaysByAsset.get(asset) || [];
            for (const borrow of borrows) {
                eventTimestampPrefetchList.push({asset, timestamp: borrow.timestamp});
            }
            for (const repay of repays) {
                eventTimestampPrefetchList.push({asset, timestamp: repay.timestamp});
            }
        }

        await Promise.all([
            indexCache.prefetch(context, indexPrefetchList),
            borrowIndexCache.prefetch(context, [...indexPrefetchList, ...eventTimestampPrefetchList])
        ]);

        // Process each asset using pre-fetched data (NO database queries in loop)
        for (const asset of allAssets) {
            const balanceEvents = balanceEventsByAsset.get(asset) || [];
            const borrows = borrowsByAsset.get(asset) || [];
            const repays = repaysByAsset.get(asset) || [];

            // Build a map of event timestamp -> borrow index for this asset
            // This is used to convert actual borrow/repay amounts to scaled amounts
            const borrowIndexAtEventTime = new Map<number, bigint>();
            for (const borrow of borrows) {
                const index = await borrowIndexCache.get(context, asset, borrow.timestamp);
                borrowIndexAtEventTime.set(borrow.timestamp, index);
            }
            for (const repay of repays) {
                const index = await borrowIndexCache.get(context, asset, repay.timestamp);
                borrowIndexAtEventTime.set(repay.timestamp, index);
            }

            // For each day, calculate supplied and borrowed balances at END of day (23:59:59 UTC)
            for (const [dateStr, dayData] of dailyResults) {
                const dayEndTimestamp = dayData.timestamp;

                // Calculate supplied balance from events at day end (no DB query)
                const scaledBalance = calculateBalanceFromEvents(balanceEvents, dayEndTimestamp);
                const liquidityIndex = await indexCache.get(context, asset, dayEndTimestamp);
                const suppliedBalance = calculateActualBalance(scaledBalance, liquidityIndex);

                // Calculate borrowed balance from events with accrued interest at day end (no DB query)
                // Now properly converts actual amounts to scaled using index at each event's timestamp
                const variableBorrowIndex = await borrowIndexCache.get(context, asset, dayEndTimestamp);
                const borrowedBalance = calculateBorrowedFromEvents(
                    borrows,
                    repays,
                    dayEndTimestamp,
                    variableBorrowIndex,
                    borrowIndexAtEventTime
                );

                // Get historical price and decimals at day end from AssetPriceSnapshot
                // Query the most recent snapshot at or before dayEndTimestamp
                const priceSnapshots = await dbQuery
                    .select()
                    .from(AssetPriceSnapshot)
                    .where(
                        and(
                            eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                            lte(AssetPriceSnapshot.timestamp, dayEndTimestamp)
                        )
                    )
                    .orderBy(desc(AssetPriceSnapshot.timestamp))
                    .limit(1);

                const assetPrice = priceSnapshots.length > 0 ? priceSnapshots[0].price : undefined;
                const assetPriceTimestamp = priceSnapshots.length > 0 ? priceSnapshots[0].timestamp : undefined;
                const decimals = priceSnapshots.length > 0 && priceSnapshots[0].decimals != null ? priceSnapshots[0].decimals : 18;

                // Only add to assets map if there's a non-zero position
                if (suppliedBalance > 0n || borrowedBalance > 0n) {
                    // Calculate USD values
                    const suppliedUSD = calculateUSDValueNumber(suppliedBalance, assetPrice, decimals);
                    const borrowedUSD = calculateUSDValueNumber(borrowedBalance, assetPrice, decimals);

                    dayData.assets.set(asset, {
                        asset,
                        supplied: suppliedBalance,
                        borrowed: borrowedBalance,
                        suppliedUSD,
                        borrowedUSD,
                        assetPrice,
                        assetPriceTimestamp
                    });

                    dayData.totalSupplied += suppliedBalance;
                    dayData.totalBorrowed += borrowedBalance;
                    dayData.totalSuppliedUSD += suppliedUSD;
                    dayData.totalBorrowedUSD += borrowedUSD;
                }
            }
        }

        // Convert Map results to array format
        const dailyValues = Array.from(dailyResults.values())
            .map(dayData => {
                const portfolioValue = dayData.totalSupplied - dayData.totalBorrowed;
                const portfolioValueUSD = dayData.totalSuppliedUSD - dayData.totalBorrowedUSD;

                return {
                    date: dayData.date,
                    timestamp: dayData.timestamp,
                    portfolioValue,
                    totalSupplied: dayData.totalSupplied,
                    totalBorrowed: dayData.totalBorrowed,
                    portfolioValueUSD: portfolioValueUSD.toFixed(4),
                    totalSuppliedUSD: dayData.totalSuppliedUSD.toFixed(4),
                    totalBorrowedUSD: dayData.totalBorrowedUSD.toFixed(4),
                    assets: Array.from(dayData.assets.values()).map(assetData => {
                        const netPosition = assetData.supplied - assetData.borrowed;
                        const netPositionUSD = assetData.suppliedUSD - assetData.borrowedUSD;
                        return {
                            asset: assetData.asset,
                            supplied: assetData.supplied,
                            borrowed: assetData.borrowed,
                            netPosition,
                            suppliedUSD: assetData.suppliedUSD.toFixed(4),
                            borrowedUSD: assetData.borrowedUSD.toFixed(4),
                            netPositionUSD: netPositionUSD.toFixed(4),
                            assetPrice: assetData.assetPrice?.toString(), // Oracle price (8 decimals)
                            assetPriceTimestamp: assetData.assetPriceTimestamp // Timestamp when the price was recorded
                        };
                    })
                };
            })
            .sort((a, b) => a.timestamp - b.timestamp);

        return {
            dailyValues
        };

    } catch (error) {
        console.error(`❌ Error in calculateUserDailyPortfolioValue for user ${user}:`, error);
        throw error;
    }
}


