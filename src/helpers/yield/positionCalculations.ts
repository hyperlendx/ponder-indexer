/**
 * Position Calculations for Custom Time Periods
 *
 * Functions for calculating user positions (supply and borrow balances)
 * during custom time periods with accrued interest.
 */

import {
    getUserAssetsForPeriod,
    getScaledBalanceAtTimestamp,
    getUserBorrowedAssets,
    getScaledBorrowBalanceAtTimestamp,
    getMaxBalanceDuringPeriod,
    getMaxBorrowBalanceDuringPeriod,
    getScaledBalanceWithEvents,
    getScaledBorrowBalanceWithEvents,
} from "./balanceQueries";
import { calculateLiquidityIndexAtTimestamp } from "../aave/liquidityIndex";
import { calculateVariableBorrowIndexAtTimestamp } from "../aave/borrowIndex";
import { calculateActualBalance } from "../aave/balanceConversions";
import { calculateTotalSupplied, calculateTotalWithdrawn, calculateTotalBorrowed, calculateTotalRepaid } from "../userPositionManager";
import { UserBalanceEvent, Borrow, Repay, LiquidationCall, Supply, Withdraw } from "ponder:schema";
import { eq, and, gte, lte, or } from "ponder";
import { calculateSegmentedCustomPeriodYield, calculateSegmentedCustomPeriodBorrowCost } from "./yieldCalculations";
import { LiquidityIndexCache } from "./liquidityIndexCache";
import { getDecimals } from "../getDecimals";
import { calculateUSDValueNumber } from "../usdCalculations";



/**
 * Position data for a single asset during a time period
 * Provides comprehensive data for maximum frontend flexibility
 */
export interface AssetPosition {
    asset: string;

    // Transaction activity during the period
    totalDeposited: bigint;         // Sum of deposit transactions during the period
    totalWithdrawn: bigint;         // Sum of withdrawal transactions during the period
    totalBorrowed: bigint;          // Sum of borrow transactions during the period
    totalRepaid: bigint;            // Sum of repay transactions during the period

    // Calculated yield
    totalYieldEarned: bigint;       // Yield earned on supply during the period
    totalBorrowCost: bigint;        // Interest cost on borrows during the period

    // Peak balances during period (deposits + accrued interest)
    maxSupplyBalance: bigint;       // Maximum supply balance reached during the period
    maxBorrowBalance: bigint;       // Maximum borrow balance reached during the period

    // Current state at end of period
    currentSupplyBalance: bigint;   // Supply balance at end of period
    currentBorrowBalance: bigint;   // Borrow balance at end of period

    // Derived metrics
    netDeposits: bigint;            // totalDeposited - totalWithdrawn
    netBorrows: bigint;             // totalBorrowed - totalRepaid
}

/**
 * Calculate user positions for all assets during a custom time period
 *
 * This function provides comprehensive position data with maximum frontend flexibility.
 * It calculates multiple metrics for each asset:
 * - Transaction activity (deposits, withdrawals, borrows, repays)
 * - Calculated yield earned during the period
 * - Peak balances reached during the period
 * - Current balances at end of period
 *
 * IMPORTANT: This hybrid approach handles ALL cases correctly:
 * - User deposited/borrowed BEFORE the period started and still has balance at period end
 * - User deposited/borrowed DURING the period and still has balance at period end
 * - User deposited/borrowed and fully closed DURING the period (shows activity + yield)
 *
 * Yield Calculation Formula:
 * totalYieldEarned = (endBalance - startBalance) + totalWithdrawn - totalDeposited
 *
 * This works for both open and closed positions:
 * - Open positions: endBalance > 0, captures unrealized yield
 * - Closed positions: endBalance = 0, captures realized yield from withdrawals
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the time period (Unix timestamp)
 * @param endTimestamp - End of the time period (Unix timestamp)
 * @returns Array of comprehensive position data for all assets with activity
 *
 * @example
 * ```typescript
 * const positions = await calculateUserCustomPeriodPositions(
 *   context,
 *   "0x123...",
 *   1704067200,  // Jan 1, 2024
 *   1735689600   // Jan 1, 2025
 * );
 * // Returns: [
 * //   {
 * //     asset: "0xUSDC...",
 * //     totalDeposited: 1000n,
 * //     totalWithdrawn: 1050n,
 * //     totalBorrowed: 0n,
 * //     totalRepaid: 0n,
 * //     totalYieldEarned: 50n,
 * //     maxSupplyBalance: 1050n,
 * //     maxBorrowBalance: 0n,
 * //     currentSupplyBalance: 0n,
 * //     currentBorrowBalance: 0n,
 * //     netDeposits: -50n,
 * //     netBorrows: 0n
 * //   }
 * // ]
 * ```
 */
export async function calculateUserCustomPeriodPositions(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<AssetPosition[]> {
    // Get all assets where user had positions
    // 1. Assets with balance at START of period (positions opened before period)
    // 2. Assets with events DURING period (new positions or activity on existing ones)
    const supplyAssets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);

    //Checks balance at start + events during period
    const borrowAssets = await getUserBorrowedAssets(context, user, startTimestamp, endTimestamp);

    // Combine and deduplicate
    const allAssets = [...new Set([...supplyAssets, ...borrowAssets])];

    if (allAssets.length === 0) {
        return [];
    }

    // Calculate comprehensive position data for each asset in parallel
    const positions = await Promise.all(
        allAssets.map(async (asset) => {
            // Calculate all metrics in parallel for maximum performance
            const [
                // Start and end balances
                startScaledSupplyBalance,
                endScaledSupplyBalance,
                startScaledBorrowBalance,
                endScaledBorrowBalance,
                // Indices
                startLiquidityIndex,
                endLiquidityIndex,
                startBorrowIndex,
                endBorrowIndex,
                // Transaction activity during period
                totalDeposited,
                totalWithdrawn,
                totalBorrowed,
                totalRepaid,
                // Peak balances during period
                maxScaledSupplyBalance,
                maxScaledBorrowBalance
            ] = await Promise.all([
                getScaledBalanceAtTimestamp(context, user, asset, startTimestamp),
                getScaledBalanceAtTimestamp(context, user, asset, endTimestamp),
                getScaledBorrowBalanceAtTimestamp(context, user, asset, startTimestamp),
                getScaledBorrowBalanceAtTimestamp(context, user, asset, endTimestamp),
                calculateLiquidityIndexAtTimestamp(context, asset, startTimestamp),
                calculateLiquidityIndexAtTimestamp(context, asset, endTimestamp),
                calculateVariableBorrowIndexAtTimestamp(context, asset, startTimestamp),
                calculateVariableBorrowIndexAtTimestamp(context, asset, endTimestamp),
                calculateTotalSupplied(context, user, asset, startTimestamp, endTimestamp),
                calculateTotalWithdrawn(context, user, asset, startTimestamp, endTimestamp),
                calculateTotalBorrowed(context, user, asset, startTimestamp, endTimestamp),
                calculateTotalRepaid(context, user, asset, startTimestamp, endTimestamp),
                getMaxBalanceDuringPeriod(context, user, asset, startTimestamp, endTimestamp),
                getMaxBorrowBalanceDuringPeriod(context, user, asset, startTimestamp, endTimestamp)
            ]);

            // Convert scaled balances to actual balances with accrued interest
            const startSupplyBalance = calculateActualBalance(startScaledSupplyBalance, startLiquidityIndex);
            const endSupplyBalance = calculateActualBalance(endScaledSupplyBalance, endLiquidityIndex);
            const startBorrowBalance = calculateActualBalance(startScaledBorrowBalance, startBorrowIndex);
            const endBorrowBalance = calculateActualBalance(endScaledBorrowBalance, endBorrowIndex);
            const maxSupplyBalance = calculateActualBalance(maxScaledSupplyBalance, endLiquidityIndex);
            const maxBorrowBalance = calculateActualBalance(maxScaledBorrowBalance, endBorrowIndex);

            // Calculate yield earned during the period (supply side)
            // Formula: (endBalance - startBalance) + totalWithdrawn - totalDeposited
            // This works for both open and closed positions
            const totalYieldEarned: bigint = (endSupplyBalance - startSupplyBalance) + totalWithdrawn - totalDeposited;

            // Calculate borrow cost during the period (borrow side)
            // Formula: (endBorrowBalance - startBorrowBalance) + totalRepaid - totalBorrowed
            // This represents the interest accrued on borrows
            const totalBorrowCost: bigint = (endBorrowBalance - startBorrowBalance) + totalRepaid - totalBorrowed;

            // Calculate net deposits and borrows
            const netDeposits: bigint = totalDeposited - totalWithdrawn;
            const netBorrows: bigint = totalBorrowed - totalRepaid;

            return {
                asset,
                totalDeposited,
                totalWithdrawn,
                totalBorrowed,
                totalRepaid,
                totalYieldEarned,
                totalBorrowCost,
                maxSupplyBalance,
                maxBorrowBalance,
                currentSupplyBalance: endSupplyBalance,
                currentBorrowBalance: endBorrowBalance,
                netDeposits,
                netBorrows
            };
        })
    );

    // Filter to only positions with non-zero activity during the period
    // A position is included if it has ANY non-zero metric
    const activePositions = positions.filter(
        pos =>
            pos.currentSupplyBalance > 0n ||
            pos.currentBorrowBalance > 0n ||
            pos.totalDeposited > 0n ||
            pos.totalWithdrawn > 0n ||
            pos.totalBorrowed > 0n ||
            pos.totalRepaid > 0n ||
            pos.maxSupplyBalance > 0n ||
            pos.maxBorrowBalance > 0n
    );

    return activePositions;
}

/**
 * NOTE: We do NOT provide aggregate totals (totalDeposited, totalBorrowed) because:
 *
 * 1. Different tokens have different decimal places (USDC=6, WETH=18, etc.)
 * 2. Summing raw token amounts is mathematically meaningless
 *    Example: 1000000 (1 USDC) + 1000000000000000000 (1 WETH) = nonsense
 * 3. Meaningful totals require USD conversion using oracle prices
 * 4. The frontend should calculate USD-based totals by:
 *    - Fetching token decimals for each asset
 *    - Fetching current prices from oracles
 *    - Converting: usdValue = (amount / 10^decimals) × price
 *    - Summing USD values across all positions
 *
 * This design keeps the API focused on raw blockchain data and leaves
 * presentation logic (USD conversion) to the frontend.
 */

/**
 * Event detail for transparency and verification
 */
export interface EventDetail {
    eventType: 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out' | 'borrow' | 'repay';
    timestamp: number;
    date: string;
    amount: string;
    txHash: string;
    assetPrice?: string; // Oracle price of the asset at the time of the event
}

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
 * This function provides:
 * - Core activity metrics (deposits, withdrawals, borrows, repays)
 * - Yield calculations (totalYieldEarned, totalBorrowCost)
 * - Complete event details for transparency
 * - Detailed yield calculation segments for manual verification
 * - Detailed borrow cost calculation segments for manual verification
 *
 * IMPORTANT: Activity metrics show total capital active during the period:
 * - totalDeposited = supply balance at START of period + deposits DURING period
 * - totalWithdrawn = withdrawals DURING period
 * - totalBorrowed = borrow balance at START of period + borrows DURING period
 * - totalRepaid = repayments DURING period
 *
 * Yield Calculation:
 * - Uses segmented calculation that breaks down the period by balance changes
 * - Each segment shows: scaled balance, actual balance, liquidity indices, yield earned
 * - Allows manual verification: segmentYield = scaledBalance * (endIndex - startIndex) / RAY
 *
 * Borrow Cost Calculation:
 * - Uses segmented calculation that breaks down the period by borrow balance changes
 * - Each segment shows: scaled borrow, actual borrow, borrow indices, cost accrued
 * - Allows manual verification: segmentCost = scaledBorrow * (endIndex - startIndex) / RAY
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
    const { db } = context;
    const dbQuery = db.sql || db;

    // Get all assets where user had positions
    const supplyAssets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);
    const borrowAssets = await getUserBorrowedAssets(context, user, startTimestamp, endTimestamp);
    const allAssets = [...new Set([...supplyAssets, ...borrowAssets])];



    if (allAssets.length === 0) {
        return [];
    }

    // Create caches for performance optimization
    const liquidityIndexCache = new LiquidityIndexCache();
    const borrowIndexCache = new Map<string, bigint>();

    // Calculate yield positions for each asset in parallel
    const positions = await Promise.all(
        allAssets.map(async (asset) => {
            // Get decimals first (needed for USD calculations in segmented functions)
            const decimals = await getDecimals(context, asset) || 18; // Default to 18 if not found

            // Fetch data in parallel for performance
            const [
                // Events during the period
                depositEvents,
                withdrawEvents,
                borrowEvents,
                repayEvents,
                liquidationEvents,
                // Raw transaction events for totalRawDeposited/totalRawBorrowed
                supplyEvents,
                withdrawRawEvents,
                // Raw transaction events BEFORE period start for starting raw balances
                supplyEventsBeforeStart,
                withdrawEventsBeforeStart,
                borrowEventsBeforeStart,
                repayEventsBeforeStart,
                // Starting balances with events
                startSupplyResult,
                startBorrowResult,
                // Indices at start
                startLiquidityIndex,
                startBorrowIndex,
                // Segmented yield and borrow cost calculations (with caching)
                yieldResult,
                borrowCostResult
            ] = await Promise.all([
                // Fetch all deposit events during the period
                dbQuery.select().from(UserBalanceEvent).where(
                    and(
                        eq(UserBalanceEvent.user, user as `0x${string}`),
                        eq(UserBalanceEvent.asset, asset as `0x${string}`),
                        eq(UserBalanceEvent.eventType, 'deposit'),
                        gte(UserBalanceEvent.timestamp, startTimestamp),
                        lte(UserBalanceEvent.timestamp, endTimestamp)
                    )
                ),
                // Fetch all withdraw events during the period
                dbQuery.select().from(UserBalanceEvent).where(
                    and(
                        eq(UserBalanceEvent.user, user as `0x${string}`),
                        eq(UserBalanceEvent.asset, asset as `0x${string}`),
                        eq(UserBalanceEvent.eventType, 'withdraw'),
                        gte(UserBalanceEvent.timestamp, startTimestamp),
                        lte(UserBalanceEvent.timestamp, endTimestamp)
                    )
                ),
                // Fetch all borrow events during the period
                dbQuery.select().from(Borrow).where(
                    and(
                        eq(Borrow.onBehalfOf, user as `0x${string}`),
                        eq(Borrow.reserve, asset as `0x${string}`),
                        gte(Borrow.timestamp, startTimestamp),
                        lte(Borrow.timestamp, endTimestamp)
                    )
                ),
                // Fetch all repay events during the period
                dbQuery.select().from(Repay).where(
                    and(
                        eq(Repay.user, user as `0x${string}`),
                        eq(Repay.reserve, asset as `0x${string}`),
                        gte(Repay.timestamp, startTimestamp),
                        lte(Repay.timestamp, endTimestamp)
                    )
                ),
                // Fetch all liquidation events during the period where this asset was involved
                // (either as collateral or debt asset)
                dbQuery.select().from(LiquidationCall).where(
                    and(
                        eq(LiquidationCall.user, user as `0x${string}`),
                        or(
                            eq(LiquidationCall.collateralAsset, asset as `0x${string}`),
                            eq(LiquidationCall.debtAsset, asset as `0x${string}`)
                        ),
                        gte(LiquidationCall.timestamp, startTimestamp),
                        lte(LiquidationCall.timestamp, endTimestamp)
                    )
                ),
                // Fetch raw Supply events for totalRawDeposited calculation
                dbQuery.select().from(Supply).where(
                    and(
                        eq(Supply.onBehalfOf, user as `0x${string}`),
                        eq(Supply.reserve, asset as `0x${string}`),
                        gte(Supply.timestamp, startTimestamp),
                        lte(Supply.timestamp, endTimestamp)
                    )
                ),
                // Fetch raw Withdraw events for totalRawDeposited calculation (to subtract)
                dbQuery.select().from(Withdraw).where(
                    and(
                        eq(Withdraw.onBehalfOf, user as `0x${string}`),
                        eq(Withdraw.reserve, asset as `0x${string}`),
                        gte(Withdraw.timestamp, startTimestamp),
                        lte(Withdraw.timestamp, endTimestamp)
                    )
                ),
                // Fetch raw Supply events BEFORE start timestamp for starting raw balance
                dbQuery.select().from(Supply).where(
                    and(
                        eq(Supply.onBehalfOf, user as `0x${string}`),
                        eq(Supply.reserve, asset as `0x${string}`),
                        lte(Supply.timestamp, startTimestamp)
                    )
                ),
                // Fetch raw Withdraw events BEFORE start timestamp for starting raw balance
                dbQuery.select().from(Withdraw).where(
                    and(
                        eq(Withdraw.onBehalfOf, user as `0x${string}`),
                        eq(Withdraw.reserve, asset as `0x${string}`),
                        lte(Withdraw.timestamp, startTimestamp)
                    )
                ),
                // Fetch raw Borrow events BEFORE start timestamp for starting raw balance
                dbQuery.select().from(Borrow).where(
                    and(
                        eq(Borrow.onBehalfOf, user as `0x${string}`),
                        eq(Borrow.reserve, asset as `0x${string}`),
                        lte(Borrow.timestamp, startTimestamp)
                    )
                ),
                // Fetch raw Repay events BEFORE start timestamp for starting raw balance
                dbQuery.select().from(Repay).where(
                    and(
                        eq(Repay.user, user as `0x${string}`),
                        eq(Repay.reserve, asset as `0x${string}`),
                        lte(Repay.timestamp, startTimestamp)
                    )
                ),
                // Get balances and events at start of period
                getScaledBalanceWithEvents(context, user, asset, startTimestamp),
                getScaledBorrowBalanceWithEvents(context, user, asset, startTimestamp),
                // Get indices at start of period
                calculateLiquidityIndexAtTimestamp(context, asset, startTimestamp),
                calculateVariableBorrowIndexAtTimestamp(context, asset, startTimestamp),
                // Calculate segmented yield and borrow cost (with caching for performance)
                calculateSegmentedCustomPeriodYield(context, user, asset, startTimestamp, endTimestamp, decimals, liquidityIndexCache),
                calculateSegmentedCustomPeriodBorrowCost(context, user, asset, startTimestamp, endTimestamp, decimals, borrowIndexCache)
            ]);

            // Extract balances and events from enhanced results
            const startScaledSupplyBalance = startSupplyResult.balance;
            const startScaledBorrowBalance = startBorrowResult.balance;

            // Calculate starting balances (capital that was already active at period start)
            const startSupplyBalance = calculateActualBalance(startScaledSupplyBalance, startLiquidityIndex);
            const startBorrowBalance = calculateActualBalance(startScaledBorrowBalance, startBorrowIndex);

            // Collect all events that contributed to starting balances
            const events_before_period: EventDetail[] = [
                ...startSupplyResult.events,
                ...startBorrowResult.events
            ].sort((a, b) => a.timestamp - b.timestamp);

            // Initialize totals with starting balances (actual amounts with liquidity index applied)
            let totalDeposited = startSupplyBalance;
            let totalBorrowed = startBorrowBalance;
            let totalWithdrawn = 0n;
            let totalRepaid = 0n;

            // Initialize USD totals
            let totalDepositedUSD = 0;
            let totalWithdrawnUSD = 0;
            let totalBorrowedUSD = 0;
            let totalRepaidUSD = 0;
            let totalScaledDepositedUSD = 0;
            let totalScaledBorrowedUSD = 0;

            // Initialize scaled totals (raw transaction amounts, consistent across query periods)
            let totalScaledDeposited = startScaledSupplyBalance;
            let totalScaledBorrowed = startScaledBorrowBalance;

            // Calculate starting raw balances (from events before period start)
            let startRawDeposits = 0n;
            let startRawBorrows = 0n;

            // Sum raw deposit amounts from Supply events before start
            for (const event of supplyEventsBeforeStart) {
                startRawDeposits += event.amount;
            }

            // Subtract raw withdraw amounts from Withdraw events before start
            for (const event of withdrawEventsBeforeStart) {
                startRawDeposits -= event.amount;
            }

            // Sum raw borrow amounts from Borrow events before start
            for (const event of borrowEventsBeforeStart) {
                startRawBorrows += event.amount;
            }

            // Subtract raw repay amounts from Repay events before start
            for (const event of repayEventsBeforeStart) {
                startRawBorrows -= event.amount;
            }

            // Calculate raw transaction amounts (exact amounts from Supply/Withdraw/Borrow/Repay events)
            let totalRawDeposited = 0n;
            let totalRawBorrowed = 0n;
            let totalRawDepositedUSD = 0;
            let totalRawBorrowedUSD = 0;

            // Sum raw deposit amounts from Supply events
            for (const event of supplyEvents) {
                totalRawDeposited += event.amount;
                // Calculate USD value for raw deposits
                if (event.price) {
                    totalRawDepositedUSD += calculateUSDValueNumber(event.amount, event.price, decimals);
                }
            }

            // Subtract raw withdraw amounts from Withdraw events
            for (const event of withdrawRawEvents) {
                totalRawDeposited -= event.amount;
                // Subtract USD value for raw withdraws
                if (event.price) {
                    totalRawDepositedUSD -= calculateUSDValueNumber(event.amount, event.price, decimals);
                }
            }

            // Sum raw borrow amounts from Borrow events
            for (const event of borrowEvents) {
                totalRawBorrowed += event.amount;
                // Calculate USD value for raw borrows
                if (event.price) {
                    totalRawBorrowedUSD += calculateUSDValueNumber(event.amount, event.price, decimals);
                }
            }

            // Subtract raw repay amounts from Repay events
            for (const event of repayEvents) {
                totalRawBorrowed -= event.amount;
                // Subtract USD value for raw repays
                if (event.price) {
                    totalRawBorrowedUSD -= calculateUSDValueNumber(event.amount, event.price, decimals);
                }
            }

            const events: EventDetail[] = [];

            // Process deposit events during the period
            // UserBalanceEvent now includes assetPrice, so we don't need to fetch from Supply table
            for (const event of depositEvents) {
                const actualAmount = calculateActualBalance(event.transactionAmount, event.liquidityIndex);
                totalDeposited += actualAmount;
                totalScaledDeposited += event.transactionAmount;  // Add scaled amount

                // Calculate USD values using price from UserBalanceEvent
                if (event.assetPrice) {
                    totalDepositedUSD += calculateUSDValueNumber(actualAmount, event.assetPrice, decimals);
                    totalScaledDepositedUSD += calculateUSDValueNumber(event.transactionAmount, event.assetPrice, decimals);
                }

                events.push({
                    eventType: 'deposit',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: actualAmount.toString(),
                    txHash: event.txHash,
                    assetPrice: event.assetPrice?.toString()
                });
            }

            // Process withdraw events during the period
            // UserBalanceEvent now includes assetPrice, so we don't need to fetch from Withdraw table
            for (const event of withdrawEvents) {
                const actualAmount = calculateActualBalance(event.transactionAmount, event.liquidityIndex);
                totalWithdrawn += actualAmount;

                // Calculate USD values using price from UserBalanceEvent
                if (event.assetPrice) {
                    totalWithdrawnUSD += calculateUSDValueNumber(actualAmount, event.assetPrice, decimals);
                    // Note: We don't subtract from totalScaledDepositedUSD here because totalScaledDeposited
                    // is cumulative (not net), so totalScaledDepositedUSD should also be cumulative
                }

                events.push({
                    eventType: 'withdraw',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: actualAmount.toString(),
                    txHash: event.txHash,
                    assetPrice: event.assetPrice?.toString()
                });
            }

            // Process borrow events during the period
            for (const event of borrowEvents) {
                totalBorrowed += event.amount;
                totalScaledBorrowed += event.amount;  // Add scaled amount

                // Calculate USD values
                if (event.price) {
                    totalBorrowedUSD += calculateUSDValueNumber(event.amount, event.price, decimals);
                    totalScaledBorrowedUSD += calculateUSDValueNumber(event.amount, event.price, decimals);
                }

                events.push({
                    eventType: 'borrow',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: event.amount.toString(),
                    txHash: event.txHash,
                    assetPrice: event.price?.toString()
                });
            }

            // Process repay events during the period
            for (const event of repayEvents) {
                totalRepaid += event.amount;

                // Calculate USD values
                if (event.price) {
                    totalRepaidUSD += calculateUSDValueNumber(event.amount, event.price, decimals);
                    // Note: We don't subtract from totalScaledBorrowedUSD here because totalScaledBorrowed
                    // is cumulative (not net), so totalScaledBorrowedUSD should also be cumulative
                }

                events.push({
                    eventType: 'repay',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: event.amount.toString(),
                    txHash: event.txHash,
                    assetPrice: event.price?.toString()
                });
            }

            // Process liquidation events during the period
            // Liquidations affect both collateral (forced withdrawal) and debt (forced repayment)
            for (const liquidation of liquidationEvents) {
                // Check if this asset was the collateral asset (forced withdrawal)
                if (liquidation.collateralAsset.toLowerCase() === asset.toLowerCase()) {
                    totalWithdrawn += liquidation.liquidatedCollateralAmount;
                    events.push({
                        eventType: 'liquidation_collateral' as any,
                        timestamp: Number(liquidation.timestamp),
                        date: new Date(Number(liquidation.timestamp) * 1000).toISOString(),
                        amount: liquidation.liquidatedCollateralAmount.toString(),
                        txHash: liquidation.txHash
                    });
                }

                // Check if this asset was the debt asset (forced repayment)
                if (liquidation.debtAsset.toLowerCase() === asset.toLowerCase()) {
                    totalRepaid += liquidation.debtToCover;
                    events.push({
                        eventType: 'liquidation_debt' as any,
                        timestamp: Number(liquidation.timestamp),
                        date: new Date(Number(liquidation.timestamp) * 1000).toISOString(),
                        amount: liquidation.debtToCover.toString(),
                        txHash: liquidation.txHash
                    });
                }
            }

            // Sort events by timestamp for better readability
            events.sort((a, b) => a.timestamp - b.timestamp);

            // Calculate net metrics
            const netDeposits = totalDeposited - totalWithdrawn;
            const netBorrows = totalBorrowed - totalRepaid;

            // USD values are already calculated in the segmented functions
            const totalYieldEarnedUSD = yieldResult.totalYieldUSD;
            const totalBorrowCostUSD = borrowCostResult.totalBorrowCostUSD;

            // Convert segment data to string format for response
            const yieldSegments: YieldSegmentDetail[] = yieldResult.segments.map(seg => ({
                startTime: seg.startTime,
                endTime: seg.endTime,
                startDate: seg.startDate,
                endDate: seg.endDate,
                scaledBalance: seg.scaledBalance,
                actualBalance: seg.actualBalance,
                startLiquidityIndex: seg.startLiquidityIndex,
                endLiquidityIndex: seg.endLiquidityIndex,
                segmentYield: seg.segmentYield,
                segmentYieldUSD: seg.segmentYieldUSD, // USD value for this segment
                durationDays: seg.durationDays,
                assetPrice: seg.assetPrice // Oracle price of the asset during this segment
            }));

            const borrowCostSegments: BorrowCostSegmentDetail[] = borrowCostResult.segments.map(seg => ({
                startTime: seg.startTime,
                endTime: seg.endTime,
                startDate: seg.startDate,
                endDate: seg.endDate,
                scaledBorrowBalance: seg.scaledBorrowBalance,
                actualBorrowBalance: seg.actualBorrowBalance,
                startBorrowIndex: seg.startBorrowIndex,
                endBorrowIndex: seg.endBorrowIndex,
                segmentBorrowCost: seg.segmentBorrowCost,
                segmentBorrowCostUSD: seg.segmentBorrowCostUSD, // USD value for this segment
                durationDays: seg.durationDays,
                assetPrice: seg.assetPrice // Oracle price of the asset during this segment
            }));

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
                // USD values calculated using historical oracle prices
                totalDepositedUSD: totalDepositedUSD.toFixed(4),
                totalWithdrawnUSD: totalWithdrawnUSD.toFixed(4),
                totalBorrowedUSD: totalBorrowedUSD.toFixed(4),
                totalRepaidUSD: totalRepaidUSD.toFixed(4),
                totalYieldEarnedUSD,
                totalBorrowCostUSD,
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
                    rawBorrows: startRawBorrows
                },
                yieldSegments,
                borrowCostSegments
            };
        })
    );

    // Filter to only positions with activity during the period
    const activePositions = positions.filter(
        pos =>
            pos.totalDeposited > 0n ||
            pos.totalWithdrawn > 0n ||
            pos.totalBorrowed > 0n ||
            pos.totalRepaid > 0n
    );

    return activePositions;
}
