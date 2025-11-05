/**
 * Isolated Pair Period Tracking Functions
 * 
 * Functions for detecting which isolated pairs a user had positions in
 * during a specific time period.
 */

import {
    BorrowAssetIsolated,
    RepayAssetIsolated,
    AddCollateralIsolated,
    RemoveCollateralIsolated,
    DepositIsolated,
    WithdrawIsolated,
    LiquidateIsolated,
    UserIsolatedPairTracking
} from "ponder:schema";
import { eq, and, or, lte, gte, inArray } from "ponder";

/**
 * Get isolated pairs where user had positions during a specific time period
 * 
 * This function detects positions that were active during the period by checking:
 * 1. Positions that existed at START of period (balance > 0 at startTimestamp)
 * 2. Positions with activity DURING the period (events between start and end)
 * 
 * This mirrors the logic used in the core pool's getUserAssetsForPeriod() and
 * getUserBorrowedAssets() functions.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of the period (Unix timestamp in seconds)
 * @param endTimestamp - End of the period (Unix timestamp in seconds)
 * @returns Array of pair addresses that had positions during the period
 * 
 * @example
 * ```typescript
 * // Get pairs active between Jan 1 and Jan 31, 2024
 * const pairs = await getUserIsolatedPairsForPeriod(
 *     context,
 *     "0x123...",
 *     1704067200,  // Jan 1, 2024
 *     1706745600   // Jan 31, 2024
 * );
 * // Returns: ["0xPair1...", "0xPair2..."]
 * ```
 */
export async function getUserIsolatedPairsForPeriod(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const dbQuery = context.db.sql || context.db;

    try {
        console.log(`getUserIsolatedPairsForPeriod: user=${user}, start=${startTimestamp}, end=${endTimestamp}`);

        // Step 1: Get all pairs user has EVER interacted with (from tracking table)
        const trackingRecords = await dbQuery
            .select()
            .from(UserIsolatedPairTracking)
            .where(eq(UserIsolatedPairTracking.user, user as `0x${string}`));

        console.log(`Found ${trackingRecords.length} tracking records`);

        if (trackingRecords.length === 0) {
            return [];
        }

        const allPairs = trackingRecords.map((record: any) => record.pair as string);
        console.log(`All pairs for user: ${allPairs.join(', ')}`);

        // Use Set to track unique pairs with positions during the period
        const activePairs = new Set<string>();

        // Step 2: Check for pre-existing positions at START of period
        // This catches positions that were opened before the period but are still active
        const pairsWithPreExistingPositions = await checkBatchPairBalancesAtTimestamp(
            context,
            user,
            allPairs,
            startTimestamp
        );
        console.log(`Pairs with pre-existing positions at start: ${pairsWithPreExistingPositions.join(', ')}`);
        pairsWithPreExistingPositions.forEach(pair => activePairs.add(pair));

        // Step 3: Check for activity during the period (new positions or activity on existing ones)
        const pairsWithActivity = await checkBatchPairActivityDuringPeriod(
            context,
            user,
            allPairs,
            startTimestamp,
            endTimestamp
        );
        console.log(`Pairs with activity during period: ${pairsWithActivity.join(', ')}`);
        pairsWithActivity.forEach(pair => activePairs.add(pair));

        const result = Array.from(activePairs);
        console.log(`Total pairs with positions during period: ${result.join(', ')}`);
        return result;

    } catch (error: any) {
        console.error('Error in getUserIsolatedPairsForPeriod:', error.message);
        console.error('Stack:', error.stack);
        return [];
    }
}

/**
 * Batch check for pairs with activity during a time period
 *
 * This function checks ALL pairs at once using SQL IN clauses, dramatically reducing
 * the number of database queries from O(n*6) to O(6) where n is the number of pairs.
 *
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pairs - Array of isolated pair addresses to check
 * @param startTimestamp - Start of the period
 * @param endTimestamp - End of the period
 * @returns Array of pair addresses that had activity during the period
 */
async function checkBatchPairActivityDuringPeriod(
    context: any,
    user: string,
    pairs: string[],
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const dbQuery = context.db.sql || context.db;

    if (pairs.length === 0) {
        return [];
    }

    try {
        // Use Set to track unique pairs with activity
        const activePairs = new Set<string>();

        // Check each event type in parallel, but query ALL pairs at once using inArray
        const [
            deposits,
            withdraws,
            borrows,
            repays,
            addCollateral,
            removeCollateral,
            liquidations
        ] = await Promise.all([
            // Deposits - check all pairs at once
            dbQuery.select({pair: DepositIsolated.pair}).from(DepositIsolated).where(
                and(
                    eq(DepositIsolated.owner, user as `0x${string}`),
                    inArray(DepositIsolated.pair, pairs as `0x${string}`[]),
                    gte(DepositIsolated.timestamp, startTimestamp),
                    lte(DepositIsolated.timestamp, endTimestamp)
                )
            ),

            // Withdrawals - check all pairs at once
            dbQuery.select({pair: WithdrawIsolated.pair}).from(WithdrawIsolated).where(
                and(
                    eq(WithdrawIsolated.owner, user as `0x${string}`),
                    inArray(WithdrawIsolated.pair, pairs as `0x${string}`[]),
                    gte(WithdrawIsolated.timestamp, startTimestamp),
                    lte(WithdrawIsolated.timestamp, endTimestamp)
                )
            ),

            // Borrows - check all pairs at once
            dbQuery.select({pair: BorrowAssetIsolated.pair}).from(BorrowAssetIsolated).where(
                and(
                    eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                    inArray(BorrowAssetIsolated.pair, pairs as `0x${string}`[]),
                    gte(BorrowAssetIsolated.timestamp, startTimestamp),
                    lte(BorrowAssetIsolated.timestamp, endTimestamp)
                )
            ),

            // Repays - check all pairs at once
            dbQuery.select({pair: RepayAssetIsolated.pair}).from(RepayAssetIsolated).where(
                and(
                    eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                    inArray(RepayAssetIsolated.pair, pairs as `0x${string}`[]),
                    gte(RepayAssetIsolated.timestamp, startTimestamp),
                    lte(RepayAssetIsolated.timestamp, endTimestamp)
                )
            ),

            // Add Collateral - check all pairs at once
            dbQuery.select({pair: AddCollateralIsolated.pair}).from(AddCollateralIsolated).where(
                and(
                    eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                    inArray(AddCollateralIsolated.pair, pairs as `0x${string}`[]),
                    gte(AddCollateralIsolated.timestamp, startTimestamp),
                    lte(AddCollateralIsolated.timestamp, endTimestamp)
                )
            ),

            // Remove Collateral - check all pairs at once
            dbQuery.select({pair: RemoveCollateralIsolated.pair}).from(RemoveCollateralIsolated).where(
                and(
                    eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                    inArray(RemoveCollateralIsolated.pair, pairs as `0x${string}`[]),
                    gte(RemoveCollateralIsolated.timestamp, startTimestamp),
                    lte(RemoveCollateralIsolated.timestamp, endTimestamp)
                )
            ),

            // Liquidations - check all pairs at once (user can be either borrower or liquidator)
            dbQuery.select({pair: LiquidateIsolated.pair}).from(LiquidateIsolated).where(
                and(
                    or(
                        eq(LiquidateIsolated.borrower, user as `0x${string}`),
                        eq(LiquidateIsolated.liquidator, user as `0x${string}`)
                    ),
                    inArray(LiquidateIsolated.pair, pairs as `0x${string}`[]),
                    gte(LiquidateIsolated.timestamp, startTimestamp),
                    lte(LiquidateIsolated.timestamp, endTimestamp)
                )
            )
        ]);

        // Collect all unique pairs that had any activity
        deposits.forEach((row: any) => activePairs.add(row.pair));
        withdraws.forEach((row: any) => activePairs.add(row.pair));
        borrows.forEach((row: any) => activePairs.add(row.pair));
        repays.forEach((row: any) => activePairs.add(row.pair));
        addCollateral.forEach((row: any) => activePairs.add(row.pair));
        removeCollateral.forEach((row: any) => activePairs.add(row.pair));
        liquidations.forEach((row: any) => activePairs.add(row.pair));

        return Array.from(activePairs);

    } catch (error: any) {
        console.error('Error checking batch pair activity:', error.message);
        console.error('Stack:', error.stack);
        return [];
    }
}

/**
 * Batch check for pairs with non-zero balances at a specific timestamp
 *
 * This function checks ALL pairs at once to see if the user has any non-zero balances
 * (collateral, asset shares, or borrow shares) at the given timestamp.
 * This is used to detect pre-existing positions at the start of a period.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pairs - Array of isolated pair addresses to check
 * @param timestamp - Timestamp to check balances at
 * @returns Array of pair addresses that had non-zero balances at the timestamp
 */
async function checkBatchPairBalancesAtTimestamp(
    context: any,
    user: string,
    pairs: string[],
    timestamp: number
): Promise<string[]> {
    if (pairs.length === 0) {
        return [];
    }

    try {
        // Import balance query functions
        const {
            getIsolatedPairCollateralBalance,
            getIsolatedPairAssetShares,
            getIsolatedPairBorrowShares
        } = await import("./balanceQueries");

        // Check balances for all pairs in parallel
        const balanceChecks = await Promise.all(
            pairs.map(async (pair) => {
                try {
                    const [collateralBalance, assetShares, borrowShares] = await Promise.all([
                        getIsolatedPairCollateralBalance(context, user, pair, timestamp),
                        getIsolatedPairAssetShares(context, user, pair, timestamp),
                        getIsolatedPairBorrowShares(context, user, pair, timestamp)
                    ]);

                    // Return pair if any balance is non-zero
                    const hasBalance = collateralBalance > 0n || assetShares > 0n || borrowShares > 0n;
                    return hasBalance ? pair : null;
                } catch (error: any) {
                    console.error(`Error checking balance for pair ${pair}:`, error.message);
                    return null;
                }
            })
        );

        // Filter out null values and return pairs with non-zero balances
        return balanceChecks.filter((pair): pair is string => pair !== null);

    } catch (error: any) {
        console.error('Error checking batch pair balances:', error.message);
        console.error('Stack:', error.stack);
        return [];
    }
}
