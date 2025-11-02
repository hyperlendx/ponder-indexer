/**
 * Isolated Pair Position Calculations
 *
 * Functions for calculating user positions in isolated pairs.
 * Positions combine balances (shares, collateral) with exchange rates
 * to provide a complete view of user holdings.
 */

import {
    getIsolatedPairCollateralBalance,
    getIsolatedPairAssetShares,
    getIsolatedPairBorrowShares,
    getIsolatedPairAssetSharesWithEvents,
    getIsolatedPairBorrowSharesWithEvents,
    getIsolatedPairCollateralBalanceWithEvents,
    convertSharesToAssets,
    BalanceWithEvents
} from "./balanceQueries";
import { getIsolatedPairExchangeRate } from "./exchangeRate";
import { getUserIsolatedPairs } from "./pairTracking";
import { getUserIsolatedPairsForPeriod } from "./periodTracking";
import {
    calculateTotalDeposited,
    calculateTotalWithdrawn,
    calculateTotalBorrowed,
    calculateTotalRepaid,
    calculateTotalCollateralAdded,
    calculateTotalCollateralRemoved
} from "./transactionAggregations";
import {
    BorrowAssetIsolated,
    RepayAssetIsolated,
    AddCollateralIsolated,
    RemoveCollateralIsolated,
    DepositIsolated,
    WithdrawIsolated
} from "ponder:schema";
import { eq, and, gte, lte } from "ponder";
import { calculateSegmentedIsolatedPairYield, calculateSegmentedIsolatedPairBorrowCost } from "./yieldCalculations";
import { ExchangeRateCache } from "./exchangeRateCache";

/**
 * Position data for a single isolated pair
 */
export interface IsolatedPairPosition {
    pair: string;
    collateralAmount: bigint;
    assetShares: bigint;
    borrowShares: bigint;
    assetAmount: bigint;
    borrowAmount: bigint;
    exchangeRate: bigint;
}

/**
 * Comprehensive position data for a single isolated pair during a custom time period
 * Provides maximum frontend flexibility with activity, yield, peak, and current metrics
 */
export interface IsolatedPairCustomPeriodPosition {
    pair: string;

    // Transaction activity during the period
    totalDeposited: bigint;           // Sum of deposit transactions (shares → assets)
    totalWithdrawn: bigint;           // Sum of withdrawal transactions (shares → assets)
    totalBorrowed: bigint;            // Sum of borrow transactions (shares → assets)
    totalRepaid: bigint;              // Sum of repay transactions (shares → assets)
    totalCollateralAdded: bigint;     // Sum of collateral additions
    totalCollateralRemoved: bigint;   // Sum of collateral removals

    // Calculated yield
    totalAssetYield: bigint;          // Yield earned on asset deposits during period
    totalBorrowCost: bigint;          // Interest paid on borrows during period (negative yield)
    totalNetYield: bigint;            // Net yield (assetYield - borrowCost)

    // Peak balances during period
    maxAssetAmount: bigint;           // Maximum asset balance reached (deposits + interest)
    maxBorrowAmount: bigint;          // Maximum borrow balance reached
    maxCollateralAmount: bigint;      // Maximum collateral balance reached

    // Current state at end of period
    currentAssetAmount: bigint;       // Asset balance at end of period
    currentBorrowAmount: bigint;      // Borrow balance at end of period
    currentCollateralAmount: bigint;  // Collateral balance at end of period

    // Derived metrics
    netDeposits: bigint;              // totalDeposited - totalWithdrawn
    netBorrows: bigint;               // totalBorrowed - totalRepaid
    netCollateral: bigint;            // totalCollateralAdded - totalCollateralRemoved
}

/**
 * Calculate isolated pair position for a user at a specific timestamp
 * 
 * Returns collateral, asset shares, borrow shares, and converted amounts.
 * This provides a complete snapshot of the user's position in a single pair.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Position data including shares and converted amounts
 * 
 * @example
 * ```typescript
 * const position = await calculateIsolatedPairPosition(context, "0x123...", "0xPair...", 1234567890);
 * // Returns: {
 * //   pair: "0xPair...",
 * //   collateralAmount: 1000000000000000000n,  // 1 token collateral
 * //   assetShares: 1000000000000000000n,       // 1000 asset shares
 * //   borrowShares: 500000000000000000n,       // 500 borrow shares
 * //   assetAmount: 1050000000000000000n,       // 1050 tokens (shares × rate)
 * //   borrowAmount: 525000000000000000n,       // 525 tokens (shares × rate)
 * //   exchangeRate: 1050000000000000000n       // 1.05 exchange rate
 * // }
 * ```
 */
export async function calculateIsolatedPairPosition(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<IsolatedPairPosition> {
    // Get all balances and exchange rate in parallel
    const [collateralAmount, assetShares, borrowShares, exchangeRate] = await Promise.all([
        getIsolatedPairCollateralBalance(context, user, pair, timestamp),
        getIsolatedPairAssetShares(context, user, pair, timestamp),
        getIsolatedPairBorrowShares(context, user, pair, timestamp),
        getIsolatedPairExchangeRate(context, pair, timestamp)
    ]);

    // Convert shares to amounts using the exchange rate
    const assetAmount = convertSharesToAssets(assetShares, exchangeRate);
    const borrowAmount = convertSharesToAssets(borrowShares, exchangeRate);

    return {
        pair,
        collateralAmount,
        assetShares,
        borrowShares,
        assetAmount,
        borrowAmount,
        exchangeRate
    };
}

/**
 * Calculate all isolated pair positions for a user at a specific timestamp
 * 
 * This is the main function used by APIs to get complete isolated pair data.
 * It finds all pairs the user has interacted with and calculates positions for each.
 * 
 * Positions with zero balances are filtered out.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param timestamp - Target timestamp
 * @param startTimestamp - Optional start timestamp for filtering pairs (backward compatibility)
 * @returns Array of position data for all active pairs
 * 
 * @example
 * ```typescript
 * const positions = await calculateAllIsolatedPairPositions(context, "0x123...", 1234567890);
 * // Returns: [
 * //   { pair: "0xPair1...", collateralAmount: 1000n, assetShares: 1000n, ... },
 * //   { pair: "0xPair2...", collateralAmount: 2000n, assetShares: 2000n, ... }
 * // ]
 * ```
 */
export async function calculateAllIsolatedPairPositions(
    context: any,
    user: string,
    timestamp: number,
    startTimestamp?: number
): Promise<IsolatedPairPosition[]> {
    // Get all pairs user has interacted with
    // Use a wide time range to catch all historical interactions
    const effectiveStartTimestamp = startTimestamp || 0;
    const pairs = await getUserIsolatedPairs(context, user, effectiveStartTimestamp, timestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Calculate position for each pair in parallel
    const positions = await Promise.all(
        pairs.map(pair => calculateIsolatedPairPosition(context, user, pair, timestamp))
    );

    // Filter out pairs with zero balances
    return positions.filter(pos =>
        pos.collateralAmount > 0n ||
        pos.assetShares > 0n ||
        pos.borrowShares > 0n
    );
}

/**
 * Calculate comprehensive isolated pair positions for a custom time period
 *
 * This function provides comprehensive position data with maximum frontend flexibility.
 * It calculates multiple metrics for each isolated pair:
 * - Transaction activity (deposits, withdrawals, borrows, repays, collateral changes)
 * - Calculated yield earned during the period
 * - Peak balances reached during the period
 * - Current balances at end of period
 *
 * IMPORTANT: This hybrid approach handles ALL cases correctly:
 * - User had position BEFORE the period started and still has balance at period end
 * - User opened position DURING the period and still has balance at period end
 * - User opened and fully closed position DURING the period (shows activity + yield)
 *
 * Yield Calculation Formula:
 * totalAssetYield = (endAssetAmount - startAssetAmount) + totalWithdrawn - totalDeposited
 * totalBorrowCost = (endBorrowAmount - startBorrowAmount) + totalRepaid - totalBorrowed
 * totalNetYield = totalAssetYield - totalBorrowCost
 *
 * This works for both open and closed positions:
 * - Open positions: endAmount > 0, captures unrealized yield
 * - Closed positions: endAmount = 0, captures realized yield from withdrawals
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the time period (Unix timestamp)
 * @param endTimestamp - End of the time period (Unix timestamp)
 * @returns Array of comprehensive position data for all pairs with activity
 *
 * @example
 * ```typescript
 * const positions = await calculateCustomPeriodIsolatedPairPositions(
 *   context,
 *   "0x123...",
 *   1704067200,  // Jan 1, 2024
 *   1735689600   // Jan 1, 2025
 * );
 * // Returns: [
 * //   {
 * //     pair: "0xPair...",
 * //     totalDeposited: 1000n,
 * //     totalWithdrawn: 1050n,
 * //     totalAssetYield: 50n,
 * //     maxAssetAmount: 1050n,
 * //     currentAssetAmount: 0n,
 * //     ...
 * //   }
 * // ]
 * ```
 */
export async function calculateCustomPeriodIsolatedPairPositions(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<IsolatedPairCustomPeriodPosition[]> {
    // Get all pairs user has interacted with during the period
    // This checks for:
    // 1. Positions that existed at START of period (balance > 0 at startTimestamp)
    // 2. Positions with activity DURING period (events between start and end)
    const pairs = await getUserIsolatedPairsForPeriod(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Calculate comprehensive position data for each pair in parallel
    const positions = await Promise.all(
        pairs.map(async (pair) => {
            // Get exchange rates at start and end of period
            const [startExchangeRate, endExchangeRate] = await Promise.all([
                getIsolatedPairExchangeRate(context, pair, startTimestamp),
                getIsolatedPairExchangeRate(context, pair, endTimestamp)
            ]);

            // Calculate all metrics in parallel for maximum performance
            const [
                // Start balances (shares)
                startAssetShares,
                startBorrowShares,
                startCollateralAmount,
                // End balances (shares)
                endAssetShares,
                endBorrowShares,
                endCollateralAmount,
                // Transaction activity during period
                totalDeposited,
                totalWithdrawn,
                totalBorrowed,
                totalRepaid,
                totalCollateralAdded,
                totalCollateralRemoved
            ] = await Promise.all([
                getIsolatedPairAssetShares(context, user, pair, startTimestamp),
                getIsolatedPairBorrowShares(context, user, pair, startTimestamp),
                getIsolatedPairCollateralBalance(context, user, pair, startTimestamp),
                getIsolatedPairAssetShares(context, user, pair, endTimestamp),
                getIsolatedPairBorrowShares(context, user, pair, endTimestamp),
                getIsolatedPairCollateralBalance(context, user, pair, endTimestamp),
                calculateTotalDeposited(context, user, pair, startTimestamp, endTimestamp),
                calculateTotalWithdrawn(context, user, pair, startTimestamp, endTimestamp),
                calculateTotalBorrowed(context, user, pair, startTimestamp, endTimestamp),
                calculateTotalRepaid(context, user, pair, startTimestamp, endTimestamp),
                calculateTotalCollateralAdded(context, user, pair, startTimestamp, endTimestamp),
                calculateTotalCollateralRemoved(context, user, pair, startTimestamp, endTimestamp)
            ]);

            // Convert shares to asset amounts using exchange rates
            const startAssetAmount = convertSharesToAssets(startAssetShares, startExchangeRate);
            const endAssetAmount = convertSharesToAssets(endAssetShares, endExchangeRate);
            const startBorrowAmount = convertSharesToAssets(startBorrowShares, startExchangeRate);
            const endBorrowAmount = convertSharesToAssets(endBorrowShares, endExchangeRate);

            // Calculate yield earned during the period
            // Formula: (endAmount - startAmount) + totalWithdrawn - totalDeposited
            const totalAssetYield = (endAssetAmount - startAssetAmount) + totalWithdrawn - totalDeposited;

            // Calculate borrow cost (interest paid) during the period
            // Formula: (endBorrowAmount - startBorrowAmount) + totalRepaid - totalBorrowed
            const totalBorrowCost = (endBorrowAmount - startBorrowAmount) + totalRepaid - totalBorrowed;

            // Net yield = asset yield - borrow cost
            const totalNetYield = totalAssetYield - totalBorrowCost;

            // For peak balances, we use end amounts as approximation
            // TODO: Implement proper peak tracking similar to core pool
            const maxAssetAmount = endAssetAmount > startAssetAmount ? endAssetAmount : startAssetAmount;
            const maxBorrowAmount = endBorrowAmount > startBorrowAmount ? endBorrowAmount : startBorrowAmount;
            const maxCollateralAmount = endCollateralAmount > startCollateralAmount ? endCollateralAmount : startCollateralAmount;

            // Calculate net metrics
            const netDeposits = totalDeposited - totalWithdrawn;
            const netBorrows = totalBorrowed - totalRepaid;
            const netCollateral = totalCollateralAdded - totalCollateralRemoved;

            return {
                pair,
                totalDeposited,
                totalWithdrawn,
                totalBorrowed,
                totalRepaid,
                totalCollateralAdded,
                totalCollateralRemoved,
                totalAssetYield,
                totalBorrowCost,
                totalNetYield,
                maxAssetAmount,
                maxBorrowAmount,
                maxCollateralAmount,
                currentAssetAmount: endAssetAmount,
                currentBorrowAmount: endBorrowAmount,
                currentCollateralAmount: endCollateralAmount,
                netDeposits,
                netBorrows,
                netCollateral
            };
        })
    );

    // Filter to only positions with non-zero activity during the period
    const activePositions = positions.filter(
        pos =>
            pos.currentAssetAmount > 0n ||
            pos.currentBorrowAmount > 0n ||
            pos.currentCollateralAmount > 0n ||
            pos.totalDeposited > 0n ||
            pos.totalWithdrawn > 0n ||
            pos.totalBorrowed > 0n ||
            pos.totalRepaid > 0n ||
            pos.totalCollateralAdded > 0n ||
            pos.totalCollateralRemoved > 0n ||
            pos.maxAssetAmount > 0n ||
            pos.maxBorrowAmount > 0n ||
            pos.maxCollateralAmount > 0n
    );

    return activePositions;
}

/**
 * Event detail for isolated pair transactions
 */
export interface IsolatedPairEventDetail {
    eventType: 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'collateral_add' | 'collateral_remove';
    timestamp: number;
    date: string;
    amount: string;
    txHash: string;
}

/**
 * Simplified isolated pair position data with only activity metrics and event details
 */
export interface SimplifiedIsolatedPairPosition {
    pair: string;
    totalDeposited: bigint;
    totalWithdrawn: bigint;
    totalBorrowed: bigint;
    totalRepaid: bigint;
    totalCollateralAdded: bigint;
    totalCollateralRemoved: bigint;
    events: IsolatedPairEventDetail[];
}

/**
 * Calculate simplified isolated pair positions with only activity metrics and event details
 *
 * This is an optimized version that:
 * - Returns only the 6 core activity metrics (deposits, withdrawals, borrows, repays, collateral add/remove)
 * - Includes all event details for transparency and verification
 * - Skips expensive calculations (yield, balances, exchange rates for end state)
 * - Properly accounts for positions active before the period started
 *
 * IMPORTANT: Activity metrics show total capital active during the period:
 * - totalDeposited = asset balance at START of period + deposits DURING period
 * - totalWithdrawn = withdrawals DURING period
 * - totalBorrowed = borrow balance at START of period + borrows DURING period
 * - totalRepaid = repayments DURING period
 * - totalCollateralAdded = collateral balance at START of period + collateral added DURING period
 * - totalCollateralRemoved = collateral removed DURING period
 *
 * This allows users to see how much capital was working for them during the period.
 *
 * Example: User deposited 1000 tokens on Jan 1, withdrew 500 on Feb 15
 * Query period: Feb 1 - Feb 28
 * Result: totalDeposited=1000, totalWithdrawn=500
 * (Shows 1000 was active during Feb, 500 was withdrawn)
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the time period (Unix timestamp)
 * @param endTimestamp - End of the time period (Unix timestamp)
 * @returns Array of simplified isolated pair position data with event details
 */
export async function calculateUserActivityIsolatedPairPositions(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<SimplifiedIsolatedPairPosition[]> {
    const dbQuery = context.db.sql || context.db;

    // Get all pairs where user had activity during the period
    const pairs = await getUserIsolatedPairsForPeriod(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Calculate activity metrics for each pair in parallel
    const positions = await Promise.all(
        pairs.map(async (pair) => {
            // Fetch data in parallel for performance
            const [
                // Events during the period
                depositEvents,
                withdrawEvents,
                borrowEvents,
                repayEvents,
                addCollateralEvents,
                removeCollateralEvents,
                // Starting balances
                startAssetShares,
                startBorrowShares,
                startCollateralAmount,
                // Exchange rates at start
                startExchangeRate
            ] = await Promise.all([
                // Fetch all deposit events during the period
                dbQuery.select().from(DepositIsolated).where(
                    and(
                        eq(DepositIsolated.owner, user as `0x${string}`),
                        eq(DepositIsolated.pair, pair as `0x${string}`),
                        gte(DepositIsolated.timestamp, startTimestamp),
                        lte(DepositIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all withdraw events during the period
                dbQuery.select().from(WithdrawIsolated).where(
                    and(
                        eq(WithdrawIsolated.owner, user as `0x${string}`),
                        eq(WithdrawIsolated.pair, pair as `0x${string}`),
                        gte(WithdrawIsolated.timestamp, startTimestamp),
                        lte(WithdrawIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all borrow events during the period
                dbQuery.select().from(BorrowAssetIsolated).where(
                    and(
                        eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                        eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                        gte(BorrowAssetIsolated.timestamp, startTimestamp),
                        lte(BorrowAssetIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all repay events during the period
                dbQuery.select().from(RepayAssetIsolated).where(
                    and(
                        eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                        eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                        gte(RepayAssetIsolated.timestamp, startTimestamp),
                        lte(RepayAssetIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all add collateral events during the period
                dbQuery.select().from(AddCollateralIsolated).where(
                    and(
                        eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                        eq(AddCollateralIsolated.pair, pair as `0x${string}`),
                        gte(AddCollateralIsolated.timestamp, startTimestamp),
                        lte(AddCollateralIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all remove collateral events during the period
                dbQuery.select().from(RemoveCollateralIsolated).where(
                    and(
                        eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                        eq(RemoveCollateralIsolated.pair, pair as `0x${string}`),
                        gte(RemoveCollateralIsolated.timestamp, startTimestamp),
                        lte(RemoveCollateralIsolated.timestamp, endTimestamp)
                    )
                ),
                // Get balances at start of period
                getIsolatedPairAssetShares(context, user, pair, startTimestamp),
                getIsolatedPairBorrowShares(context, user, pair, startTimestamp),
                getIsolatedPairCollateralBalance(context, user, pair, startTimestamp),
                // Get exchange rate at start of period
                getIsolatedPairExchangeRate(context, pair, startTimestamp)
            ]);

            // Calculate starting balances (capital that was already active at period start)
            const startAssetAmount = convertSharesToAssets(startAssetShares, startExchangeRate);
            const startBorrowAmount = convertSharesToAssets(startBorrowShares, startExchangeRate);

            // Initialize totals with starting balances
            let totalDeposited = startAssetAmount;
            let totalBorrowed = startBorrowAmount;
            let totalCollateralAdded = startCollateralAmount;
            let totalWithdrawn = 0n;
            let totalRepaid = 0n;
            let totalCollateralRemoved = 0n;
            const events: IsolatedPairEventDetail[] = [];

            // Add synthetic events for starting balances if non-zero
            if (startAssetAmount > 0n) {
                events.push({
                    eventType: 'deposit',
                    timestamp: startTimestamp,
                    date: new Date(startTimestamp * 1000).toISOString(),
                    amount: startAssetAmount.toString(),
                    txHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
                });
            }

            if (startBorrowAmount > 0n) {
                events.push({
                    eventType: 'borrow',
                    timestamp: startTimestamp,
                    date: new Date(startTimestamp * 1000).toISOString(),
                    amount: startBorrowAmount.toString(),
                    txHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
                });
            }

            // Note: startCollateralAmount represents existing collateral from before the period
            // We don't add it as an event since it's not a transaction during this period

            // Process deposit events during the period
            for (const event of depositEvents) {
                const assetAmount = convertSharesToAssets(event.shares, event.exchangeRate);
                totalDeposited += assetAmount;
                events.push({
                    eventType: 'deposit',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: assetAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process withdraw events during the period
            for (const event of withdrawEvents) {
                const assetAmount = convertSharesToAssets(event.shares, event.exchangeRate);
                totalWithdrawn += assetAmount;
                events.push({
                    eventType: 'withdraw',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: assetAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process borrow events during the period
            for (const event of borrowEvents) {
                const assetAmount = convertSharesToAssets(event.sharesAdded, event.exchangeRate);
                totalBorrowed += assetAmount;
                events.push({
                    eventType: 'borrow',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: assetAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process repay events during the period
            for (const event of repayEvents) {
                const assetAmount = convertSharesToAssets(event.shares, event.exchangeRate);
                totalRepaid += assetAmount;
                events.push({
                    eventType: 'repay',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: assetAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process add collateral events during the period
            for (const event of addCollateralEvents) {
                totalCollateralAdded += event.collateralAmount;
                events.push({
                    eventType: 'collateral_add',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: event.collateralAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process remove collateral events during the period
            for (const event of removeCollateralEvents) {
                totalCollateralRemoved += event.collateralAmount;
                events.push({
                    eventType: 'collateral_remove',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: event.collateralAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Sort events by timestamp for better readability
            events.sort((a, b) => a.timestamp - b.timestamp);

            return {
                pair,
                totalDeposited,
                totalWithdrawn,
                totalBorrowed,
                totalRepaid,
                totalCollateralAdded,
                totalCollateralRemoved,
                events
            };
        })
    );

    // Filter to only positions with activity during the period
    const activePositions = positions.filter(
        pos =>
            pos.totalDeposited > 0n ||
            pos.totalWithdrawn > 0n ||
            pos.totalBorrowed > 0n ||
            pos.totalRepaid > 0n ||
            pos.totalCollateralAdded > 0n ||
            pos.totalCollateralRemoved > 0n
    );

    return activePositions;
}

/**
 * Event detail for isolated pair transactions
 */
export interface IsolatedPairEventDetail {
    eventType: 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'collateral_add' | 'collateral_remove';
    timestamp: number;
    date: string;
    amount: string;
    txHash: string;
}

/**
 * Yield segment detail for isolated pairs
 */
export interface IsolatedPairYieldSegmentDetail {
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
}

/**
 * Borrow cost segment detail for isolated pairs
 */
export interface IsolatedPairBorrowCostSegmentDetail {
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
}

/**
 * Simplified isolated pair yield position with activity metrics and detailed breakdowns
 */
export interface SimplifiedIsolatedPairYieldPosition {
    pair: string;
    totalYieldEarned: bigint;
    totalBorrowCost: bigint;
    totalDeposited: bigint;
    totalWithdrawn: bigint;
    totalBorrowed: bigint;
    totalRepaid: bigint;
    totalCollateralAdded: bigint;
    totalCollateralRemoved: bigint;
    totalScaledDeposited: bigint;  // Sum of asset shares (starting + deposits during period)
    totalScaledBorrowed: bigint;   // Sum of borrow shares (starting + borrows during period)
    netDeposits: bigint;
    netBorrows: bigint;
    netCollateral: bigint;
    events: IsolatedPairEventDetail[];
    events_before_period: IsolatedPairEventDetail[];
    starting_balances: {
        collateral: bigint;
        deposits: bigint;
        borrows: bigint;
        scaledDeposits: bigint;  // Asset shares at period start
        scaledBorrows: bigint;   // Borrow shares at period start
    };
    yieldSegments: IsolatedPairYieldSegmentDetail[];
    borrowCostSegments: IsolatedPairBorrowCostSegmentDetail[];
}

/**
 * Calculate simplified isolated pair yield positions with activity metrics and detailed yield breakdown
 *
 * This function provides:
 * - Core activity metrics (deposits, withdrawals, borrows, repays, collateral changes)
 * - Yield calculations (totalYieldEarned, totalBorrowCost)
 * - Complete event details for transparency
 * - Detailed yield calculation segments for manual verification
 * - Detailed borrow cost calculation segments for manual verification
 *
 * IMPORTANT: Activity metrics show total capital active during the period:
 * - totalDeposited = vault balance at START of period + deposits DURING period
 * - totalWithdrawn = withdrawals DURING period
 * - totalBorrowed = borrow balance at START of period + borrows DURING period
 * - totalRepaid = repayments DURING period
 * - totalCollateralAdded = collateral at START of period + collateral added DURING period
 * - totalCollateralRemoved = collateral removed DURING period
 *
 * Yield Calculation:
 * - Uses segmented calculation that breaks down the period by share balance changes
 * - Each segment shows: asset shares, actual amount, exchange rates, yield earned
 * - Allows manual verification: segmentYield = shares * (endRate - startRate) / EXCHANGE_PRECISION
 *
 * Borrow Cost Calculation:
 * - Uses segmented calculation that breaks down the period by borrow share changes
 * - Each segment shows: borrow shares, actual amount, exchange rates, cost accrued
 * - Allows manual verification: segmentCost = shares * (endRate - startRate) / EXCHANGE_PRECISION
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the time period (Unix timestamp)
 * @param endTimestamp - End of the time period (Unix timestamp)
 * @returns Array of simplified isolated pair yield position data with detailed breakdowns
 */
export async function calculateUserIsolatedYieldPositions(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<SimplifiedIsolatedPairYieldPosition[]> {
    const { db } = context;
    const dbQuery = db.sql || db;

    // Get all pairs where user had positions
    const pairs = await getUserIsolatedPairsForPeriod(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Create cache for performance optimization
    const exchangeRateCache = new ExchangeRateCache();

    // Calculate yield positions for each pair in parallel
    const positions = await Promise.all(
        pairs.map(async (pair) => {
            try {
            // Fetch data in parallel for performance
            const [
                // Events during the period
                depositEvents,
                withdrawEvents,
                borrowEvents,
                repayEvents,
                collateralAddEvents,
                collateralRemoveEvents,
                // Starting balances with events
                startAssetResult,
                startBorrowResult,
                startCollateralResult,
                // Exchange rate at start
                startExchangeRate,
                // Segmented yield and borrow cost calculations
                yieldResult,
                borrowCostResult
            ] = await Promise.all([
                // Fetch all deposit events during the period
                dbQuery.select().from(DepositIsolated).where(
                    and(
                        eq(DepositIsolated.caller, user as `0x${string}`),
                        eq(DepositIsolated.pair, pair as `0x${string}`),
                        gte(DepositIsolated.timestamp, startTimestamp),
                        lte(DepositIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all withdraw events during the period
                dbQuery.select().from(WithdrawIsolated).where(
                    and(
                        eq(WithdrawIsolated.caller, user as `0x${string}`),
                        eq(WithdrawIsolated.pair, pair as `0x${string}`),
                        gte(WithdrawIsolated.timestamp, startTimestamp),
                        lte(WithdrawIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all borrow events during the period
                dbQuery.select().from(BorrowAssetIsolated).where(
                    and(
                        eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                        eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                        gte(BorrowAssetIsolated.timestamp, startTimestamp),
                        lte(BorrowAssetIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all repay events during the period
                dbQuery.select().from(RepayAssetIsolated).where(
                    and(
                        eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                        eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                        gte(RepayAssetIsolated.timestamp, startTimestamp),
                        lte(RepayAssetIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all collateral add events during the period
                dbQuery.select().from(AddCollateralIsolated).where(
                    and(
                        eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                        eq(AddCollateralIsolated.pair, pair as `0x${string}`),
                        gte(AddCollateralIsolated.timestamp, startTimestamp),
                        lte(AddCollateralIsolated.timestamp, endTimestamp)
                    )
                ),
                // Fetch all collateral remove events during the period
                dbQuery.select().from(RemoveCollateralIsolated).where(
                    and(
                        eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                        eq(RemoveCollateralIsolated.pair, pair as `0x${string}`),
                        gte(RemoveCollateralIsolated.timestamp, startTimestamp),
                        lte(RemoveCollateralIsolated.timestamp, endTimestamp)
                    )
                ),
                // Get balances and events at start of period
                getIsolatedPairAssetSharesWithEvents(context, user, pair, startTimestamp),
                getIsolatedPairBorrowSharesWithEvents(context, user, pair, startTimestamp),
                getIsolatedPairCollateralBalanceWithEvents(context, user, pair, startTimestamp),
                // Get exchange rate at start of period
                getIsolatedPairExchangeRate(context, pair, startTimestamp),
                // Calculate segmented yield and borrow cost (with caching for performance)
                calculateSegmentedIsolatedPairYield(context, user, pair, startTimestamp, endTimestamp, exchangeRateCache),
                calculateSegmentedIsolatedPairBorrowCost(context, user, pair, startTimestamp, endTimestamp, exchangeRateCache)
            ]);

            // Extract balances and events from enhanced results
            const startAssetShares = startAssetResult.balance;
            const startBorrowShares = startBorrowResult.balance;
            const startCollateralBalance = startCollateralResult.balance;

            // Calculate starting balances (capital that was already active at period start)
            const startAssetAmount = convertSharesToAssets(startAssetShares, startExchangeRate);
            const startBorrowAmount = convertSharesToAssets(startBorrowShares, startExchangeRate);

            // Collect all events that contributed to starting balances
            const events_before_period: IsolatedPairEventDetail[] = [
                ...startAssetResult.events,
                ...startBorrowResult.events,
                ...startCollateralResult.events
            ].sort((a, b) => a.timestamp - b.timestamp);

            // Initialize totals with starting balances
            let totalDeposited = startAssetAmount;
            let totalBorrowed = startBorrowAmount;
            let totalCollateralAdded = startCollateralBalance;
            let totalWithdrawn = 0n;
            let totalRepaid = 0n;
            let totalCollateralRemoved = 0n;

            // Initialize scaled totals (shares without exchange rate conversion)
            let totalScaledDeposited = startAssetShares;
            let totalScaledBorrowed = startBorrowShares;

            const events: IsolatedPairEventDetail[] = [];

            // Process deposit events during the period
            for (const event of depositEvents) {
                const assetAmount = convertSharesToAssets(event.shares, event.exchangeRate);
                totalDeposited += assetAmount;
                totalScaledDeposited += event.shares;  // Track scaled amount (shares)
                events.push({
                    eventType: 'deposit',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: assetAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process withdraw events during the period
            for (const event of withdrawEvents) {
                const assetAmount = convertSharesToAssets(event.shares, event.exchangeRate);
                totalWithdrawn += assetAmount;
                events.push({
                    eventType: 'withdraw',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: assetAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process borrow events during the period
            for (const event of borrowEvents) {
                const borrowAmount = convertSharesToAssets(event.sharesAdded, event.exchangeRate);
                totalBorrowed += borrowAmount;
                totalScaledBorrowed += event.sharesAdded;  // Track scaled amount (shares)
                events.push({
                    eventType: 'borrow',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: borrowAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process repay events during the period
            for (const event of repayEvents) {
                const repayAmount = convertSharesToAssets(event.shares, event.exchangeRate);
                totalRepaid += repayAmount;
                // Note: Do NOT subtract from totalScaledBorrowed - we want total borrowed, not net
                events.push({
                    eventType: 'repay',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: repayAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process collateral add events during the period
            for (const event of collateralAddEvents) {
                totalCollateralAdded += event.collateralAmount;
                events.push({
                    eventType: 'collateral_add',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: event.collateralAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Process collateral remove events during the period
            for (const event of collateralRemoveEvents) {
                totalCollateralRemoved += event.collateralAmount;
                events.push({
                    eventType: 'collateral_remove',
                    timestamp: Number(event.timestamp),
                    date: new Date(Number(event.timestamp) * 1000).toISOString(),
                    amount: event.collateralAmount.toString(),
                    txHash: event.txHash
                });
            }

            // Sort events by timestamp for better readability
            events.sort((a, b) => a.timestamp - b.timestamp);

            // Calculate net metrics
            const netDeposits = totalDeposited - totalWithdrawn;
            const netBorrows = totalBorrowed - totalRepaid;
            const netCollateral = totalCollateralAdded - totalCollateralRemoved;

            // Validate yield and borrow cost results
            if (!yieldResult) {
                console.error(`yieldResult is undefined for pair ${pair}`);
                throw new Error(`Failed to calculate yield for pair ${pair}: yieldResult is undefined`);
            }
            if (!borrowCostResult) {
                console.error(`borrowCostResult is undefined for pair ${pair}`);
                throw new Error(`Failed to calculate borrow cost for pair ${pair}: borrowCostResult is undefined`);
            }
            if (!yieldResult.segments) {
                console.error(`yieldResult.segments is undefined for pair ${pair}`, yieldResult);
                throw new Error(`Failed to calculate yield for pair ${pair}: segments is undefined`);
            }
            if (!borrowCostResult.segments) {
                console.error(`borrowCostResult.segments is undefined for pair ${pair}`, borrowCostResult);
                throw new Error(`Failed to calculate borrow cost for pair ${pair}: segments is undefined`);
            }

            // Convert segment data to the interface format with defensive null checks
            const yieldSegments: IsolatedPairYieldSegmentDetail[] = yieldResult.segments.map(seg => {
                // Validate segment has all required properties
                if (!seg) {
                    console.error(`Null segment in yieldResult for pair ${pair}`);
                    throw new Error(`Invalid yield segment: segment is null or undefined`);
                }
                if (seg.startTime === undefined || seg.endTime === undefined) {
                    console.error(`Invalid segment times for pair ${pair}:`, seg);
                    throw new Error(`Invalid yield segment: missing startTime or endTime`);
                }
                if (seg.assetShares === undefined || seg.segmentYield === undefined) {
                    console.error(`Invalid segment values for pair ${pair}:`, seg);
                    throw new Error(`Invalid yield segment: missing assetShares or segmentYield`);
                }

                return {
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    startDate: seg.startDate || new Date(seg.startTime * 1000).toISOString(),
                    endDate: seg.endDate || new Date(seg.endTime * 1000).toISOString(),
                    assetShares: seg.assetShares,
                    actualAssetAmount: seg.actualAssetAmount ?? 0n,
                    startExchangeRate: seg.startExchangeRate ?? 0n,
                    endExchangeRate: seg.endExchangeRate ?? 0n,
                    segmentYield: seg.segmentYield,
                    durationDays: seg.durationDays ?? 0
                };
            });

            const borrowCostSegments: IsolatedPairBorrowCostSegmentDetail[] = borrowCostResult.segments.map(seg => {
                // Validate segment has all required properties
                if (!seg) {
                    console.error(`Null segment in borrowCostResult for pair ${pair}`);
                    throw new Error(`Invalid borrow cost segment: segment is null or undefined`);
                }
                if (seg.startTime === undefined || seg.endTime === undefined) {
                    console.error(`Invalid segment times for pair ${pair}:`, seg);
                    throw new Error(`Invalid borrow cost segment: missing startTime or endTime`);
                }
                if (seg.borrowShares === undefined || seg.segmentBorrowCost === undefined) {
                    console.error(`Invalid segment values for pair ${pair}:`, seg);
                    throw new Error(`Invalid borrow cost segment: missing borrowShares or segmentBorrowCost`);
                }

                return {
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    startDate: seg.startDate || new Date(seg.startTime * 1000).toISOString(),
                    endDate: seg.endDate || new Date(seg.endTime * 1000).toISOString(),
                    borrowShares: seg.borrowShares,
                    actualBorrowAmount: seg.actualBorrowAmount ?? 0n,
                    startExchangeRate: seg.startExchangeRate ?? 0n,
                    endExchangeRate: seg.endExchangeRate ?? 0n,
                    segmentBorrowCost: seg.segmentBorrowCost,
                    durationDays: seg.durationDays ?? 0
                };
            });

            return {
                pair,
                totalYieldEarned: yieldResult.totalYield,
                totalBorrowCost: borrowCostResult.totalBorrowCost,
                totalDeposited,
                totalWithdrawn,
                totalBorrowed,
                totalRepaid,
                totalCollateralAdded,
                totalCollateralRemoved,
                totalScaledDeposited,
                totalScaledBorrowed,
                netDeposits,
                netBorrows,
                netCollateral,
                events,
                events_before_period,
                starting_balances: {
                    collateral: startCollateralBalance,
                    deposits: startAssetAmount,
                    borrows: startBorrowAmount,
                    scaledDeposits: startAssetShares,
                    scaledBorrows: startBorrowShares
                },
                yieldSegments,
                borrowCostSegments
            };
            } catch (error) {
                console.error(`Error calculating yield for pair ${pair}:`, error);
                // @ts-ignore
                throw new Error(`Failed to calculate yield for pair ${pair}: ${error.message}`);
            }
        })
    );

    // Filter to only positions with activity during the period OR pre-existing balances
    const activePositions = positions.filter(
        pos =>
            // Activity during the period
            pos.totalDeposited > 0n ||
            pos.totalWithdrawn > 0n ||
            pos.totalBorrowed > 0n ||
            pos.totalRepaid > 0n ||
            pos.totalCollateralAdded > 0n ||
            pos.totalCollateralRemoved > 0n ||
            // OR pre-existing balances at start of period
            pos.starting_balances.collateral > 0n ||
            pos.starting_balances.deposits > 0n ||
            pos.starting_balances.borrows > 0n
    );

    return activePositions;
}
