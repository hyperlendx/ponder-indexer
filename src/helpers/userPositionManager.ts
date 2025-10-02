import { UserPosition, UserBalanceEvent, ReserveDataEvent, Borrow } from "ponder:schema";
import { calculateLiquidityIndexAtTimestamp, calculateActualBalance, RAY } from "./aave";
import { eq, and, gte, lte, desc } from "ponder";

/**
 * Check for duplicate events to prevent double-counting
 */
async function checkForDuplicateEvents(
    context: any,
    user: string,
    asset: string,
    txHash: string,
    eventType: string,
    scaledBalanceDelta: bigint
): Promise<boolean> {
    const { db } = context;

    try {
        // Look for existing events in the same transaction for the same user/asset
        // Handle both indexing context (db.sql) and API context (db)
        const dbQuery = db.sql || db;
        const existingEvents = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.txHash, txHash as `0x${string}`),
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    eq(UserBalanceEvent.asset, asset as `0x${string}`),
                    eq(UserBalanceEvent.eventType, eventType)
                )
            );

        // Check if we have an event with the same scaled balance delta
        // @ts-ignore
        const duplicate = existingEvents.find(event =>
            event.scaledBalance === scaledBalanceDelta
        );

        return !!duplicate;
    } catch (error) {
        console.warn('Error checking for duplicate events:', error);
        // If we can't check for duplicates, allow the event to proceed
        return false;
    }
}

/**
 * Update or create a user position record
 */
export async function updateUserPosition(
    context: any,
    user: string,
    asset: string,
    scaledBalanceDelta: bigint,
    eventType: 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out',
    timestamp: number,
    txHash: string,
    blockNumber: bigint
): Promise<void> {
    const { db } = context;
    const positionId = `${user}_${asset}`;

    // Duplicate event detection
    const isDuplicate = await checkForDuplicateEvents(
        context,
        user,
        asset,
        txHash,
        eventType,
        scaledBalanceDelta
    );

    if (isDuplicate) {
        console.warn(`🚫 Skipping duplicate event:`, {
            txHash,
            user,
            asset,
            eventType,
            scaledBalanceDelta: scaledBalanceDelta.toString()
        });
        return;
    }

    // Get current liquidity index for this asset at this timestamp
    // Pass the transaction hash to check for ReserveDataUpdated events in the same transaction
    const currentLiquidityIndex = await calculateLiquidityIndexAtTimestamp(
        context,
        asset,
        timestamp,
        txHash
    );

    // Get existing position
    const dbQuery = db.sql || db;
    const existingPositions = await dbQuery
        .select()
        .from(UserPosition)
        .where(eq(UserPosition.id, positionId));

    const existingPosition = existingPositions[0] || null;

    let newScaledBalance: bigint;
    let totalDeposits: bigint;
    let totalWithdrawals: bigint;

    if (existingPosition) {
        // Update existing position
        newScaledBalance = existingPosition.scaledBalance + scaledBalanceDelta;
        totalDeposits = existingPosition.totalDeposits;
        totalWithdrawals = existingPosition.totalWithdrawals;

        // Update cumulative deposits/withdrawals based on event type
        if (eventType === 'deposit' || eventType === 'transfer_in') {
            const actualAmount = calculateActualBalance(scaledBalanceDelta, currentLiquidityIndex);
            totalDeposits += actualAmount;
        } else if (eventType === 'withdraw' || eventType === 'transfer_out') {
            const actualAmount = calculateActualBalance(
                scaledBalanceDelta < 0n ? -scaledBalanceDelta : scaledBalanceDelta,
                currentLiquidityIndex
            );
            totalWithdrawals += actualAmount;
        }
    } else {
        // Create new position
        newScaledBalance = scaledBalanceDelta;
        
        if (eventType === 'deposit' || eventType === 'transfer_in') {
            const actualAmount = calculateActualBalance(scaledBalanceDelta, currentLiquidityIndex);
            totalDeposits = actualAmount;
            totalWithdrawals = 0n;
        } else {
            totalDeposits = 0n;
            const actualAmount = calculateActualBalance(
                scaledBalanceDelta < 0n ? -scaledBalanceDelta : scaledBalanceDelta,
                currentLiquidityIndex
            );
            totalWithdrawals = actualAmount;
        }
    }

    if (newScaledBalance < 0n) {
        console.error(`❌ Negative scaled balance detected:`, {
            user,
            asset,
            newScaledBalance: newScaledBalance.toString(),
            scaledBalanceDelta: scaledBalanceDelta.toString(),
            eventType,
            txHash
        });
        // Set to 0 to prevent negative balances
        newScaledBalance = 0n;
    }

    // Calculate new actual balance
    const newActualBalance = calculateActualBalance(newScaledBalance, currentLiquidityIndex);

    // Record the balance event using Ponder's insert method
    // Use a truly unique ID to avoid conflicts when multiple events occur in same transaction
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const eventId = `${txHash}_${user}_${asset}_${eventType}_${timestamp}_${randomSuffix}`;

    await db.insert(UserBalanceEvent).values({
        id: eventId,
        txHash: txHash as `0x${string}`,
        user: user as `0x${string}`,
        asset: asset as `0x${string}`,
        scaledBalance: newScaledBalance, // Total balance after transaction
        transactionAmount: scaledBalanceDelta, // Actual transaction amount (scaled)
        eventType,
        timestamp,
        blockNumber,
        liquidityIndex: currentLiquidityIndex
    });

    if (newScaledBalance === 0n) {
        // Remove position if balance is zero
        if (existingPosition) {
            const dbQuery = db.sql || db;
            await dbQuery
                .delete(UserPosition)
                .where(eq(UserPosition.id, positionId));
        }
    } else {
        // Update or create position
        const positionData = {
            id: positionId,
            user: user as `0x${string}`,
            asset: asset as `0x${string}`,
            scaledBalance: newScaledBalance,
            actualBalance: newActualBalance,
            totalDeposits,
            totalWithdrawals,
            lastUpdated: timestamp,
            lastLiquidityIndex: currentLiquidityIndex,
        };

        if (existingPosition) {
            const dbQuery = db.sql || db;
            await dbQuery
                .update(UserPosition)
                .set(positionData)
                .where(eq(UserPosition.id, positionId));
        } else {
            await db.insert(UserPosition).values(positionData);
        }
    }
}

/**
 * Get all positions for a user
 */
export async function getUserPositions(
    context: any,
    user: string
): Promise<Array<{
    asset: string;
    scaledBalance: bigint;
    actualBalance: bigint;
    totalDeposits: bigint;
    totalWithdrawals: bigint;
    lastUpdated: number;
    currentYield: bigint;
}>> {
    const { db } = context;
    // Query all positions for the user using Drizzle ORM pattern
    const positions = await db
        .select()
        .from(UserPosition)
        .where(eq(UserPosition.user, user as `0x${string}`));

    const result = [];

    for (const position of positions) {
        // Get the most recent liquidity index directly from ReserveDataEvent
        const mostRecentEvent = await context.db
            .select()
            .from(ReserveDataEvent)
            .where(eq(ReserveDataEvent.reserve, position.asset as `0x${string}`))
            .orderBy(desc(ReserveDataEvent.timestamp))
            .limit(1);

        const currentLiquidityIndex = mostRecentEvent.length > 0
            ? BigInt(mostRecentEvent[0].liquidityIndex)
            : RAY; // Fallback to RAY if no events found

        // Calculate current actual balance
        const currentActualBalance = calculateActualBalance(
            position.scaledBalance,
            currentLiquidityIndex
        );

        // Calculate current yield
        const netDeposits = BigInt(position.totalDeposits) - BigInt(position.totalWithdrawals);

        const currentYield = currentActualBalance - netDeposits;

        result.push({
            asset: position.asset,
            scaledBalance: position.scaledBalance,
            actualBalance: currentActualBalance,
            totalDeposits: position.totalDeposits,
            totalWithdrawals: position.totalWithdrawals,
            lastUpdated: position.lastUpdated,
            currentYield,
        });
    }

    return result;
}

/**
 * Calculate net deposits for a user in a specific time period
 */
export async function calculateNetDeposits(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const { db } = context;

    const dbQuery = db.sql || db;
    const events = await dbQuery
        .select()
        .from(UserBalanceEvent)
        .where(
            and(
                eq(UserBalanceEvent.user, user as `0x${string}`),
                eq(UserBalanceEvent.asset, asset as `0x${string}`),
                gte(UserBalanceEvent.timestamp, startTimestamp),
                lte(UserBalanceEvent.timestamp, endTimestamp)
            )
        );

    let netDeposits = 0n;

    for (const event of events) {
        // Convert transaction amount to actual amount using liquidity index
        // transactionAmount should always be positive (represents the amount of the transaction)
        const actualAmount = calculateActualBalance(event.transactionAmount, event.liquidityIndex);

        // Apply correct sign based on event type
        if (event.eventType === 'deposit' || event.eventType === 'transfer_in') {
            netDeposits += actualAmount; // Deposits increase net deposits
        } else if (event.eventType === 'withdraw' || event.eventType === 'transfer_out') {
            netDeposits -= actualAmount; // Withdrawals decrease net deposits
        }
    }

    return netDeposits;
}

/**
 * Calculate total supplied amount for a user in a specific time period
 * This includes all deposits and transfers in, regardless of withdrawals
 */
export async function calculateTotalSupplied(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const { db } = context;

    const dbQuery = db.sql || db;
    const events = await dbQuery
        .select()
        .from(UserBalanceEvent)
        .where(
            and(
                eq(UserBalanceEvent.user, user as `0x${string}`),
                eq(UserBalanceEvent.asset, asset as `0x${string}`),
                gte(UserBalanceEvent.timestamp, startTimestamp),
                lte(UserBalanceEvent.timestamp, endTimestamp)
            )
        );

    let totalSupplied = 0n;

    for (const event of events) {
        // Convert transaction amount to actual amount using liquidity index
        const actualAmount = calculateActualBalance(event.transactionAmount, event.liquidityIndex);

        // Only count supply events (deposits and transfers in)
        if (event.eventType === 'deposit' || event.eventType === 'transfer_in') {
            totalSupplied += actualAmount;
        }
    }

    return totalSupplied;
}

/**
 * Calculate total borrowed amount for a user in a specific time period
 * This includes all borrow transactions during the period
 */
export async function calculateTotalBorrowed(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const { db } = context;

    const dbQuery = db.sql || db;
    const borrowEvents = await dbQuery
        .select()
        .from(Borrow)
        .where(
            and(
                eq(Borrow.onBehalfOf, user as `0x${string}`),
                eq(Borrow.reserve, asset as `0x${string}`),
                gte(Borrow.timestamp, startTimestamp),
                lte(Borrow.timestamp, endTimestamp)
            )
        );

    let totalBorrowed = 0n;

    for (const event of borrowEvents) {
        totalBorrowed += event.amount;
    }

    return totalBorrowed;
}
