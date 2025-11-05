import { UserPosition, UserBalanceEvent, Borrow, Repay, LiquidationCall } from "ponder:schema";
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
        // transactionAmount is positive for these events
        if (event.eventType === 'deposit' || event.eventType === 'transfer_in') {
            totalSupplied += actualAmount;
        }
    }

    return totalSupplied;
}

/**
 * Calculate total withdrawn amount for a user in a specific time period
 * This includes all withdrawals and transfers out, regardless of deposits
 *
 * IMPORTANT: This function now accounts for liquidations as forced withdrawals.
 * When collateral is liquidated, it's treated as a withdrawal from the user's position.
 */
export async function calculateTotalWithdrawn(
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

    let totalWithdrawn = 0n;

    for (const event of events) {
        // Convert transaction amount to actual amount using liquidity index
        const actualAmount = calculateActualBalance(event.transactionAmount, event.liquidityIndex);

        // Only count withdrawal events (withdrawals and transfers out)
        // transactionAmount is stored as negative for these events, so take absolute value
        if (event.eventType === 'withdraw' || event.eventType === 'transfer_out') {
            totalWithdrawn += actualAmount < 0n ? -actualAmount : actualAmount;
        }
    }

    // Add liquidated collateral amounts (treated as forced withdrawals)
    const liquidations = await dbQuery
        .select()
        .from(LiquidationCall)
        .where(
            and(
                eq(LiquidationCall.user, user as `0x${string}`),
                eq(LiquidationCall.collateralAsset, asset as `0x${string}`),
                gte(LiquidationCall.timestamp, startTimestamp),
                lte(LiquidationCall.timestamp, endTimestamp)
            )
        );

    for (const liquidation of liquidations) {
        // liquidatedCollateralAmount is already in actual token amounts
        totalWithdrawn += liquidation.liquidatedCollateralAmount;
    }

    return totalWithdrawn;
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

/**
 * Calculate total repaid amount for a user in a specific time period
 * This includes all repay transactions during the period
 *
 * IMPORTANT: This function now accounts for liquidations as forced repayments.
 * When debt is liquidated, the debtToCover is treated as a repayment on behalf of the user.
 */
export async function calculateTotalRepaid(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const { db } = context;

    const dbQuery = db.sql || db;
    const repayEvents = await dbQuery
        .select()
        .from(Repay)
        .where(
            and(
                eq(Repay.user, user as `0x${string}`),
                eq(Repay.reserve, asset as `0x${string}`),
                gte(Repay.timestamp, startTimestamp),
                lte(Repay.timestamp, endTimestamp)
            )
        );

    let totalRepaid = 0n;

    for (const event of repayEvents) {
        totalRepaid += event.amount;
    }

    // Add liquidated debt amounts (treated as forced repayments)
    const liquidations = await dbQuery
        .select()
        .from(LiquidationCall)
        .where(
            and(
                eq(LiquidationCall.user, user as `0x${string}`),
                eq(LiquidationCall.debtAsset, asset as `0x${string}`),
                gte(LiquidationCall.timestamp, startTimestamp),
                lte(LiquidationCall.timestamp, endTimestamp)
            )
        );

    for (const liquidation of liquidations) {
        // debtToCover is already in actual token amounts
        totalRepaid += liquidation.debtToCover;
    }

    return totalRepaid;
}
