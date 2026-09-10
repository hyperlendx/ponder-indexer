/**
 * Daily reports: yield breakdown and portfolio value per UTC day.
 *
 * Per asset this loads a bounded activity window plus starting aggregates,
 * sparse price points, and reserve-index anchors, then evaluates all days in
 * one chronological pass.
 */
import {calculateActualBalance} from "../aave";
import {calculateUSDValueNumber} from "../usdCalculations";
import {
    type UserAssetActivity,
    loadUserAssetActivity,
    isActiveInPeriod,
    liquidationReducesRecordedBalance,
} from "./userAssetActivity";
import {ReserveIndexSeries} from "./reserveIndexSeries";
import {loadPriceSeries} from "./priceSeries";
import {USDC_ADDRESS} from "../usdc";
import {
    type AssetYieldContext,
    calculateSegmentedCustomPeriodYield,
    calculateSegmentedCustomPeriodBorrowCost,
} from "./yieldCalculations";

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Calendar-day samples intersecting the half-open report range [start, end). */
export function buildReportDayEnds(startTimestamp: number, endTimestamp: number): Array<{
    date: string;
    timestamp: number;
}> {
    if (endTimestamp <= startTimestamp) return [];

    const firstDayStart = Math.floor(startTimestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    const lastDayStart = Math.floor((endTimestamp - 1) / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    const days: Array<{date: string; timestamp: number}> = [];
    for (let dayStart = firstDayStart; dayStart <= lastDayStart; dayStart += SECONDS_PER_DAY) {
        days.push({
            date: new Date(dayStart * 1000).toISOString().split('T')[0]!,
            timestamp: Math.min(dayStart + SECONDS_PER_DAY - 1, endTimestamp),
        });
    }
    return days;
}

/**
 * Load the inputs for every asset the user was active in during the period.
 */
async function loadActiveAssetContexts(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<AssetYieldContext[]> {
    const asset = USDC_ADDRESS;
    const [activity, prices] = await Promise.all([
        loadUserAssetActivity(context, user, asset, endTimestamp, {
            includeRawActivity: false,
            startTimestamp,
        }),
        loadPriceSeries(context, asset),
    ]);
    const series = new ReserveIndexSeries(context, asset);
    if (!isActiveInPeriod(activity, startTimestamp, endTimestamp)) return [];
    return [{activity, series, prices}];
}

/** Every timestamp of the user's activity in this asset, for index prefetching */
function activityTimestamps(activity: UserAssetActivity): number[] {
    return [
        ...activity.balanceEvents.map((e) => Number(e.timestamp)),
        ...activity.borrows.map((e) => Number(e.timestamp)),
        ...activity.repays.map((e) => Number(e.timestamp)),
        ...activity.liquidations.map((e) => Number(e.timestamp)),
    ];
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

interface DailyAssetBucket {
    asset: string;
    assetPrice?: bigint;
    assetPriceTimestamp?: number;
    assetYield: bigint;
    borrowCost: bigint;
    netYield: bigint;
    assetYieldUSD: number;
    borrowCostUSD: number;
    netYieldUSD: number;
    segments: DailyYieldData['assets'][number]['segments'];
    borrowSegments: DailyYieldData['assets'][number]['borrowSegments'];
}

interface DailyBucket {
    date: string;
    timestamp: number;
    assetYield: bigint;
    borrowCost: bigint;
    netYield: bigint;
    assetYieldUSD: number;
    borrowCostUSD: number;
    netYieldUSD: number;
    assets: Map<string, DailyAssetBucket>;
}

function emptyAssetBucket(asset: string): DailyAssetBucket {
    return {
        asset,
        assetYield: 0n,
        borrowCost: 0n,
        netYield: 0n,
        assetYieldUSD: 0,
        borrowCostUSD: 0,
        netYieldUSD: 0,
        segments: [],
        borrowSegments: [],
    };
}

/**
 * The UTC days a segment overlaps, clipped to the segment and report end.
 * Days are keyed by YYYY-MM-DD; days without a bucket are skipped by the caller.
 */
function splitSegmentByDay(
    startTime: number,
    endTime: number,
    reportEndTimestamp: number
): Array<{ dateStr: string; overlapStart: number; overlapEnd: number }> {
    const segmentStartDate = new Date(startTime * 1000);
    const segmentEndDate = new Date(endTime * 1000);
    const segmentDays = Math.ceil((segmentEndDate.getTime() - segmentStartDate.getTime()) / (SECONDS_PER_DAY * 1000)) + 1;

    const overlaps: Array<{ dateStr: string; overlapStart: number; overlapEnd: number }> = [];
    for (let dayOffset = 0; dayOffset < segmentDays; dayOffset++) {
        const currentDate = new Date(segmentStartDate);
        currentDate.setUTCDate(segmentStartDate.getUTCDate() + dayOffset);
        const dateStr = currentDate.toISOString().split('T')[0]!;

        const dayStart = Math.floor(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) / 1000);
        // Full 86,400-second days with half-open interval [dayStart, dayEnd), capped at the period end
        let dayEnd = dayStart + SECONDS_PER_DAY;
        if (dayEnd > reportEndTimestamp) {
            dayEnd = reportEndTimestamp;
        }
        const overlapStart = Math.max(startTime, dayStart);
        const overlapEnd = Math.min(endTime, dayEnd);

        if (overlapEnd > overlapStart) {
            overlaps.push({dateStr, overlapStart, overlapEnd});
        }
    }
    return overlaps;
}

/**
 * Calculate daily yield breakdown for a specific user over a custom time period
 * Returns yield data broken down by individual days for charting/graphing purposes
 *
 * Note on precision: Daily yields are calculated with AAVE-compatible rounding at each
 * day boundary. This introduces a small cumulative rounding difference (~0.0002% or 2 ppm)
 * compared to calculating the entire period at once. This is expected behavior and maintains
 * consistency with AAVE's onchain rounding semantics. Each day uses half-open intervals
 * [dayStart, dayEnd) where each day is exactly 86,400 seconds (24 hours).
 *
 * **Partial Day Support:** If endTimestamp is not at a day boundary (midnight UTC),
 * the last day's yield is calculated up to endTimestamp.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Object with dailyValues (one entry per day in the period)
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
        const assetContexts = await loadActiveAssetContexts(context, user, startTimestamp, endTimestamp);
        if (assetContexts.length === 0) {
            return {
                dailyValues: [],
                currentValue: undefined
            };
        }

        // Daily buckets (including the partial last day)
        const dailyResults = new Map<string, DailyBucket>();
        for (const day of buildReportDayEnds(startTimestamp, endTimestamp)) {
            dailyResults.set(day.date, {
                date: day.date,
                timestamp: day.timestamp,
                assetYield: 0n,
                borrowCost: 0n,
                netYield: 0n,
                assetYieldUSD: 0,
                borrowCostUSD: 0,
                netYieldUSD: 0,
                assets: new Map()
            });
        }

        // Day boundaries every asset will need indices for
        const dayBoundaries: number[] = [startTimestamp, endTimestamp];
        for (const day of dailyResults.values()) {
            const dayStart = Math.floor(Date.UTC(
                new Date(day.timestamp * 1000).getUTCFullYear(),
                new Date(day.timestamp * 1000).getUTCMonth(),
                new Date(day.timestamp * 1000).getUTCDate()
            ) / 1000);
            dayBoundaries.push(dayStart, Math.min(dayStart + SECONDS_PER_DAY, endTimestamp));
        }

        for (const ctx of assetContexts) {
            const {activity, series, prices} = ctx;
            const asset = activity.asset;
            try {
                const decimals = prices.decimals;

                // Resolve every index and price needed for this asset in bounded batches.
                const reportTimestamps = [
                    ...dayBoundaries,
                    ...Array.from(dailyResults.values(), (day) => day.timestamp),
                    ...activityTimestamps(activity),
                ];
                await Promise.all([
                    series.prefetch(reportTimestamps),
                    prices.prefetch(reportTimestamps),
                ]);

                // Initialize this asset in all days with zero yield
                for (const dayData of dailyResults.values()) {
                    if (!dayData.assets.has(asset)) {
                        const priceInfo = prices.priceAt(dayData.timestamp);
                        const bucket = emptyAssetBucket(asset);
                        bucket.assetPrice = priceInfo.priceTimestamp !== 0 ? priceInfo.price : undefined;
                        bucket.assetPriceTimestamp = priceInfo.priceTimestamp !== 0 ? priceInfo.priceTimestamp : undefined;
                        dayData.assets.set(asset, bucket);
                    }
                }

                const segmentedResult = await calculateSegmentedCustomPeriodYield(ctx, startTimestamp, endTimestamp, decimals);
                const borrowCostResult = await calculateSegmentedCustomPeriodBorrowCost(ctx, startTimestamp, endTimestamp, decimals);

                // Assign supply yield to days
                for (const segment of segmentedResult.segments) {
                    const segmentStartDay = new Date(segment.startTime * 1000).toISOString().split('T')[0]!;
                    const segmentEndDay = new Date(segment.endTime * 1000).toISOString().split('T')[0]!;

                    if (segmentStartDay === segmentEndDay) {
                        // Segment is within a single day
                        const dayData = dailyResults.get(segmentStartDay);
                        if (dayData) {
                            dayData.assetYield += segment.segmentYield;
                            if (!dayData.assets.has(asset)) dayData.assets.set(asset, emptyAssetBucket(asset));
                            const assetData = dayData.assets.get(asset)!;
                            assetData.assetYield += segment.segmentYield;

                            const priceData = prices.priceAt(segment.endTime);
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
                        // Segment spans multiple days: exact yield per day from the index at each boundary
                        const overlaps = splitSegmentByDay(segment.startTime, segment.endTime, endTimestamp)
                            .filter(({dateStr}) => dailyResults.has(dateStr));
                        await series.prefetch(overlaps.flatMap((o) => [o.overlapStart, o.overlapEnd]));

                        for (const {dateStr, overlapStart, overlapEnd} of overlaps) {
                            const dayData = dailyResults.get(dateStr)!;
                            const startIndex = await series.liquidityIndexAt(overlapStart);
                            const endIndex = await series.liquidityIndexAt(overlapEnd);

                            const startBalance = calculateActualBalance(segment.scaledBalance, startIndex);
                            const endBalance = calculateActualBalance(segment.scaledBalance, endIndex);
                            const actualYield = endBalance - startBalance;

                            dayData.assetYield += actualYield;
                            if (!dayData.assets.has(asset)) dayData.assets.set(asset, emptyAssetBucket(asset));
                            const assetData = dayData.assets.get(asset)!;
                            assetData.assetYield += actualYield;

                            const priceData = prices.priceAt(overlapEnd);
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

                // Assign borrow cost to days
                for (const segment of borrowCostResult.segments) {
                    const segmentStartDay = new Date(segment.startTime * 1000).toISOString().split('T')[0]!;
                    const segmentEndDay = new Date(segment.endTime * 1000).toISOString().split('T')[0]!;

                    if (segmentStartDay === segmentEndDay) {
                        const dayData = dailyResults.get(segmentStartDay);
                        if (dayData) {
                            dayData.borrowCost += segment.segmentBorrowCost;
                            if (!dayData.assets.has(asset)) dayData.assets.set(asset, emptyAssetBucket(asset));
                            const assetData = dayData.assets.get(asset)!;
                            assetData.borrowCost += segment.segmentBorrowCost;

                            const priceData = prices.priceAt(segment.endTime);
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
                        const overlaps = splitSegmentByDay(segment.startTime, segment.endTime, endTimestamp)
                            .filter(({dateStr}) => dailyResults.has(dateStr));
                        await series.prefetch(overlaps.flatMap((o) => [o.overlapStart, o.overlapEnd]));

                        for (const {dateStr, overlapStart, overlapEnd} of overlaps) {
                            const dayData = dailyResults.get(dateStr)!;
                            const startIndex = await series.variableBorrowIndexAt(overlapStart);
                            const endIndex = await series.variableBorrowIndexAt(overlapEnd);

                            const startBalance = calculateActualBalance(segment.scaledBorrowBalance, startIndex);
                            const endBalance = calculateActualBalance(segment.scaledBorrowBalance, endIndex);
                            const actualBorrowCost = endBalance - startBalance;

                            dayData.borrowCost += actualBorrowCost;
                            if (!dayData.assets.has(asset)) dayData.assets.set(asset, emptyAssetBucket(asset));
                            const assetData = dayData.assets.get(asset)!;
                            assetData.borrowCost += actualBorrowCost;

                            const priceData = prices.priceAt(overlapEnd);
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

                // Net yield per asset and per day
                for (const dayData of dailyResults.values()) {
                    const assetData = dayData.assets.get(asset);
                    if (assetData) {
                        assetData.netYield = assetData.assetYield - assetData.borrowCost;
                        assetData.netYieldUSD = assetData.assetYieldUSD - assetData.borrowCostUSD;
                    }
                }
                for (const dayData of dailyResults.values()) {
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
                    segments: assetData.segments,
                    borrowSegments: assetData.borrowSegments
                }))
            }))
            .sort((a, b) => a.timestamp - b.timestamp);

        return {
            dailyValues: formattedResults as unknown as DailyYieldData[],
        };

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
 * suitable for portfolio value charts and net worth tracking. Values are
 * taken at the END of each day (23:59:59 UTC), or at endTimestamp for a
 * partial last day.
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
        const assetContexts = await loadActiveAssetContexts(context, user, startTimestamp, endTimestamp);
        if (assetContexts.length === 0) {
            return {
                dailyValues: []
            };
        }

        // Daily buckets - portfolio values at END of each day (23:59:59 UTC), or endTimestamp for a partial day
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
                assetPrice?: bigint;
                assetPriceTimestamp?: number;
            }>;
        }>();

        const dayTimestamps: number[] = [];
        for (const day of buildReportDayEnds(startTimestamp, endTimestamp)) {
            dayTimestamps.push(day.timestamp);
            dailyResults.set(day.date, {
                date: day.date,
                timestamp: day.timestamp,
                totalSupplied: 0n,
                totalBorrowed: 0n,
                totalSuppliedUSD: 0,
                totalBorrowedUSD: 0,
                assets: new Map()
            });
        }

        for (const {activity, series, prices} of assetContexts) {
            const asset = activity.asset;
            const balanceEvents = activity.balanceEvents.map((e) => ({
                timestamp: Number(e.timestamp),
                scaledBalance: BigInt(e.scaledBalance ?? 0n),
            }));
            await Promise.all([
                series.prefetch(dayTimestamps),
                prices.prefetch(dayTimestamps),
            ]);

            // Convert actual debt/collateral amounts to scaled deltas once, then
            // advance cursors alongside the ascending day list. This replaces
            // rescanning every event in the report window for every output day.
            const debtDeltas: Array<{timestamp: number; delta: bigint}> = [
                ...activity.borrows.map((event) => ({
                    timestamp: Number(event.timestamp),
                    delta: BigInt(event.scaledAmount ?? 0n),
                })),
                ...activity.repays.map((event) => ({
                    timestamp: Number(event.timestamp),
                    delta: -BigInt(event.scaledAmount ?? 0n),
                })),
                ...activity.liquidations
                    .filter((event) => event.debtAsset?.toLowerCase() === asset.toLowerCase())
                    .map((event) => ({
                        timestamp: Number(event.timestamp),
                        delta: -BigInt(event.scaledDebtToCover ?? 0n),
                    })),
            ];
            debtDeltas.sort((a, b) => a.timestamp - b.timestamp);

            const collateralDeltas = activity.liquidations
                .filter((event) => liquidationReducesRecordedBalance(event, asset))
                .map((event) => ({
                    timestamp: Number(event.timestamp),
                    amount: BigInt(event.scaledCollateralAmount ?? 0n),
                }));

            let balanceCursor = 0;
            let collateralCursor = 0;
            let debtCursor = 0;
            let recordedScaledBalance = 0n;
            let liquidatedScaledBalance = activity.startingScaledCollateralLiquidated;
            let scaledBorrowBalance = activity.startingScaledBorrowBalance;

            for (const dayData of dailyResults.values()) {
                const dayEndTimestamp = dayData.timestamp;

                while (balanceCursor < balanceEvents.length && balanceEvents[balanceCursor]!.timestamp <= dayEndTimestamp) {
                    recordedScaledBalance = balanceEvents[balanceCursor]!.scaledBalance;
                    balanceCursor++;
                }
                while (
                    collateralCursor < collateralDeltas.length &&
                    collateralDeltas[collateralCursor]!.timestamp <= dayEndTimestamp
                ) {
                    liquidatedScaledBalance += collateralDeltas[collateralCursor]!.amount;
                    collateralCursor++;
                }
                while (debtCursor < debtDeltas.length && debtDeltas[debtCursor]!.timestamp <= dayEndTimestamp) {
                    scaledBorrowBalance += debtDeltas[debtCursor]!.delta;
                    debtCursor++;
                }

                const scaledBalance = recordedScaledBalance > liquidatedScaledBalance
                    ? recordedScaledBalance - liquidatedScaledBalance
                    : 0n;
                const liquidityIndex = await series.liquidityIndexAt(dayEndTimestamp);
                const suppliedBalance = calculateActualBalance(scaledBalance, liquidityIndex);

                const variableBorrowIndex = await series.variableBorrowIndexAt(dayEndTimestamp);
                const borrowedBalance = scaledBorrowBalance > 0n
                    ? calculateActualBalance(scaledBorrowBalance, variableBorrowIndex)
                    : 0n;

                const pricePoint = prices.priceAt(dayEndTimestamp);
                const assetPrice = pricePoint.priceTimestamp !== 0 ? pricePoint.price : undefined;
                const assetPriceTimestamp = pricePoint.priceTimestamp !== 0 ? pricePoint.priceTimestamp : undefined;
                const decimals = pricePoint.decimals;

                // Only add to assets map if there's a non-zero position
                if (suppliedBalance > 0n || borrowedBalance > 0n) {
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
                            assetPrice: assetData.assetPrice?.toString(),
                            assetPriceTimestamp: assetData.assetPriceTimestamp
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
