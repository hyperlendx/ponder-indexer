/**
 * Vault State Management for Isolated Pairs
 *
 * This module tracks the totalAsset.amount and totalAsset.shares for each isolated pair,
 * mirroring the VaultAccount struct in the contract.
 */

import { IsolatedPairVaultState } from "../../../../ponder.schema";
import { eq, lte, desc, and } from "ponder";

/**
 * Get the current vault state for a pair
 */
export async function getCurrentVaultState(
    db: any,
    pair: string
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint } | null> {
    // Handle both indexing context (db.sql) and API context (db)
    const dbQuery = db.sql || db;

    const states = await dbQuery
        .select()
        .from(IsolatedPairVaultState)
        .where(eq(IsolatedPairVaultState.pair, pair as `0x${string}`))
        .orderBy(desc(IsolatedPairVaultState.timestamp))
        .limit(1);

    if (!states || states.length === 0) {
        return null;
    }

    return {
        totalAssetAmount: BigInt(states[0].totalAssetAmount),
        totalAssetShares: BigInt(states[0].totalAssetShares),
    };
}

/**
 * Get vault state at a specific timestamp
 * Returns the most recent vault state at or before the target timestamp
 */
export async function getVaultStateAtTimestamp(
    db: any,
    pair: string,
    targetTimestamp: number
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint } | null> {
    // Handle both indexing context (db.sql) and API context (db)
    const dbQuery = db.sql || db;

    const states = await dbQuery
        .select()
        .from(IsolatedPairVaultState)
        .where(
            and(
                eq(IsolatedPairVaultState.pair, pair as `0x${string}`),
                lte(IsolatedPairVaultState.timestamp, targetTimestamp)
            )
        )
        .orderBy(desc(IsolatedPairVaultState.timestamp), desc(IsolatedPairVaultState.blockNumber))
        .limit(1);

    if (!states || states.length === 0) {
        return null;
    }

    return {
        totalAssetAmount: BigInt(states[0].totalAssetAmount),
        totalAssetShares: BigInt(states[0].totalAssetShares),
    };
}

/**
 * Update vault state after a deposit
 * Deposit increases both totalAsset.amount and totalAsset.shares
 */
export async function updateVaultStateAfterDeposit(
    db: any,
    pair: string,
    assets: bigint,
    shares: bigint,
    timestamp: number,
    blockNumber: number,
    txHash: string,
    eventId: string
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint }> {
    const currentState = await getCurrentVaultState(db, pair);

    const newTotalAssetAmount = currentState
        ? currentState.totalAssetAmount + assets
        : assets;
    const newTotalAssetShares = currentState
        ? currentState.totalAssetShares + shares
        : shares;

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });


    return {
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
    };
}

/**
 * Update vault state after a withdrawal
 * Withdrawal decreases both totalAsset.amount and totalAsset.shares
 */
export async function updateVaultStateAfterWithdraw(
    db: any,
    pair: string,
    assets: bigint,
    shares: bigint,
    timestamp: number,
    blockNumber: number,
    txHash: string,
    eventId: string
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint } | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before withdrawal`);
        return null;
    }

    const newTotalAssetAmount = currentState.totalAssetAmount - assets;
    const newTotalAssetShares = currentState.totalAssetShares - shares;

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return {
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
    };
}

/**
 * Update vault state after interest accrual
 * AddInterest increases totalAsset.amount by interestEarned and totalAsset.shares by feesShare
 */
export async function updateVaultStateAfterAddInterest(
    db: any,
    pair: string,
    interestEarned: bigint,
    feesShare: bigint,
    timestamp: number,
    blockNumber: number,
    txHash: string,
    eventId: string
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint } | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before adding interest`);
        return null;
    }

    const newTotalAssetAmount = currentState.totalAssetAmount + interestEarned;
    const newTotalAssetShares = currentState.totalAssetShares + feesShare;

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return {
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
    };
}

/**
 * Update vault state after liquidation
 * Liquidation adjusts both totalAsset.amount and totalAsset.shares based on the liquidation parameters
 */
export async function updateVaultStateAfterLiquidation(
    db: any,
    pair: string,
    sharesToAdjust: bigint,
    amountToAdjust: bigint,
    timestamp: number,
    blockNumber: number,
    txHash: string,
    eventId: string
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint } | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before liquidation`);
        return null;
    }

    // Apply the adjustments from the liquidation
    // Note: sharesToAdjust and amountToAdjust can be positive or negative
    const newTotalAssetAmount = currentState.totalAssetAmount + amountToAdjust;
    const newTotalAssetShares = currentState.totalAssetShares + sharesToAdjust;

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return {
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
    };
}

/**
 * Calculate exchange rate from vault state
 * Exchange rate = totalAsset.amount / totalAsset.shares (in EXCHANGE_PRECISION)
 */
export function calculateExchangeRateFromVaultState(
    totalAssetAmount: bigint,
    totalAssetShares: bigint
): bigint {
    const EXCHANGE_PRECISION = 1000000000000000000n; // 1e18

    if (totalAssetShares === 0n) {
        return EXCHANGE_PRECISION; // 1:1 if no shares
    }

    return (totalAssetAmount * EXCHANGE_PRECISION) / totalAssetShares;
}

/**
 * Get exchange rate at a specific timestamp
 */
export async function getExchangeRateAtTimestamp(
    db: any,
    pair: string,
    targetTimestamp: number
): Promise<bigint> {
    const state = await getVaultStateAtTimestamp(db, pair, targetTimestamp);

    if (!state) {
        return 1000000000000000000n; // Default 1:1
    }

    return calculateExchangeRateFromVaultState(
        state.totalAssetAmount,
        state.totalAssetShares
    );
}

