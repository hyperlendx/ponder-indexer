/**
 * Position Calculations for Custom Time Periods
 * 
 * Functions for calculating user positions (supply and borrow balances)
 * during custom time periods with accrued interest.
 */

import { getUserAssetsForPeriod, getScaledBalanceAtTimestamp, getUserBorrowedAssets, getScaledBorrowBalanceAtTimestamp } from "./balanceQueries";
import { calculateLiquidityIndexAtTimestamp } from "../aave/liquidityIndex";
import { calculateVariableBorrowIndexAtTimestamp } from "../aave/borrowIndex";
import { calculateActualBalance } from "../aave/balanceConversions";
import { RAY } from "../aave/rayMath";

/**
 * Position data for a single asset during a time period
 */
export interface AssetPosition {
    asset: string;
    depositedAmount: bigint;  // Supply balance with accrued interest at end of period
    borrowedAmount: bigint;   // Borrow balance with accrued interest at end of period
}

/**
 * Calculate user positions for all assets during a custom time period
 *
 * This function identifies all positions that were active during the specified period
 * and calculates their balances (with accrued interest) as of the end of the period.
 *
 * IMPORTANT: A position is considered "active during the period" if it has a non-zero
 * balance at the END of the period, regardless of when it was opened. This correctly
 * handles cases where:
 * - User deposited/borrowed BEFORE the period started and still has balance at period end
 * - User deposited/borrowed DURING the period and still has balance at period end
 * - User deposited/borrowed and fully closed DURING the period (filtered out - zero balance)
 *
 * The algorithm:
 * 1. Get all assets with activity during the period (deposits, withdrawals, borrows, repays)
 * 2. For each asset, calculate the balance at the END of the period
 * 3. Filter out assets with zero balance at period end
 * 4. Return positions with non-zero balances
 *
 * This approach ensures we capture ALL positions that existed at the end of the period,
 * including those opened before the period started.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the time period (Unix timestamp)
 * @param endTimestamp - End of the time period (Unix timestamp)
 * @returns Array of position data for all active assets
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
 * //   { asset: "0xUSDC...", depositedAmount: 1050000000n, borrowedAmount: 0n },
 * //   { asset: "0xETH...", depositedAmount: 2100000000n, borrowedAmount: 500000000n }
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

    // Calculate positions for each asset in parallel
    const positions = await Promise.all(
        allAssets.map(async (asset) => {
            // Get scaled balances at the end of the period
            const scaledSupplyBalance = await getScaledBalanceAtTimestamp(
                context,
                user,
                asset,
                endTimestamp
            );

            const scaledBorrowBalance = await getScaledBorrowBalanceAtTimestamp(
                context,
                user,
                asset,
                endTimestamp
            );

            // Get liquidity indices at the end of the period
            const [liquidityIndex, borrowIndex] = await Promise.all([
                calculateLiquidityIndexAtTimestamp(context, asset, endTimestamp),
                calculateVariableBorrowIndexAtTimestamp(context, asset, endTimestamp)
            ]);

            // Calculate actual balances with accrued interest
            const depositedAmount = calculateActualBalance(scaledSupplyBalance, liquidityIndex);
            const borrowedAmount = calculateActualBalance(scaledBorrowBalance, borrowIndex);

            return {
                asset,
                depositedAmount,
                borrowedAmount
            };
        })
    );

    // Filter to only positions with non-zero balance at end of period
    // This removes positions that were opened and fully closed within the period
    const activePositions = positions.filter(
        pos => pos.depositedAmount > 0n || pos.borrowedAmount > 0n
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

