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
    UserIsolatedPairTracking
} from "ponder:schema";
import { eq, and, lte, gte, between } from "ponder";
import {
    getIsolatedPairCollateralBalance,
    getIsolatedPairAssetShares,
    getIsolatedPairBorrowShares
} from "./balanceQueries";

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
        // Step 1: Get all pairs user has EVER interacted with (from tracking table)
        const trackingRecords = await dbQuery
            .select()
            .from(UserIsolatedPairTracking)
            .where(eq(UserIsolatedPairTracking.user, user as `0x${string}`));
        
        if (trackingRecords.length === 0) {
            return [];
        }
        
        const allPairs = trackingRecords.map((record: any) => record.pair as string);

        // Step 2: For each pair, check if it had a position during the period
        const pairsWithPositions = await Promise.all(
            allPairs.map(async (pair: string) => {
                // Check 1: Did user have a balance at START of period?
                const [collateralAtStart, assetSharesAtStart, borrowSharesAtStart] = await Promise.all([
                    getIsolatedPairCollateralBalance(context, user, pair, startTimestamp),
                    getIsolatedPairAssetShares(context, user, pair, startTimestamp),
                    getIsolatedPairBorrowShares(context, user, pair, startTimestamp)
                ]);
                
                const hadBalanceAtStart = 
                    collateralAtStart > 0n || 
                    assetSharesAtStart > 0n || 
                    borrowSharesAtStart > 0n;
                
                if (hadBalanceAtStart) {
                    return pair;
                }
                
                // Check 2: Did user have any activity DURING the period?
                const hadActivityDuringPeriod = await checkPairActivityDuringPeriod(
                    context,
                    user,
                    pair,
                    startTimestamp,
                    endTimestamp
                );
                
                if (hadActivityDuringPeriod) {
                    return pair;
                }
                
                return null;
            })
        );
        
        // Filter out nulls and return unique pairs
        return pairsWithPositions.filter((pair): pair is string => pair !== null);
        
    } catch (error: any) {
        console.error('Error in getUserIsolatedPairsForPeriod:', error.message);
        console.error('Stack:', error.stack);
        return [];
    }
}

/**
 * Check if user had any activity in a specific pair during a time period
 * 
 * Checks all event types:
 * - Deposits
 * - Withdrawals
 * - Borrows
 * - Repays
 * - Add Collateral
 * - Remove Collateral
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of the period
 * @param endTimestamp - End of the period
 * @returns True if user had any activity during the period
 */
async function checkPairActivityDuringPeriod(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<boolean> {
    const dbQuery = context.db.sql || context.db;
    
    try {
        // Check each event type in parallel
        const [
            deposits,
            withdraws,
            borrows,
            repays,
            addCollateral,
            removeCollateral
        ] = await Promise.all([
            // Deposits
            dbQuery.select().from(DepositIsolated).where(
                and(
                    eq(DepositIsolated.owner, user as `0x${string}`),
                    eq(DepositIsolated.pair, pair as `0x${string}`),
                    gte(DepositIsolated.timestamp, startTimestamp),
                    lte(DepositIsolated.timestamp, endTimestamp)
                )
            ).limit(1),
            
            // Withdrawals
            dbQuery.select().from(WithdrawIsolated).where(
                and(
                    eq(WithdrawIsolated.owner, user as `0x${string}`),
                    eq(WithdrawIsolated.pair, pair as `0x${string}`),
                    gte(WithdrawIsolated.timestamp, startTimestamp),
                    lte(WithdrawIsolated.timestamp, endTimestamp)
                )
            ).limit(1),
            
            // Borrows
            dbQuery.select().from(BorrowAssetIsolated).where(
                and(
                    eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                    eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                    gte(BorrowAssetIsolated.timestamp, startTimestamp),
                    lte(BorrowAssetIsolated.timestamp, endTimestamp)
                )
            ).limit(1),
            
            // Repays
            dbQuery.select().from(RepayAssetIsolated).where(
                and(
                    eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                    eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                    gte(RepayAssetIsolated.timestamp, startTimestamp),
                    lte(RepayAssetIsolated.timestamp, endTimestamp)
                )
            ).limit(1),
            
            // Add Collateral
            dbQuery.select().from(AddCollateralIsolated).where(
                and(
                    eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                    eq(AddCollateralIsolated.pair, pair as `0x${string}`),
                    gte(AddCollateralIsolated.timestamp, startTimestamp),
                    lte(AddCollateralIsolated.timestamp, endTimestamp)
                )
            ).limit(1),
            
            // Remove Collateral
            dbQuery.select().from(RemoveCollateralIsolated).where(
                and(
                    eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                    eq(RemoveCollateralIsolated.pair, pair as `0x${string}`),
                    gte(RemoveCollateralIsolated.timestamp, startTimestamp),
                    lte(RemoveCollateralIsolated.timestamp, endTimestamp)
                )
            ).limit(1)
        ]);
        
        // Return true if any event type has results
        return (
            deposits.length > 0 ||
            withdraws.length > 0 ||
            borrows.length > 0 ||
            repays.length > 0 ||
            addCollateral.length > 0 ||
            removeCollateral.length > 0
        );
        
    } catch (error: any) {
        console.error('Error checking pair activity:', error.message);
        return false;
    }
}

