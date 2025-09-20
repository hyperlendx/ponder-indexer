import { User, UserDeposit } from "ponder:schema";

/**
 * Updates a user's deposit balance for a specific token
 * @param context - Ponder context with database access
 * @param userAddress - The user's address
 * @param tokenAddress - The token/reserve address
 * @param amountDelta - The change in balance (positive for deposits, negative for withdrawals)
 * @param timestamp - Transaction timestamp
 */
export async function updateUserDepositBalance(
    context: any,
    userAddress: string,
    tokenAddress: string,
    amountDelta: bigint,
    timestamp: number
) {
    const { db } = context;
    const userDepositId = `${userAddress}_${tokenAddress}`;

    // Ensure user exists
    await ensureUserExists(context, userAddress, timestamp);

    // Get existing user deposit record
    const existingDeposit = await db.find(UserDeposit, { id: userDepositId });

    if (existingDeposit) {
        // Update existing deposit balance
        const newBalance = existingDeposit.currentBalance + amountDelta;

        console.log(`💰 Balance update for ${userAddress}:`, {
            token: tokenAddress,
            previousBalance: existingDeposit.currentBalance.toString(),
            amountDelta: amountDelta.toString(),
            newBalance: newBalance.toString()
        });

        if (newBalance === 0n) {
            // Remove deposit record if balance reaches zero
            console.log(`🗑️ Removing zero balance record for ${userAddress}, token ${tokenAddress}`);
            await db.delete(UserDeposit, { id: userDepositId });
            await decrementUserDepositCount(context, userAddress, timestamp);
        } else if (newBalance > 0n) {
            // Update balance if positive
            await db.update(UserDeposit, { id: userDepositId }).set({
                currentBalance: newBalance,
                lastUpdated: timestamp,
            });
        } else {
            // Log warning if balance would go negative (shouldn't happen in normal operation)
            console.warn(`Warning: User ${userAddress} deposit balance for token ${tokenAddress} would go negative: ${newBalance.toString()}`);

            // Set balance to zero and remove record
            await db.delete(UserDeposit, { id: userDepositId });
            await decrementUserDepositCount(context, userAddress, timestamp);
        }
    } else if (amountDelta > 0n) {
        // Create new deposit record for positive amounts
        await db.insert(UserDeposit).values({
            id: userDepositId,
            user: userAddress as `0x${string}`,
            token: tokenAddress as `0x${string}`,
            currentBalance: amountDelta,
            lastUpdated: timestamp,
        });
        await incrementUserDepositCount(context, userAddress, timestamp);
    } else {
        // Log warning if trying to withdraw from non-existent deposit
        console.warn(`Warning: Attempting to withdraw ${amountDelta.toString()} from non-existent deposit for user ${userAddress}, token ${tokenAddress}`);
    }
}

/**
 * Ensures a user record exists in the database
 */
async function ensureUserExists(context: any, userAddress: string, timestamp: number) {
    const { db } = context;
    const existingUser = await db.find(User, { id: userAddress as `0x${string}` });
    
    if (!existingUser) {
        await db.insert(User).values({
            id: userAddress as `0x${string}`,
            totalDepositCount: 0,
            lastUpdated: timestamp,
        });
    }
}

/**
 * Increments the user's total deposit count when they start depositing a new token
 */
async function incrementUserDepositCount(context: any, userAddress: string, timestamp: number) {
    const { db } = context;
    const user = await db.find(User, { id: userAddress as `0x${string}` });
    
    if (user) {
        await db.update(User, { id: userAddress as `0x${string}` }).set({
            totalDepositCount: user.totalDepositCount + 1,
            lastUpdated: timestamp,
        });
    }
}

/**
 * Decrements the user's total deposit count when they fully withdraw a token
 */
async function decrementUserDepositCount(context: any, userAddress: string, timestamp: number) {
    const { db } = context;
    const user = await db.find(User, { id: userAddress as `0x${string}` });
    
    if (user && user.totalDepositCount > 0) {
        await db.update(User, { id: userAddress as `0x${string}` }).set({
            totalDepositCount: user.totalDepositCount - 1,
            lastUpdated: timestamp,
        });
    }
}
