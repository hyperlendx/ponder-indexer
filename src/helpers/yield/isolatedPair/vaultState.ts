/**
 * Vault State Management for Isolated Pairs
 *
 * This module tracks the totalAsset and totalBorrow state for each isolated pair,
 * mirroring the VaultAccount structs in the contract.
 *
 * Both asset and borrow state are needed for precise interest rate extrapolation:
 * - Interest accrues on totalBorrowAmount (not totalAssetAmount)
 * - The supply rate depends on utilization (totalBorrowAmount / totalAssetAmount)
 */

import { IsolatedPairVaultState } from "../../../../ponder.schema";
import { eq, lte, desc, and } from "ponder";

export interface VaultState {
    totalAssetAmount: bigint;
    totalAssetShares: bigint;
    totalBorrowAmount: bigint;
    totalBorrowShares: bigint;
}

export interface VaultStateWithTimestamp extends VaultState {
    timestamp: number;
}

/**
 * Get the current vault state for a pair
 */
export async function getCurrentVaultState(
    db: any,
    pair: string
): Promise<VaultState | null> {
    // Handle both indexing context (db.sql) and API context (db)
    const dbQuery = db.sql || db;

    const states = await dbQuery
        .select()
        .from(IsolatedPairVaultState)
        .where(eq(IsolatedPairVaultState.pair, pair as `0x${string}`))
        .orderBy(
            desc(IsolatedPairVaultState.timestamp),
            desc(IsolatedPairVaultState.blockNumber),
            desc(IsolatedPairVaultState.id)
        )
        .limit(1);

    if (!states || states.length === 0) {
        return null;
    }

    return {
        totalAssetAmount: BigInt(states[0].totalAssetAmount),
        totalAssetShares: BigInt(states[0].totalAssetShares),
        totalBorrowAmount: BigInt(states[0].totalBorrowAmount ?? 0),
        totalBorrowShares: BigInt(states[0].totalBorrowShares ?? 0),
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
): Promise<VaultState | null> {
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
        .orderBy(
            desc(IsolatedPairVaultState.timestamp),
            desc(IsolatedPairVaultState.blockNumber),
            desc(IsolatedPairVaultState.id)
        )
        .limit(1);

    if (!states || states.length === 0) {
        return null;
    }

    return {
        totalAssetAmount: BigInt(states[0].totalAssetAmount),
        totalAssetShares: BigInt(states[0].totalAssetShares),
        totalBorrowAmount: BigInt(states[0].totalBorrowAmount ?? 0),
        totalBorrowShares: BigInt(states[0].totalBorrowShares ?? 0),
    };
}

/**
 * Get vault state at a specific timestamp WITH the timestamp of the state
 * Returns the most recent vault state at or before the target timestamp,
 * including the timestamp when that state was recorded.
 *
 * This is needed for exchange rate extrapolation - we need to know how much
 * time has elapsed since the last state update to calculate accrued interest.
 */
export async function getVaultStateWithTimestamp(
    db: any,
    pair: string,
    targetTimestamp: number
): Promise<VaultStateWithTimestamp | null> {
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
        .orderBy(
            desc(IsolatedPairVaultState.timestamp),
            desc(IsolatedPairVaultState.blockNumber),
            desc(IsolatedPairVaultState.id)
        )
        .limit(1);

    if (!states || states.length === 0) {
        return null;
    }

    return {
        totalAssetAmount: BigInt(states[0].totalAssetAmount),
        totalAssetShares: BigInt(states[0].totalAssetShares),
        totalBorrowAmount: BigInt(states[0].totalBorrowAmount ?? 0),
        totalBorrowShares: BigInt(states[0].totalBorrowShares ?? 0),
        timestamp: states[0].timestamp,
    };
}

/**
 * Update vault state after a deposit
 * Deposit increases both totalAsset.amount and totalAsset.shares
 * Borrow state remains unchanged
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
): Promise<VaultState> {
    const currentState = await getCurrentVaultState(db, pair);

    const newState: VaultState = {
        totalAssetAmount: currentState ? currentState.totalAssetAmount + assets : assets,
        totalAssetShares: currentState ? currentState.totalAssetShares + shares : shares,
        totalBorrowAmount: currentState?.totalBorrowAmount ?? 0n,
        totalBorrowShares: currentState?.totalBorrowShares ?? 0n,
    };

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newState.totalAssetAmount,
        totalAssetShares: newState.totalAssetShares,
        totalBorrowAmount: newState.totalBorrowAmount,
        totalBorrowShares: newState.totalBorrowShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return newState;
}

/**
 * Update vault state after a withdrawal
 * Withdrawal decreases both totalAsset.amount and totalAsset.shares
 * Borrow state remains unchanged
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
): Promise<VaultState | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before withdrawal`);
        return null;
    }

    const newState: VaultState = {
        totalAssetAmount: currentState.totalAssetAmount - assets,
        totalAssetShares: currentState.totalAssetShares - shares,
        totalBorrowAmount: currentState.totalBorrowAmount,
        totalBorrowShares: currentState.totalBorrowShares,
    };

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newState.totalAssetAmount,
        totalAssetShares: newState.totalAssetShares,
        totalBorrowAmount: newState.totalBorrowAmount,
        totalBorrowShares: newState.totalBorrowShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return newState;
}

/**
 * Update vault state after interest accrual
 * AddInterest increases totalAsset.amount by interestEarned and totalAsset.shares by feesShare
 * AddInterest also increases totalBorrow.amount by interestEarned (borrowers owe more)
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
): Promise<VaultState | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before adding interest`);
        return null;
    }

    const newState: VaultState = {
        totalAssetAmount: currentState.totalAssetAmount + interestEarned,
        totalAssetShares: currentState.totalAssetShares + feesShare,
        // Interest accrued increases the borrow amount (borrowers owe more)
        totalBorrowAmount: currentState.totalBorrowAmount + interestEarned,
        totalBorrowShares: currentState.totalBorrowShares, // Shares don't change on interest
    };

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newState.totalAssetAmount,
        totalAssetShares: newState.totalAssetShares,
        totalBorrowAmount: newState.totalBorrowAmount,
        totalBorrowShares: newState.totalBorrowShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return newState;
}

/**
 * Update vault state after a borrow
 * Borrow increases totalBorrow.amount and totalBorrow.shares
 * Asset state remains unchanged (assets are transferred out but totalAsset tracks deposits)
 */
export async function updateVaultStateAfterBorrow(
    db: any,
    pair: string,
    borrowAmount: bigint,
    sharesAdded: bigint,
    timestamp: number,
    blockNumber: number,
    txHash: string,
    eventId: string
): Promise<VaultState | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before borrow`);
        return null;
    }

    const newState: VaultState = {
        totalAssetAmount: currentState.totalAssetAmount,
        totalAssetShares: currentState.totalAssetShares,
        totalBorrowAmount: currentState.totalBorrowAmount + borrowAmount,
        totalBorrowShares: currentState.totalBorrowShares + sharesAdded,
    };

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newState.totalAssetAmount,
        totalAssetShares: newState.totalAssetShares,
        totalBorrowAmount: newState.totalBorrowAmount,
        totalBorrowShares: newState.totalBorrowShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return newState;
}

/**
 * Update vault state after a repay
 * Repay decreases totalBorrow.amount and totalBorrow.shares
 * Asset state remains unchanged
 */
export async function updateVaultStateAfterRepay(
    db: any,
    pair: string,
    amountRepaid: bigint,
    sharesRepaid: bigint,
    timestamp: number,
    blockNumber: number,
    txHash: string,
    eventId: string
): Promise<VaultState | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before repay`);
        return null;
    }

    const newState: VaultState = {
        totalAssetAmount: currentState.totalAssetAmount,
        totalAssetShares: currentState.totalAssetShares,
        totalBorrowAmount: currentState.totalBorrowAmount - amountRepaid,
        totalBorrowShares: currentState.totalBorrowShares - sharesRepaid,
    };

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newState.totalAssetAmount,
        totalAssetShares: newState.totalAssetShares,
        totalBorrowAmount: newState.totalBorrowAmount,
        totalBorrowShares: newState.totalBorrowShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return newState;
}

/**
 * Update vault state after liquidation
 * Liquidation adjusts both asset and borrow state
 * - Asset state: adjusted by sharesToAdjust and amountToAdjust (repaid amount goes to lenders)
 * - Borrow state: decreased by the repaid amount and shares
 */
export async function updateVaultStateAfterLiquidation(
    db: any,
    pair: string,
    assetSharesToAdjust: bigint,
    assetAmountToAdjust: bigint,
    borrowAmountRepaid: bigint,
    borrowSharesRepaid: bigint,
    timestamp: number,
    blockNumber: number,
    txHash: string,
    eventId: string
): Promise<VaultState | null> {
    const currentState = await getCurrentVaultState(db, pair);

    if (!currentState) {
        console.error(`No vault state found for pair ${pair} before liquidation`);
        return null;
    }

    const newState: VaultState = {
        totalAssetAmount: currentState.totalAssetAmount + assetAmountToAdjust,
        totalAssetShares: currentState.totalAssetShares + assetSharesToAdjust,
        totalBorrowAmount: currentState.totalBorrowAmount - borrowAmountRepaid,
        totalBorrowShares: currentState.totalBorrowShares - borrowSharesRepaid,
    };

    await db.insert(IsolatedPairVaultState).values({
        id: `${pair}-${eventId}`,
        pair: pair as `0x${string}`,
        totalAssetAmount: newState.totalAssetAmount,
        totalAssetShares: newState.totalAssetShares,
        totalBorrowAmount: newState.totalBorrowAmount,
        totalBorrowShares: newState.totalBorrowShares,
        timestamp,
        blockNumber,
        txHash: txHash as `0x${string}`,
    });

    return newState;
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

