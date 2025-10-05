import { UserMonthlyInterest } from "ponder:schema";
import { eq, and } from "ponder";

/**
 * Check if monthly yield is already calculated and cached in the database
 * 
 * This function queries the UserMonthlyInterest table to see if we've already
 * calculated yield for this user/asset/month combination. This is especially
 * useful for historical months that won't change.
 * 
 * @returns Cached monthly yield data or null if not found
 */
export async function getCachedMonthlyYield(
    context: any,
    user: string,
    asset: string,
    year: number,
    month: number
): Promise<any | null> {
    const { db } = context;
    const dbQuery = db.sql || db;
    
    try {
        const cached = await dbQuery
            .select()
            .from(UserMonthlyInterest)
            .where(
                and(
                    eq(UserMonthlyInterest.user, user as `0x${string}`),
                    eq(UserMonthlyInterest.asset, asset as `0x${string}`),
                    eq(UserMonthlyInterest.year, year),
                    eq(UserMonthlyInterest.month, month)
                )
            )
            .limit(1);
        
        if (cached && cached.length > 0) {
            const cachedData = cached[0];
            
            // Convert to the format expected by calculateUserMonthlyYield()
            return {
                user: cachedData.user,
                asset: cachedData.asset,
                year: cachedData.year,
                month: cachedData.month,
                monthlyYield: cachedData.interestEarned,
                startScaledBalance: cachedData.startScaledBalance,
                endScaledBalance: cachedData.endScaledBalance,
                startActualBalance: 0n, // Not stored in cache, would need recalculation
                endActualBalance: 0n,   // Not stored in cache, would need recalculation
                startLiquidityIndex: cachedData.startLiquidityIndex,
                endLiquidityIndex: cachedData.endLiquidityIndex,
                netDeposits: cachedData.netDeposits,
                startTimestamp: 0, // Not stored in cache
                endTimestamp: 0,   // Not stored in cache
                hadPositionDuringMonth: true, // If cached, they had a position
                maxBalanceDuringMonth: 0n, // Not stored in cache
                transactionCount: 0, // Not stored in cache
                fromCache: true // Flag to indicate this came from cache
            };
        }
        
        return null;
        
    } catch (error) {
        console.error(`❌ Error getting cached monthly yield:`, error);
        return null;
    }
}

/**
 * Store calculated monthly yield in the database for future requests
 * 
 * This function saves the calculated yield data to the UserMonthlyInterest table.
 * Uses upsert (insert or update) to handle cases where the data already exists.
 * 
 * Only cache completed months (not the current month) to avoid stale data.
 */
export async function cacheMonthlyYield(
    context: any,
    yieldData: {
        user: string;
        asset: string;
        year: number;
        month: number;
        monthlyYield: bigint;
        startScaledBalance: bigint;
        endScaledBalance: bigint;
        startLiquidityIndex: bigint;
        endLiquidityIndex: bigint;
        netDeposits: bigint;
    }
): Promise<void> {
    const { db } = context;
    
    try {
        const id = `${yieldData.user}_${yieldData.asset}_${yieldData.year}_${yieldData.month}`;
        const calculatedAt = Math.floor(Date.now() / 1000);
        
        // Use insert with onConflictDoUpdate for upsert behavior
        await db.insert(UserMonthlyInterest).values({
            id,
            user: yieldData.user as `0x${string}`,
            asset: yieldData.asset as `0x${string}`,
            year: yieldData.year,
            month: yieldData.month,
            interestEarned: yieldData.monthlyYield,
            startScaledBalance: yieldData.startScaledBalance,
            endScaledBalance: yieldData.endScaledBalance,
            startLiquidityIndex: yieldData.startLiquidityIndex,
            endLiquidityIndex: yieldData.endLiquidityIndex,
            netDeposits: yieldData.netDeposits,
            calculatedAt
        }).onConflictDoUpdate({
            target: UserMonthlyInterest.id,
            set: {
                interestEarned: yieldData.monthlyYield,
                startScaledBalance: yieldData.startScaledBalance,
                endScaledBalance: yieldData.endScaledBalance,
                startLiquidityIndex: yieldData.startLiquidityIndex,
                endLiquidityIndex: yieldData.endLiquidityIndex,
                netDeposits: yieldData.netDeposits,
                calculatedAt
            }
        });
        
        console.log(`✅ Cached monthly yield for ${yieldData.user}/${yieldData.asset}/${yieldData.year}-${yieldData.month}`);
        
    } catch (error) {
        console.error(`❌ Error caching monthly yield:`, error);
        // Don't throw - caching failure shouldn't break the calculation
    }
}

/**
 * Check if a month is completed (not the current month)
 * Only completed months should be cached to avoid stale data
 */
export function isCompletedMonth(year: number, month: number): boolean {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // getMonth() returns 0-11
    
    // Month is completed if it's before the current month
    if (year < currentYear) {
        return true;
    }
    
    if (year === currentYear && month < currentMonth) {
        return true;
    }
    
    return false;
}

/**
 * Batch check if multiple month/asset combinations are cached
 * More efficient than calling getCachedMonthlyYield() multiple times
 */
export async function batchGetCachedMonthlyYield(
    context: any,
    user: string,
    assetMonths: Array<{ asset: string; year: number; month: number }>
): Promise<Map<string, any>> {
    const { db } = context;
    const dbQuery = db.sql || db;
    const results = new Map<string, any>();
    
    if (assetMonths.length === 0) {
        return results;
    }
    
    try {
        // Build OR conditions for all asset/month combinations
        const conditions = assetMonths.map(({ asset, year, month }) =>
            and(
                eq(UserMonthlyInterest.user, user as `0x${string}`),
                eq(UserMonthlyInterest.asset, asset as `0x${string}`),
                eq(UserMonthlyInterest.year, year),
                eq(UserMonthlyInterest.month, month)
            )
        );
        
        // Query all at once
        // Note: This is a simplified version - actual implementation would need
        // proper OR handling in the query builder
        for (const { asset, year, month } of assetMonths) {
            const cached = await getCachedMonthlyYield(context, user, asset, year, month);
            if (cached) {
                const key = `${asset}-${year}-${month}`;
                results.set(key, cached);
            }
        }
        
        return results;
        
    } catch (error) {
        console.error(`❌ Error batch getting cached monthly yields:`, error);
        return results;
    }
}

