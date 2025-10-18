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
    convertSharesToAssets
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
