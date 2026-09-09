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
    loadUserAssetActivity,
    isActiveInPeriod,
    scaledBalanceAt,
    formatBalanceEvents,
    formatBorrowEvents,
} from "./userAssetActivity";
import {ReserveIndexSeries} from "./reserveIndexSeries";
import {loadPriceSeries} from "./priceSeries";
import {USDC_ADDRESS} from "../usdc";
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
    assetPriceTimestamp: number; // Timestamp of the price snapshot used (0 when unavailable)
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
    assetPriceTimestamp: number; // Timestamp of the price snapshot used (0 when unavailable)
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
    // This indexer is intentionally USDC-only, so discovering assets with three
    // database queries on every request can never produce additional results.
    const asset = USDC_ADDRESS;
    const [activity, prices] = await Promise.all([
        loadUserAssetActivity(context, user, asset, endTimestamp, {startTimestamp}),
        loadPriceSeries(context, asset),
    ]);
    const series = new ReserveIndexSeries(context, asset);

    if (!isActiveInPeriod(activity, startTimestamp, endTimestamp)) {
        return [];
    }

    const position = await buildYieldPosition({activity, series, prices}, startTimestamp, endTimestamp);
    return [position]
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

    // Events during the period
    const depositEvents = activity.balanceEvents.filter((e) => e.eventType === 'deposit' && inPeriod(e.timestamp));
    const withdrawEvents = activity.balanceEvents.filter((e) => e.eventType === 'withdraw' && inPeriod(e.timestamp));
    const borrowEvents = activity.borrows.filter((e) => inPeriod(e.timestamp));
    const repayEvents = activity.repays.filter((e) => inPeriod(e.timestamp));
    const liquidationEvents = activity.liquidations.filter((e) => inPeriod(e.timestamp));
    // Raw transaction events for totalRawDeposited/totalRawBorrowed
    const supplyEvents = activity.supplies.filter((e) => inPeriod(e.timestamp));
    const withdrawRawEvents = activity.withdraws.filter((e) => inPeriod(e.timestamp));

    // Resolve every reserve index this position needs in one batch
    await series.prefetch([
        startTimestamp,
        endTimestamp,
        ...activity.balanceEvents.filter((e) => inPeriod(e.timestamp)).map((e) => Number(e.timestamp)),
        ...borrowEvents.map((e) => Number(e.timestamp)),
        ...repayEvents.map((e) => Number(e.timestamp)),
        ...activity.liquidations.map((e) => Number(e.timestamp)),
    ]);
    await prices.prefetch([
        startTimestamp,
        endTimestamp,
        ...activity.balanceEvents.map((e) => Number(e.timestamp)),
        ...activity.borrows.map((e) => Number(e.timestamp)),
        ...activity.repays.map((e) => Number(e.timestamp)),
        ...activity.supplies.map((e) => Number(e.timestamp)),
        ...activity.withdraws.map((e) => Number(e.timestamp)),
        ...activity.liquidations.map((e) => Number(e.timestamp)),
    ]);

    // Starting balances as recorded (capital already active at period start) and the events behind them
    // Starting state is immediately before the inclusive range. Events exactly
    // at startTimestamp are counted once as in-period activity below.
    const startScaledSupplyBalance = scaledBalanceAt(activity, startTimestamp - 1);
    const startScaledBorrowBalance = activity.startingScaledBorrowBalance > 0n
        ? activity.startingScaledBorrowBalance
        : 0n;
    const startLiquidityIndex = await series.liquidityIndexAt(startTimestamp);
    const startBorrowIndex = await series.variableBorrowIndexAt(startTimestamp);

    const startSupplyBalance = calculateActualBalance(startScaledSupplyBalance, startLiquidityIndex);
    const startBorrowBalance = calculateActualBalance(startScaledBorrowBalance, startBorrowIndex);

    const events_before_period: EventDetail[] = [
        ...formatBalanceEvents(activity, startTimestamp - 1, prices),
        ...formatBorrowEvents(activity, startTimestamp - 1, prices),
    ].sort((a, b) => a.timestamp - b.timestamp);

    // Segmented yield and borrow cost
    const yieldResult = await calculateSegmentedCustomPeriodYield(ctx, startTimestamp, endTimestamp, decimals);
    const borrowCostResult = await calculateSegmentedCustomPeriodBorrowCost(ctx, startTimestamp, endTimestamp, decimals);

    // Initialize totals with starting balances (actual amounts with liquidity index applied)
    let totalDeposited = startSupplyBalance;
    let totalBorrowed = startBorrowBalance;
    let totalWithdrawn = 0n;
    let totalRepaid = 0n;

    const startPrice = prices.priceAt(startTimestamp).price;
    let totalDepositedUSD = startPrice > 0n
        ? calculateUSDValueNumber(startSupplyBalance, startPrice, decimals)
        : 0;
    let totalWithdrawnUSD = 0;
    let totalBorrowedUSD = startPrice > 0n
        ? calculateUSDValueNumber(startBorrowBalance, startPrice, decimals)
        : 0;
    let totalRepaidUSD = 0;
    let totalScaledDepositedUSD = startPrice > 0n
        ? calculateUSDValueNumber(startScaledSupplyBalance, startPrice, decimals)
        : 0;
    let totalScaledBorrowedUSD = startPrice > 0n
        ? calculateUSDValueNumber(startScaledBorrowBalance, startPrice, decimals)
        : 0;

    // Scaled totals (raw transaction amounts, consistent across query periods)
    let totalScaledDeposited = startScaledSupplyBalance;
    let totalScaledBorrowed = startScaledBorrowBalance;

    // Starting raw balances (from events before period start)
    const startRawDeposits = activity.startingRawSupplyBalance;
    const startRawBorrows = activity.startingRawBorrowBalance;

    // Raw transaction amounts during the period
    let totalRawDeposited = 0n;
    let totalRawBorrowed = 0n;
    let totalRawDepositedUSD = 0;
    let totalRawBorrowedUSD = 0;

    for (const event of supplyEvents) {
        const amount = BigInt(event.amount ?? 0n);
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalRawDeposited += amount;
        if (price > 0n) {
            totalRawDepositedUSD += calculateUSDValueNumber(amount, price, decimals);
        }
    }
    for (const event of withdrawRawEvents) {
        const amount = BigInt(event.amount ?? 0n);
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalRawDeposited -= amount;
        if (price > 0n) {
            totalRawDepositedUSD -= calculateUSDValueNumber(amount, price, decimals);
        }
    }
    for (const event of borrowEvents) {
        const amount = BigInt(event.amount ?? 0n);
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalRawBorrowed += amount;
        if (price > 0n) {
            totalRawBorrowedUSD += calculateUSDValueNumber(amount, price, decimals);
        }
    }
    for (const event of repayEvents) {
        const amount = BigInt(event.amount ?? 0n);
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalRawBorrowed -= amount;
        if (price > 0n) {
            totalRawBorrowedUSD -= calculateUSDValueNumber(amount, price, decimals);
        }
    }

    const events: EventDetail[] = [];

    for (const event of depositEvents) {
        const transactionAmount = BigInt(event.transactionAmount ?? 0n);
        const actualAmount = calculateActualBalance(transactionAmount, BigInt(event.liquidityIndex ?? 0n));
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalDeposited += actualAmount;
        totalScaledDeposited += transactionAmount;

        if (price > 0n) {
            totalDepositedUSD += calculateUSDValueNumber(actualAmount, price, decimals);
            totalScaledDepositedUSD += calculateUSDValueNumber(transactionAmount, price, decimals);
        }

        events.push({
            eventType: 'deposit',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: actualAmount.toString(),
            txHash: event.txHash as string,
            assetPrice: price > 0n ? price.toString() : undefined,
        });
    }

    for (const event of withdrawEvents) {
        const transactionAmount = BigInt(event.transactionAmount ?? 0n);
        const scaledAmount = transactionAmount < 0n ? -transactionAmount : transactionAmount;
        const actualAmount = calculateActualBalance(scaledAmount, BigInt(event.liquidityIndex ?? 0n));
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalWithdrawn += actualAmount;

        if (price > 0n) {
            totalWithdrawnUSD += calculateUSDValueNumber(actualAmount, price, decimals);
            // totalScaledDeposited is cumulative (not net), so its USD counterpart is too
        }

        events.push({
            eventType: 'withdraw',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: actualAmount.toString(),
            txHash: event.txHash as string,
            assetPrice: price > 0n ? price.toString() : undefined,
        });
    }

    for (const event of borrowEvents) {
        const amount = BigInt(event.amount ?? 0n);
        const scaledAmount = BigInt(event.scaledAmount ?? 0n);
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalBorrowed += amount;
        totalScaledBorrowed += scaledAmount;

        if (price > 0n) {
            totalBorrowedUSD += calculateUSDValueNumber(amount, price, decimals);
            totalScaledBorrowedUSD += calculateUSDValueNumber(scaledAmount, price, decimals);
        }

        events.push({
            eventType: 'borrow',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: amount.toString(),
            txHash: event.txHash as string,
            assetPrice: price > 0n ? price.toString() : undefined,
        });
    }

    for (const event of repayEvents) {
        const amount = BigInt(event.amount ?? 0n);
        const price = prices.priceAt(Number(event.timestamp)).price;
        totalRepaid += amount;

        if (price > 0n) {
            totalRepaidUSD += calculateUSDValueNumber(amount, price, decimals);
            // totalScaledBorrowed is cumulative (not net), so its USD counterpart is too
        }

        events.push({
            eventType: 'repay',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: amount.toString(),
            txHash: event.txHash as string,
            assetPrice: price > 0n ? price.toString() : undefined,
        });
    }

    // Liquidations affect both collateral (forced withdrawal) and debt (forced repayment)
    for (const liquidation of liquidationEvents) {
        if (liquidation.collateralAsset?.toLowerCase() === asset.toLowerCase()) {
            const amount = BigInt(liquidation.liquidatedCollateralAmount ?? 0n);
            const price = prices.priceAt(Number(liquidation.timestamp)).price;
            totalWithdrawn += amount;
            totalRawDeposited -= amount;
            if (price > 0n) {
                const amountUSD = calculateUSDValueNumber(amount, price, decimals);
                totalWithdrawnUSD += amountUSD;
                totalRawDepositedUSD -= amountUSD;
            }
            events.push({
                eventType: 'liquidation_collateral',
                timestamp: Number(liquidation.timestamp),
                date: new Date(Number(liquidation.timestamp) * 1000).toISOString(),
                amount: amount.toString(),
                txHash: liquidation.txHash as string,
                assetPrice: price > 0n ? price.toString() : undefined,
            });
        }

        if (liquidation.debtAsset?.toLowerCase() === asset.toLowerCase()) {
            const amount = BigInt(liquidation.debtToCover ?? 0n);
            const price = prices.priceAt(Number(liquidation.timestamp)).price;
            totalRepaid += amount;
            totalRawBorrowed -= amount;
            if (price > 0n) {
                const amountUSD = calculateUSDValueNumber(amount, price, decimals);
                totalRepaidUSD += amountUSD;
                totalRawBorrowedUSD -= amountUSD;
            }
            events.push({
                eventType: 'liquidation_debt',
                timestamp: Number(liquidation.timestamp),
                date: new Date(Number(liquidation.timestamp) * 1000).toISOString(),
                amount: amount.toString(),
                txHash: liquidation.txHash as string,
                assetPrice: price > 0n ? price.toString() : undefined,
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
