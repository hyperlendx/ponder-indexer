/**
 * Segmented yield and borrow-cost calculations for one (user, asset) over a
 * period. Everything is evaluated in memory from a pre-loaded
 * UserAssetActivity, a ReserveIndexSeries and a PriceSeries.
 */
import {calculateActualBalance} from "../aave/balanceConversions";
import {calculateUSDValueNumber} from "../usdCalculations";
import {
    type UserAssetActivity,
    recordedScaledBalanceAt,
    liquidationReducesRecordedBalance,
} from "./userAssetActivity";
import type {ReserveIndexSeries} from "./reserveIndexSeries";
import type {PriceSeries} from "./priceSeries";

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Pre-loaded inputs for all calculations on one (user, asset) pair.
 */
export interface AssetYieldContext {
    activity: UserAssetActivity;
    series: ReserveIndexSeries;
    prices: PriceSeries;
}

export interface YieldSegment {
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
    assetPrice: string; // Oracle price used for this segment (8 decimals)
    assetPriceTimestamp: number; // Timestamp of the price snapshot used (0 when unavailable)
}

export interface BorrowCostSegment {
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
    assetPrice: string; // Oracle price used for this segment (8 decimals)
    assetPriceTimestamp: number; // Timestamp of the price snapshot used (0 when unavailable)
}

function sameAddress(a: string | null | undefined, b: string): boolean {
    return !!a && a.toLowerCase() === b.toLowerCase();
}

/**
 * Split [startTimestamp, endTimestamp] into segments of constant scaled supply
 * balance, one boundary per balance-changing event.
 */
export function buildSupplySegments(
    startTimestamp: number,
    endTimestamp: number,
    startBalance: bigint,
    events: Array<{ timestamp: number; scaledBalance: bigint }>
): Array<{ startTime: number; endTime: number; scaledBalance: bigint }> {
    const segments: Array<{ startTime: number; endTime: number; scaledBalance: bigint }> = [];
    let currentTime = startTimestamp;
    let currentBalance = startBalance;

    for (const event of events) {
        if (event.timestamp > currentTime) {
            segments.push({startTime: currentTime, endTime: event.timestamp, scaledBalance: currentBalance});
            currentTime = event.timestamp;
        }
        // Balance after this event
        currentBalance = event.scaledBalance;
    }

    if (currentTime < endTimestamp) {
        segments.push({startTime: currentTime, endTime: endTimestamp, scaledBalance: currentBalance});
    }

    return segments;
}

/**
 * Split [startTimestamp, endTimestamp] into segments of constant scaled borrow
 * balance. Segments with a zero balance are omitted.
 */
export function buildBorrowSegments(
    startTimestamp: number,
    endTimestamp: number,
    startScaledBorrowBalance: bigint,
    events: Array<{ timestamp: number; amount: bigint; eventType: 'borrow' | 'repay' }>
): Array<{ startTime: number; endTime: number; scaledBorrowBalance: bigint }> {
    const segments: Array<{ startTime: number; endTime: number; scaledBorrowBalance: bigint }> = [];

    if (events.length === 0) {
        if (startScaledBorrowBalance > 0n) {
            segments.push({startTime: startTimestamp, endTime: endTimestamp, scaledBorrowBalance: startScaledBorrowBalance});
        }
        return segments;
    }

    let currentScaledBalance = startScaledBorrowBalance;
    let previousTime = startTimestamp;

    for (const event of events) {
        if (event.timestamp > previousTime && currentScaledBalance > 0n) {
            segments.push({startTime: previousTime, endTime: event.timestamp, scaledBorrowBalance: currentScaledBalance});
        }
        if (event.eventType === 'borrow') {
            currentScaledBalance += event.amount;
        } else {
            currentScaledBalance -= event.amount;
        }
        previousTime = event.timestamp;
    }

    if (previousTime < endTimestamp && currentScaledBalance > 0n) {
        segments.push({startTime: previousTime, endTime: endTimestamp, scaledBorrowBalance: currentScaledBalance});
    }

    return segments;
}

/**
 * Supply-side yield over a custom period, broken into segments of constant
 * scaled balance so every number can be verified by hand:
 * segmentYield = scaledBalance * (endIndex - startIndex) / RAY.
 */
export async function calculateSegmentedCustomPeriodYield(
    ctx: AssetYieldContext,
    startTimestamp: number,
    endTimestamp: number,
    decimals: number
): Promise<{
    totalYield: bigint;
    totalYieldUSD: string;
    segments: YieldSegment[];
}> {
    const {activity, series, prices} = ctx;
    const inPeriod = (timestamp: number) => timestamp >= startTimestamp && timestamp <= endTimestamp;

    // Merge balance events and liquidations once. The previous implementation
    // recalculated the entire balance/liquidation prefix for every liquidation.
    const changes: Array<
        | {timestamp: number; kind: 'balance'; scaledBalance: bigint}
        | {timestamp: number; kind: 'liquidation'; scaledAmount: bigint}
    > = [
        ...activity.balanceEvents
            .filter((event) => inPeriod(Number(event.timestamp)))
            .map((event) => ({
                timestamp: Number(event.timestamp),
                kind: 'balance' as const,
                scaledBalance: BigInt(event.scaledBalance ?? 0n),
            })),
        ...activity.liquidations
            .filter((event) => liquidationReducesRecordedBalance(event, activity.asset) && inPeriod(Number(event.timestamp)))
            .map((event) => ({
                timestamp: Number(event.timestamp),
                kind: 'liquidation' as const,
                scaledAmount: BigInt(event.scaledCollateralAmount ?? 0n),
            })),
    ].sort((a, b) => a.timestamp - b.timestamp);

    let recordedBalance = recordedScaledBalanceAt(activity, startTimestamp - 1);
    let liquidatedBalance = activity.startingScaledCollateralLiquidated;
    const startBalance = recordedBalance > liquidatedBalance ? recordedBalance - liquidatedBalance : 0n;
    const events: Array<{timestamp: number; scaledBalance: bigint}> = [];
    for (const change of changes) {
        if (change.kind === 'balance') recordedBalance = change.scaledBalance;
        else liquidatedBalance += change.scaledAmount;
        events.push({
            timestamp: change.timestamp,
            scaledBalance: recordedBalance > liquidatedBalance ? recordedBalance - liquidatedBalance : 0n,
        });
    }
    const segments = buildSupplySegments(startTimestamp, endTimestamp, startBalance, events);

    await Promise.all([
        series.prefetch(segments.flatMap((s) => [s.startTime, s.endTime])),
        prices.prefetch([
            endTimestamp,
            ...segments.map((s) => Math.floor((s.startTime + s.endTime) / 2)),
        ]),
    ]);

    const currentPricePoint = prices.priceAt(endTimestamp);

    let totalInterest = 0n;
    let totalInterestUSD = 0;
    const detailedSegments: YieldSegment[] = [];

    for (const segment of segments) {
        const [startLiquidityIndex, endLiquidityIndex] = await Promise.all([
            series.liquidityIndexAt(segment.startTime),
            series.liquidityIndexAt(segment.endTime),
        ]);

        let segmentInterest = 0n;
        if (segment.scaledBalance !== 0n && segment.startTime < segment.endTime) {
            segmentInterest =
                calculateActualBalance(segment.scaledBalance, endLiquidityIndex) -
                calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        }
        totalInterest += segmentInterest;

        const actualBalance = calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        const durationDays = (segment.endTime - segment.startTime) / SECONDS_PER_DAY;

        const segmentMidpoint = Math.floor((segment.startTime + segment.endTime) / 2);
        const segmentPricePoint = prices.priceAt(segmentMidpoint);
        const priceToUse = segmentPricePoint.price > 0n ? segmentPricePoint.price : currentPricePoint.price;
        const priceTimestamp = segmentPricePoint.price > 0n
            ? segmentPricePoint.priceTimestamp
            : currentPricePoint.priceTimestamp;

        const segmentYieldUSD = calculateUSDValueNumber(segmentInterest, priceToUse, decimals);
        totalInterestUSD += segmentYieldUSD;

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
            segmentYieldUSD: segmentYieldUSD.toString(),
            durationDays: Math.round(durationDays * 100) / 100,
            assetPrice: priceToUse.toString(),
            assetPriceTimestamp: priceTimestamp,
        });
    }

    return {
        totalYield: totalInterest,
        totalYieldUSD: totalInterestUSD.toString(),
        segments: detailedSegments,
    };
}

/**
 * Borrow-side interest cost over a custom period, segmented by borrow balance
 * changes: segmentCost = scaledBorrow * (endIndex - startIndex) / RAY.
 * Liquidations of this asset's debt count as forced repayments.
 */
export async function calculateSegmentedCustomPeriodBorrowCost(
    ctx: AssetYieldContext,
    startTimestamp: number,
    endTimestamp: number,
    decimals: number
): Promise<{
    totalBorrowCost: bigint;
    totalBorrowCostUSD: string;
    segments: BorrowCostSegment[];
}> {
    const {activity, series, prices} = ctx;
    const inPeriod = (timestamp: number) => timestamp >= startTimestamp && timestamp <= endTimestamp;

    const events: Array<{ timestamp: number; amount: bigint; eventType: 'borrow' | 'repay' }> = [
        ...activity.borrows
            .filter((e) => inPeriod(Number(e.timestamp)))
            .map((e) => ({timestamp: Number(e.timestamp), amount: BigInt(e.scaledAmount ?? 0n), eventType: 'borrow' as const})),
        ...activity.repays
            .filter((e) => inPeriod(Number(e.timestamp)))
            .map((e) => ({timestamp: Number(e.timestamp), amount: BigInt(e.scaledAmount ?? 0n), eventType: 'repay' as const})),
        ...activity.liquidations
            .filter((l) => sameAddress(l.debtAsset, activity.asset) && inPeriod(Number(l.timestamp)))
            .map((l) => ({timestamp: Number(l.timestamp), amount: BigInt(l.scaledDebtToCover ?? 0n), eventType: 'repay' as const})),
    ].sort((a, b) => a.timestamp - b.timestamp);

    const startScaledBorrowBalance = activity.startingScaledBorrowBalance > 0n
        ? activity.startingScaledBorrowBalance
        : 0n;
    const segments = buildBorrowSegments(startTimestamp, endTimestamp, startScaledBorrowBalance, events);

    await Promise.all([
        series.prefetch(segments.flatMap((s) => [s.startTime, s.endTime])),
        prices.prefetch([
            endTimestamp,
            ...segments.map((s) => Math.floor((s.startTime + s.endTime) / 2)),
        ]),
    ]);

    const currentPricePoint = prices.priceAt(endTimestamp);

    let totalBorrowCost = 0n;
    let totalBorrowCostUSD = 0;
    const detailedSegments: BorrowCostSegment[] = [];

    for (const segment of segments) {
        const [startBorrowIndex, endBorrowIndex] = await Promise.all([
            series.variableBorrowIndexAt(segment.startTime),
            series.variableBorrowIndexAt(segment.endTime),
        ]);

        let segmentBorrowCost = 0n;
        if (segment.scaledBorrowBalance !== 0n && segment.startTime < segment.endTime) {
            segmentBorrowCost =
                calculateActualBalance(segment.scaledBorrowBalance, endBorrowIndex) -
                calculateActualBalance(segment.scaledBorrowBalance, startBorrowIndex);
        }
        totalBorrowCost += segmentBorrowCost;

        const actualBorrowBalance = calculateActualBalance(segment.scaledBorrowBalance, startBorrowIndex);
        const durationDays = (segment.endTime - segment.startTime) / SECONDS_PER_DAY;

        const segmentMidpoint = Math.floor((segment.startTime + segment.endTime) / 2);
        const segmentPricePoint = prices.priceAt(segmentMidpoint);
        const priceToUse = segmentPricePoint.price > 0n ? segmentPricePoint.price : currentPricePoint.price;
        const priceTimestamp = segmentPricePoint.price > 0n
            ? segmentPricePoint.priceTimestamp
            : currentPricePoint.priceTimestamp;

        const segmentBorrowCostUSD = calculateUSDValueNumber(segmentBorrowCost, priceToUse, decimals);
        totalBorrowCostUSD += segmentBorrowCostUSD;

        detailedSegments.push({
            startTime: segment.startTime,
            endTime: segment.endTime,
            startDate: new Date(segment.startTime * 1000).toISOString(),
            endDate: new Date(segment.endTime * 1000).toISOString(),
            scaledBorrowBalance: segment.scaledBorrowBalance,
            actualBorrowBalance,
            startBorrowIndex,
            endBorrowIndex,
            segmentBorrowCost,
            segmentBorrowCostUSD: segmentBorrowCostUSD.toString(),
            durationDays: Math.round(durationDays * 100) / 100,
            assetPrice: priceToUse.toString(),
            assetPriceTimestamp: priceTimestamp,
        });
    }

    return {
        totalBorrowCost,
        totalBorrowCostUSD: totalBorrowCostUSD.toString(),
        segments: detailedSegments,
    };
}
