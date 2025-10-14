/**
 * User Isolated Pair Tracking Helper
 * 
 * This module maintains a tracking table that records which isolated pairs
 * each user has interacted with. This enables fast lookups without scanning
 * all event tables.
 */

import { UserIsolatedPairTracking } from "ponder:schema";

/**
 * Update the tracking table when a user interacts with an isolated pair
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Timestamp of the interaction
 * @param interactionType - Type of interaction (deposit, withdraw, borrow, repay, addCollateral, removeCollateral)
 */
export async function updateUserIsolatedPairTracking(
    context: any,
    user: string,
    pair: string,
    timestamp: number,
    interactionType: 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'addCollateral' | 'removeCollateral'
): Promise<void> {
    const trackingId = `${user}_${pair}`;
    
    try {
        // Try to find existing tracking record
        const existing = await context.db.find(UserIsolatedPairTracking, { id: trackingId });
        
        if (existing) {
            // Update existing record
            const updates: any = {
                lastInteraction: timestamp,
            };
            
            // Set the appropriate flag based on interaction type
            switch (interactionType) {
                case 'deposit':
                    updates.hasDeposits = true;
                    break;
                case 'withdraw':
                    updates.hasWithdraws = true;
                    break;
                case 'borrow':
                    updates.hasBorrows = true;
                    break;
                case 'repay':
                    updates.hasRepays = true;
                    break;
                case 'addCollateral':
                    updates.hasCollateralAdded = true;
                    break;
                case 'removeCollateral':
                    updates.hasCollateralRemoved = true;
                    break;
            }
            
            await context.db.update(UserIsolatedPairTracking, { id: trackingId }).set(updates);
        } else {
            // Create new tracking record
            const newRecord: any = {
                id: trackingId,
                user: user as `0x${string}`,
                pair: pair as `0x${string}`,
                hasDeposits: interactionType === 'deposit',
                hasWithdraws: interactionType === 'withdraw',
                hasBorrows: interactionType === 'borrow',
                hasRepays: interactionType === 'repay',
                hasCollateralAdded: interactionType === 'addCollateral',
                hasCollateralRemoved: interactionType === 'removeCollateral',
                firstInteraction: timestamp,
                lastInteraction: timestamp,
            };
            
            await context.db.insert(UserIsolatedPairTracking).values(newRecord);
        }
    } catch (error: any) {
        console.error(`Error updating isolated pair tracking for ${user} - ${pair}:`, error.message);
        // Don't throw - we don't want tracking failures to break event processing
    }
}

/**
 * Get all isolated pairs a user has interacted with
 * This is the fast lookup function that replaces scanning all event tables
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @returns Array of pair addresses
 */
export async function getUserIsolatedPairsFromTracking(
    context: any,
    user: string
): Promise<string[]> {
    try {
        const dbQuery = context.db.sql || context.db;
        
        const trackingRecords = await dbQuery
            .select()
            .from(UserIsolatedPairTracking)
            .where((table: any) => table.user.equals(user as `0x${string}`));
        
        return trackingRecords.map((record: any) => record.pair);
    } catch (error: any) {
        console.error(`Error getting isolated pairs from tracking for ${user}:`, error.message);
        return [];
    }
}

/**
 * Get detailed tracking information for a user's isolated pairs
 * Useful for debugging or showing interaction history
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @returns Array of tracking records with interaction details
 */
export async function getUserIsolatedPairTrackingDetails(
    context: any,
    user: string
): Promise<Array<{
    pair: string;
    hasDeposits: boolean;
    hasWithdraws: boolean;
    hasBorrows: boolean;
    hasRepays: boolean;
    hasCollateralAdded: boolean;
    hasCollateralRemoved: boolean;
    firstInteraction: number;
    lastInteraction: number;
}>> {
    try {
        const dbQuery = context.db.sql || context.db;
        
        const trackingRecords = await dbQuery
            .select()
            .from(UserIsolatedPairTracking)
            .where((table: any) => table.user.equals(user as `0x${string}`));
        
        return trackingRecords.map((record: any) => ({
            pair: record.pair,
            hasDeposits: record.hasDeposits,
            hasWithdraws: record.hasWithdraws,
            hasBorrows: record.hasBorrows,
            hasRepays: record.hasRepays,
            hasCollateralAdded: record.hasCollateralAdded,
            hasCollateralRemoved: record.hasCollateralRemoved,
            firstInteraction: record.firstInteraction,
            lastInteraction: record.lastInteraction,
        }));
    } catch (error: any) {
        console.error(`Error getting isolated pair tracking details for ${user}:`, error.message);
        return [];
    }
}

