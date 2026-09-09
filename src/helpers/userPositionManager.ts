import { UserPosition, UserBalanceEvent } from "ponder:schema";
import { calculateActualBalance } from "./aave";
import { getLiquidityIndexForEvent } from "./reserveState";
import { eq } from "ponder";

/**
 * Update or create a user position record
 *
 * @param currentLiquidityIndex - Liquidity index the event was executed against. Callers that
 *   already resolved it (from the in-memory reserve state) pass it in so it is not computed twice.
 */
export async function updateUserPosition(
    context: any,
    user: string,
    asset: string,
    scaledBalanceDelta: bigint,
    eventType: 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out',
    timestamp: number,
    txHash: string,
    blockNumber: bigint,
    logIndex: number,
    assetPrice: bigint, // Oracle price of the asset at the time of the event (8 decimals precision)
    currentLiquidityIndex?: bigint
): Promise<void> {
    const { db } = context;
    const positionId = `${user}_${asset}`;

    if (currentLiquidityIndex === undefined) {
        currentLiquidityIndex = await getLiquidityIndexForEvent(context, asset, timestamp, txHash);
    }

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

    // Unique per log: a transaction can contain several balance events for the same user/asset
    const eventId = `${txHash}_${logIndex}_${user}_${asset}`;

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
        logIndex,
        liquidityIndex: currentLiquidityIndex,
        assetPrice // Oracle price at the time of the event
    });

    if (newScaledBalance === 0n) {
        // Remove position if balance is zero
        if (existingPosition) {
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
            await dbQuery
                .update(UserPosition)
                .set(positionData)
                .where(eq(UserPosition.id, positionId));
        } else {
            await db.insert(UserPosition).values(positionData);
        }
    }
}
