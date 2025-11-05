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
 * @param interactionType - Type of interaction (deposit, withdraw, borrow, repay, addCollateral, removeCollateral, liquidate)
 */
export async function updateUserIsolatedPairTracking(
    context: any,
    user: string,
    pair: string,
    timestamp: number,
    interactionType: 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'addCollateral' | 'removeCollateral' | 'liquidate'
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
                case 'liquidate':
                    updates.hasLiquidations = true;
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
                hasLiquidations: interactionType === 'liquidate',
                firstInteraction: timestamp,
                lastInteraction: timestamp,
            };
            
            await context.db.insert(UserIsolatedPairTracking).values(newRecord);
        }
    } catch (error: any) {
        console.error(`Error updating isolated pair tracking for ${user} - ${pair}:`, error.message);
    }
}
