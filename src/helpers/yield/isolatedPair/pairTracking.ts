/**
 * Isolated Pair Tracking Functions
 * 
 * Functions for tracking which isolated pairs a user has interacted with.
 * Uses the UserIsolatedPairTracking table for efficient lookups.
 */

import { UserIsolatedPairTracking } from "ponder:schema";
import { eq } from "ponder";

/**
 * Get all isolated pairs a user has interacted with
 *
 * Uses the UserIsolatedPairTracking table for fast lookups.
 * This is much more efficient than scanning all event tables.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Not used anymore, kept for backward compatibility
 * @param endTimestamp - Not used anymore, kept for backward compatibility
 * @returns Array of pair addresses the user has ever interacted with
 * 
 * @example
 * ```typescript
 * const pairs = await getUserIsolatedPairs(context, "0x123...", 0, Date.now());
 * // Returns: ["0xPair1...", "0xPair2..."]
 * ```
 */
export async function getUserIsolatedPairs(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const dbQuery = context.db.sql || context.db;

    try {
        // Use the tracking table for instant lookup
        const trackingRecords = await dbQuery
            .select()
            .from(UserIsolatedPairTracking)
            .where(eq(UserIsolatedPairTracking.user, user as `0x${string}`));

        return trackingRecords.map((record: any) => record.pair);
    } catch (error: any) {
        console.error('Error in getUserIsolatedPairs:', error.message);
        console.error('Stack:', error.stack);
        return [];
    }
}

