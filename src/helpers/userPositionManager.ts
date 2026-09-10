import { UserPosition, UserBalanceEvent } from "ponder:schema";
import { calculateActualBalance } from "./aave";
import { getLiquidityIndexForEvent } from "./reserveState";

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
    currentLiquidityIndex?: bigint
): Promise<void> {
    const { db } = context;
    // Ponder delivers event.args addresses lowercased, while constants such as USDC_ADDRESS
    // are checksummed. The id columns are plain text (not hex), so the key must be
    // normalized here or two callers can split one position across two rows.
    user = user.toLowerCase();
    asset = asset.toLowerCase();
    const positionId = `${user}_${asset}`;

    if (currentLiquidityIndex === undefined) {
        currentLiquidityIndex = await getLiquidityIndexForEvent(context, asset, timestamp, txHash);
    }

    // Use Ponder's primary-key store API here. Raw `db.sql` reads/writes force the
    // historical indexing cache to flush, which turns this per-event hot path into
    // a database round trip and prevents Ponder from batching writes.
    const existingPosition = await db.find(UserPosition, {id: positionId});

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
    });

    if (newScaledBalance === 0n) {
        // Remove position if balance is zero
        if (existingPosition) {
            await db.delete(UserPosition, {id: positionId});
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
            await db.update(UserPosition, {id: positionId}).set(positionData);
        } else {
            await db.insert(UserPosition).values(positionData);
        }
    }
}
