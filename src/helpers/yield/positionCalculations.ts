/**
 * Position Calculations for Custom Time Periods
 *
 * Yield positions (supply and borrow) for a user over a custom period with
 * accrued interest, activity totals and per-segment breakdowns.
 *
 * Per asset this issues a fixed, small number of queries (the user's own rows,
 * bounded price snapshots, and the reserve index anchors for the period) and
 * evaluates everything else in memory.
 */
import {calculateActualBalance} from "../aave/balanceConversions";
import {calculateUSDValueNumber} from "../usdCalculations";
import {
    type EventDetail,
    discoverUserAssets,
    loadUserAssetActivity,
    isActiveInPeriod,
    recordedScaledBalanceAt,
    recordedBorrowBalanceAt,
    formatBalanceEvents,
    formatBorrowEvents,
} from "./userAssetActivity";
import {ReserveIndexSeries} from "./reserveIndexSeries";
import {loadPriceSeries} from "./priceSeries";
import {
    type AssetYieldContext,
    calculateSegmentedCustomPeriodYield,
    calculateSegmentedCustomPeriodBorrowCost,
} from "./yieldCalculations";

export type {EventDetail} from "./userAssetActivity";

/**
 * Yield segment detail for transparency and manual verification
 */
export interface YieldSegmentDetail {
    startTime: number;
    endTime: number;
    startDate: string;
    endDate: string;
    scaledBalance: bigint;
    actualBalance: bigint;
    startLiquidityIndex: bigint;
    endLiquidityIndex: bigint;
    segmentYield: bigint;
    segmentYieldUSD: string; // USD value of yield for this segment
    durationDays: number;
    assetPrice: string; // Oracle price of the asset during this segment (8 decimals precision)
    assetPriceTimestamp: number; // Timestamp of the price snapshot used (0 when falling back to an event price)
}

/**
 * Borrow cost segment detail for transparency and manual verification
 */
export interface BorrowCostSegmentDetail {
    startTime: number;
    endTime: number;
    startDate: string;
    endDate: string;
    scaledBorrowBalance: bigint;
    actualBorrowBalance: bigint;
    startBorrowIndex: bigint;
    endBorrowIndex: bigint;
    segmentBorrowCost: bigint;
    segmentBorrowCostUSD: string; // USD value of borrow cost for this segment
    durationDays: number;
    assetPrice: string; // Oracle price of the asset during this segment (8 decimals precision)
    assetPriceTimestamp: number; // Timestamp of the price snapshot used (0 when falling back to an event price)
}

/**
 * Simplified yield position with activity metrics, yield calculations, and detailed breakdowns
 */
export interface SimplifiedYieldPosition {
    asset: string;
    totalYieldEarned: bigint;
    totalBorrowCost: bigint;
    totalDeposited: bigint;
    totalWithdrawn: bigint;
    totalBorrowed: bigint;
    totalRepaid: bigint;
    totalScaledDeposited: bigint;
    totalScaledBorrowed: bigint;
    totalRawDeposited: bigint;  // Sum of raw deposit transaction amounts (from Supply events)
    totalRawBorrowed: bigint;   // Sum of raw borrow transaction amounts (from Borrow events)
    netDeposits: bigint;
    netBorrows: bigint;
    // USD values calculated using historical oracle prices
    totalDepositedUSD: string;
    totalWithdrawnUSD: string;
    totalBorrowedUSD: string;
    totalRepaidUSD: string;
    totalYieldEarnedUSD: string;
    totalBorrowCostUSD: string;
    totalRawDepositedUSD: string;   // USD value of total raw deposits
    totalRawBorrowedUSD: string;    // USD value of total raw borrows
    totalScaledDepositedUSD: string; // USD value of total scaled deposits
    totalScaledBorrowedUSD: string;  // USD value of total scaled borrows
    events: EventDetail[];
    events_before_period: EventDetail[];
    starting_balances: {
        deposits: bigint;
        borrows: bigint;
        scaledDeposits: bigint;
        scaledBorrows: bigint;
        rawDeposits: bigint;
        rawBorrows: bigint;
    };
    yieldSegments: YieldSegmentDetail[];
    borrowCostSegments: BorrowCostSegmentDetail[];
}

/**
 * Calculate simplified yield positions with activity metrics and detailed yield breakdown
 *
 * IMPORTANT: Activity metrics show total capital active during the period:
 * - totalDeposited = supply balance at START of period + deposits DURING period
 * - totalWithdrawn = withdrawals DURING period
 * - totalBorrowed = borrow balance at START of period + borrows DURING period
 * - totalRepaid = repayments DURING period
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the time period (Unix timestamp)
 * @param endTimestamp - End of the time period (Unix timestamp)
 * @returns Array of simplified yield position data with detailed breakdowns
 */
export async function calculateUserYieldPositions(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<SimplifiedYieldPosition[]> {
    const assets = await discoverUserAssets(context, user);
    if (assets.length === 0) {
        return [];
    }

    const positions = await Promise.all(
        assets.map(async (asset): Promise<SimplifiedYieldPosition | null> => {
            const [activity, prices] = await Promise.all([
                loadUserAssetActivity(context, user, asset, endTimestamp),
                loadPriceSeries(context, asset, startTimestamp, endTimestamp),
            ]);
            const series = new ReserveIndexSeries(context, asset);

            if (!(await isActiveInPeriod(activity, startTimestamp, endTimestamp, series))) {
                return null;
            }

            return buildYieldPosition({activity, series, prices}, startTimestamp, endTimestamp);
        })
    );

    // Filter to only positions with activity during the period
    return positions
        .filter((pos): pos is SimplifiedYieldPosition => pos !== null)
        .filter(
            (pos) =>
                pos.totalDeposited > 0n ||
                pos.totalWithdrawn > 0n ||
                pos.totalBorrowed > 0n ||
                pos.totalRepaid > 0n
        );
}

async function buildYieldPosition(
    ctx: AssetYieldContext,
    startTimestamp: number,
    endTimestamp: number
): Promise<SimplifiedYieldPosition> {
    const {activity, series, prices} = ctx;
    const asset = activity.asset;
    const decimals = prices.decimals;
    const inPeriod = (timestamp: number | null) =>
        Number(timestamp) >= startTimestamp && Number(timestamp) <= endTimestamp;
    const beforeStart = (timestamp: number | null) => Number(timestamp) <= startTimestamp;

    // Events during the period
    const depositEvents = activity.balanceEvents.filter((e) => e.eventType === 'deposit' && inPeriod(e.timestamp));
    const withdrawEvents = activity.balanceEvents.filter((e) => e.eventType === 'withdraw' && inPeriod(e.timestamp));
    const borrowEvents = activity.borrows.filter((e) => inPeriod(e.timestamp));
    const repayEvents = activity.repays.filter((e) => inPeriod(e.timestamp));
    const liquidationEvents = activity.liquidations.filter((e) => inPeriod(e.timestamp));
    // Raw transaction events for totalRawDeposited/totalRawBorrowed
    const supplyEvents = activity.supplies.filter((e) => inPeriod(e.timestamp));
    const withdrawRawEvents = activity.withdraws.filter((e) => inPeriod(e.timestamp));
    // Raw transaction events before the period for starting raw balances
    const supplyEventsBeforeStart = activity.supplies.filter((e) => beforeStart(e.timestamp));
    const withdrawEventsBeforeStart = activity.withdraws.filter((e) => beforeStart(e.timestamp));
    const borrowEventsBeforeStart = activity.borrows.filter((e) => beforeStart(e.timestamp));
    const repayEventsBeforeStart = activity.repays.filter((e) => beforeStart(e.timestamp));

    // Resolve every reserve index this position needs in one batch
    await series.prefetch([
        startTimestamp,
        endTimestamp,
        ...activity.balanceEvents.filter((e) => inPeriod(e.timestamp)).map((e) => Number(e.timestamp)),
        ...borrowEvents.map((e) => Number(e.timestamp)),
        ...repayEvents.map((e) => Number(e.timestamp)),
        ...activity.liquidations.map((e) => Number(e.timestamp)),
    ]);

    // Starting balances as recorded (capital already active at period start) and the events behind them
    const startScaledSupplyBalance = recordedScaledBalanceAt(activity, startTimestamp);
    const startScaledBorrowBalance = recordedBorrowBalanceAt(activity, startTimestamp);
    const startLiquidityIndex = await series.liquidityIndexAt(startTimestamp);
    const startBorrowIndex = await series.variableBorrowIndexAt(startTimestamp);

    const startSupplyBalance = calculateActualBalance(startScaledSupplyBalance, startLiquidityIndex);
    const startBorrowBalance = calculateActualBalance(startScaledBorrowBalance, startBorrowIndex);

    const events_before_period: EventDetail[] = [
        ...formatBalanceEvents(activity, startTimestamp),
        ...formatBorrowEvents(activity, startTimestamp),
    ].sort((a, b) => a.timestamp - b.timestamp);

    // Segmented yield and borrow cost
    const yieldResult = await calculateSegmentedCustomPeriodYield(ctx, startTimestamp, endTimestamp, decimals);
    const borrowCostResult = await calculateSegmentedCustomPeriodBorrowCost(ctx, startTimestamp, endTimestamp, decimals);

    // Initialize totals with starting balances (actual amounts with liquidity index applied)
    let totalDeposited = startSupplyBalance;
    let totalBorrowed = startBorrowBalance;
    let totalWithdrawn = 0n;
    let totalRepaid = 0n;

    let totalDepositedUSD = 0;
    let totalWithdrawnUSD = 0;
    let totalBorrowedUSD = 0;
    let totalRepaidUSD = 0;
    let totalScaledDepositedUSD = 0;
    let totalScaledBorrowedUSD = 0;

    // Scaled totals (raw transaction amounts, consistent across query periods)
    let totalScaledDeposited = startScaledSupplyBalance;
    let totalScaledBorrowed = startScaledBorrowBalance;

    // Starting raw balances (from events before period start)
    let startRawDeposits = 0n;
    let startRawBorrows = 0n;
    for (const event of supplyEventsBeforeStart) startRawDeposits += BigInt(event.amount ?? 0n);
    for (const event of withdrawEventsBeforeStart) startRawDeposits -= BigInt(event.amount ?? 0n);
    for (const event of borrowEventsBeforeStart) startRawBorrows += BigInt(event.amount ?? 0n);
    for (const event of repayEventsBeforeStart) startRawBorrows -= BigInt(event.amount ?? 0n);

    // Raw transaction amounts during the period
    let totalRawDeposited = 0n;
    let totalRawBorrowed = 0n;
    let totalRawDepositedUSD = 0;
    let totalRawBorrowedUSD = 0;

    for (const event of supplyEvents) {
        const amount = BigInt(event.amount ?? 0n);
        totalRawDeposited += amount;
        if (event.price) {
            totalRawDepositedUSD += calculateUSDValueNumber(amount, event.price, decimals);
        }
    }
    for (const event of withdrawRawEvents) {
        const amount = BigInt(event.amount ?? 0n);
        totalRawDeposited -= amount;
        if (event.price) {
            totalRawDepositedUSD -= calculateUSDValueNumber(amount, event.price, decimals);
        }
    }
    for (const event of borrowEvents) {
        const amount = BigInt(event.amount ?? 0n);
        totalRawBorrowed += amount;
        if (event.price) {
            totalRawBorrowedUSD += calculateUSDValueNumber(amount, event.price, decimals);
        }
    }
    for (const event of repayEvents) {
        const amount = BigInt(event.amount ?? 0n);
        totalRawBorrowed -= amount;
        if (event.price) {
            totalRawBorrowedUSD -= calculateUSDValueNumber(amount, event.price, decimals);
        }
    }

    const events: EventDetail[] = [];

    for (const event of depositEvents) {
        const transactionAmount = BigInt(event.transactionAmount ?? 0n);
        const actualAmount = calculateActualBalance(transactionAmount, BigInt(event.liquidityIndex ?? 0n));
        totalDeposited += actualAmount;
        totalScaledDeposited += transactionAmount;

        if (event.assetPrice) {
            totalDepositedUSD += calculateUSDValueNumber(actualAmount, event.assetPrice, decimals);
            totalScaledDepositedUSD += calculateUSDValueNumber(transactionAmount, event.assetPrice, decimals);
        }

        events.push({
            eventType: 'deposit',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: actualAmount.toString(),
            txHash: event.txHash as string,
            assetPrice: event.assetPrice?.toString(),
        });
    }

    for (const event of withdrawEvents) {
        const transactionAmount = BigInt(event.transactionAmount ?? 0n);
        const actualAmount = calculateActualBalance(transactionAmount, BigInt(event.liquidityIndex ?? 0n));
        totalWithdrawn += actualAmount;

        if (event.assetPrice) {
            totalWithdrawnUSD += calculateUSDValueNumber(actualAmount, event.assetPrice, decimals);
            // totalScaledDeposited is cumulative (not net), so its USD counterpart is too
        }

        events.push({
            eventType: 'withdraw',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: actualAmount.toString(),
            txHash: event.txHash as string,
            assetPrice: event.assetPrice?.toString(),
        });
    }

    for (const event of borrowEvents) {
        const amount = BigInt(event.amount ?? 0n);
        totalBorrowed += amount;
        totalScaledBorrowed += amount;

        if (event.price) {
            totalBorrowedUSD += calculateUSDValueNumber(amount, event.price, decimals);
            totalScaledBorrowedUSD += calculateUSDValueNumber(amount, event.price, decimals);
        }

        events.push({
            eventType: 'borrow',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: amount.toString(),
            txHash: event.txHash as string,
            assetPrice: event.price?.toString(),
        });
    }

    for (const event of repayEvents) {
        const amount = BigInt(event.amount ?? 0n);
        totalRepaid += amount;

        if (event.price) {
            totalRepaidUSD += calculateUSDValueNumber(amount, event.price, decimals);
            // totalScaledBorrowed is cumulative (not net), so its USD counterpart is too
        }

        events.push({
            eventType: 'repay',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: amount.toString(),
            txHash: event.txHash as string,
            assetPrice: event.price?.toString(),
        });
    }

    // Liquidations affect both collateral (forced withdrawal) and debt (forced repayment)
    for (const liquidation of liquidationEvents) {
        if (liquidation.collateralAsset?.toLowerCase() === asset.toLowerCase()) {
            const amount = BigInt(liquidation.liquidatedCollateralAmount ?? 0n);
            totalWithdrawn += amount;
            events.push({
                eventType: 'liquidation_collateral' as any,
                timestamp: Number(liquidation.timestamp),
                date: new Date(Number(liquidation.timestamp) * 1000).toISOString(),
                amount: amount.toString(),
                txHash: liquidation.txHash as string,
            });
        }

        if (liquidation.debtAsset?.toLowerCase() === asset.toLowerCase()) {
            const amount = BigInt(liquidation.debtToCover ?? 0n);
            totalRepaid += amount;
            events.push({
                eventType: 'liquidation_debt' as any,
                timestamp: Number(liquidation.timestamp),
                date: new Date(Number(liquidation.timestamp) * 1000).toISOString(),
                amount: amount.toString(),
                txHash: liquidation.txHash as string,
            });
        }
    }

    events.sort((a, b) => a.timestamp - b.timestamp);

    const netDeposits = totalDeposited - totalWithdrawn;
    const netBorrows = totalBorrowed - totalRepaid;

    return {
        asset,
        totalYieldEarned: yieldResult.totalYield,
        totalBorrowCost: borrowCostResult.totalBorrowCost,
        totalDeposited,
        totalWithdrawn,
        totalBorrowed,
        totalRepaid,
        totalScaledDeposited,
        totalScaledBorrowed,
        totalRawDeposited,
        totalRawBorrowed,
        netDeposits,
        netBorrows,
        totalDepositedUSD: totalDepositedUSD.toFixed(4),
        totalWithdrawnUSD: totalWithdrawnUSD.toFixed(4),
        totalBorrowedUSD: totalBorrowedUSD.toFixed(4),
        totalRepaidUSD: totalRepaidUSD.toFixed(4),
        totalYieldEarnedUSD: yieldResult.totalYieldUSD,
        totalBorrowCostUSD: borrowCostResult.totalBorrowCostUSD,
        totalRawDepositedUSD: totalRawDepositedUSD.toFixed(4),
        totalRawBorrowedUSD: totalRawBorrowedUSD.toFixed(4),
        totalScaledDepositedUSD: totalScaledDepositedUSD.toFixed(4),
        totalScaledBorrowedUSD: totalScaledBorrowedUSD.toFixed(4),
        events,
        events_before_period,
        starting_balances: {
            deposits: startSupplyBalance,
            borrows: startBorrowBalance,
            scaledDeposits: startScaledSupplyBalance,
            scaledBorrows: startScaledBorrowBalance,
            rawDeposits: startRawDeposits,
            rawBorrows: startRawBorrows,
        },
        yieldSegments: yieldResult.segments,
        borrowCostSegments: borrowCostResult.segments,
    };
}
