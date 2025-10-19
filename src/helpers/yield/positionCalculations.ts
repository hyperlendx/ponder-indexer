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
    getMaxBorrowBalanceDuringPeriod
} from "./balanceQueries";
import { calculateLiquidityIndexAtTimestamp } from "../aave/liquidityIndex";
import { calculateVariableBorrowIndexAtTimestamp } from "../aave/borrowIndex";
import { calculateActualBalance } from "../aave/balanceConversions";
import { RAY } from "../aave/rayMath";
import { calculateTotalSupplied, calculateTotalWithdrawn, calculateTotalBorrowed, calculateTotalRepaid } from "../userPositionManager";
import { UserBalanceEvent } from "ponder:schema";
import { eq } from "ponder";

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
    totalYieldEarned: bigint;       // Yield earned during the period

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
    // getUserAssetsForPeriod already handles both:
    // 1. Assets with balance at START of period (positions opened before period)
    // 2. Assets with events DURING period (new positions or activity on existing ones)
    const supplyAssets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);

    // Similarly for borrows - this checks balance at start + events during period
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

            // Calculate yield earned during the period
            // Formula: (endBalance - startBalance) + totalWithdrawn - totalDeposited
            // This works for both open and closed positions
            const totalYieldEarned: bigint = (endSupplyBalance - startSupplyBalance) + totalWithdrawn - totalDeposited;

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

