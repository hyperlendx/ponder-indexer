/**
 * Custom Period Isolated Pair Position Calculations
 * 
 * Functions for calculating isolated pair positions that were active during
 * a specific time period, with balances calculated at the end of the period.
 * 
 * This mirrors the functionality of the core pool custom period positions,
 * but uses ERC4626-style shares-based accounting instead of AAVE's index-based accounting.
 */

import {
    getIsolatedPairCollateralBalance,
    getIsolatedPairAssetShares,
    getIsolatedPairBorrowShares,
    convertSharesToAssets
} from "./balanceQueries";
import { calculateIsolatedPairExchangeRateAtTimestamp } from "./exchangeRate";
import { getUserIsolatedPairsForPeriod } from "./periodTracking";

/**
 * Position data for a single isolated pair during a custom period
 */
export interface IsolatedPairCustomPeriodPosition {
    pair: string;
    collateralAmount: bigint;  // Raw collateral amount in token's native decimals (wei)
    depositedAmount: bigint;   // Asset amount (shares × exchangeRate) in token's native decimals (wei)
    borrowedAmount: bigint;    // Borrow amount (shares × exchangeRate) in token's native decimals (wei)
}

/**
 * Calculate isolated pair positions that were active during a custom time period
 * 
 * This function:
 * 1. Finds all isolated pairs the user interacted with during the period
 * 2. Calculates balances at the END of the period (toTimestamp)
 * 3. Applies exchange rate to convert shares to asset amounts
 * 4. Returns raw amounts in token's native decimals (NOT formatted)
 * 
 * Position Detection Logic:
 * - Checks for positions that existed at START of period (pre-existing positions)
 * - Checks for positions with activity DURING the period (new positions)
 * 
 * Balance Calculation:
 * - Collateral: Sum of AddCollateral - RemoveCollateral events up to endTimestamp
 * - Deposits: Sum of Deposit.shares - Withdraw.shares, converted to assets using exchange rate
 * - Borrows: Sum of Borrow.shares - Repay.shares, converted to assets using exchange rate
 * 
 * Exchange Rate:
 * - Calculated at endTimestamp using extrapolation from most recent events
 * - Similar to liquidity index calculation in core pool
 * - Accounts for accrued interest over time
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the period (Unix timestamp in seconds)
 * @param endTimestamp - End of the period (Unix timestamp in seconds)
 * @returns Array of isolated pair positions with balances at end of period
 * 
 * @example
 * ```typescript
 * // Get positions active between Jan 1 and Jan 31, 2024
 * const positions = await calculateUserCustomPeriodIsolatedPositions(
 *     context,
 *     "0x123...",
 *     1704067200,  // Jan 1, 2024
 *     1706745600   // Jan 31, 2024
 * );
 * 
 * // Returns:
 * // [
 * //   {
 * //     pair: "0xPair1...",
 * //     collateralAmount: 1000000000000000000n,  // 1 token (18 decimals)
 * //     depositedAmount: 1050000000000000000n,   // 1.05 tokens (with accrued interest)
 * //     borrowedAmount: 525000000000000000n      // 0.525 tokens borrowed
 * //   }
 * // ]
 * ```
 * 
 * @note
 * - Amounts are in token's native decimals (wei), NOT formatted
 * - Frontend must format using token decimals (e.g., divide by 10^18 for 18-decimal tokens)
 * - Positions with zero balance at end of period are filtered out
 * - Exchange rate includes accrued interest up to endTimestamp
 */
export async function calculateUserCustomPeriodIsolatedPositions(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<IsolatedPairCustomPeriodPosition[]> {
    // Get all isolated pairs where user had positions during the period
    // This checks for:
    // 1. Positions that existed at START of period (balance > 0 at startTimestamp)
    // 2. Positions with activity DURING period (events between start and end)
    const pairs = await getUserIsolatedPairsForPeriod(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Calculate position for each pair in parallel
    const positions = await Promise.all(
        pairs.map(async (pair) => {
            // Get balances at the END of the period
            const [collateralAmount, assetShares, borrowShares, exchangeRate] = await Promise.all([
                getIsolatedPairCollateralBalance(context, user, pair, endTimestamp),
                getIsolatedPairAssetShares(context, user, pair, endTimestamp),
                getIsolatedPairBorrowShares(context, user, pair, endTimestamp),
                calculateIsolatedPairExchangeRateAtTimestamp(context, pair, endTimestamp)
            ]);

            // Convert shares to asset amounts using exchange rate at end of period
            const depositedAmount = convertSharesToAssets(assetShares, exchangeRate);
            const borrowedAmount = convertSharesToAssets(borrowShares, exchangeRate);

            return {
                pair,
                collateralAmount,
                depositedAmount,
                borrowedAmount
            };
        })
    );

    // Filter to only positions with non-zero balance at end of period
    // This removes positions that were opened and fully closed within the period
    const activePositions = positions.filter(
        pos => pos.collateralAmount > 0n || pos.depositedAmount > 0n || pos.borrowedAmount > 0n
    );

    return activePositions;
}

