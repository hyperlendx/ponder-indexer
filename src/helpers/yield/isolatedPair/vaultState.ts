/**
 * Vault State Management for Isolated Pairs
 * 
 * This module tracks the totalAsset.amount and totalAsset.shares for each isolated pair,
 * mirroring the VaultAccount struct in the contract.
 */

import { IsolatedPairVaultState } from "../../../../ponder.schema";

/**
 * Get the current vault state for a pair
 */
export async function getCurrentVaultState(
    db: any,
    pair: string
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint } | null> {
    const states = await db
        .select()
        .from(IsolatedPairVaultState)
        .where((row: any) => row.pair === pair)
        .orderBy((row: any) => row.timestamp, "desc")
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
 */
export async function getVaultStateAtTimestamp(
    db: any,
    pair: string,
    targetTimestamp: number
): Promise<{ totalAssetAmount: bigint; totalAssetShares: bigint } | null> {
    const states = await db
        .select()
        .from(IsolatedPairVaultState)
        .where((row: any) => row.pair === pair && row.timestamp <= targetTimestamp)
        .orderBy((row: any) => row.timestamp, "desc")
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
    txHash: string
): Promise<void> {
    const currentState = await getCurrentVaultState(db, pair);

    const newTotalAssetAmount = currentState
        ? currentState.totalAssetAmount + assets
        : assets;
    const newTotalAssetShares = currentState
        ? currentState.totalAssetShares + shares
        : shares;

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${timestamp}-${blockNumber}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });
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
    txHash: string
): Promise<void> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before withdrawal`);
        return;
    }

    const newTotalAssetAmount = currentState.totalAssetAmount - assets;
    const newTotalAssetShares = currentState.totalAssetShares - shares;

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${timestamp}-${blockNumber}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });
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
    txHash: string
): Promise<void> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before adding interest`);
        return;
    }

    const newTotalAssetAmount = currentState.totalAssetAmount + interestEarned;
    const newTotalAssetShares = currentState.totalAssetShares + feesShare;

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${timestamp}-${blockNumber}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newTotalAssetAmount,
        totalAssetShares: newTotalAssetShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });
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

