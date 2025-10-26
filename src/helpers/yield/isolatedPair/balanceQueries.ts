/**
 * Isolated Pair Balance Query Functions
 * 
 * Functions for querying user balances (collateral, asset shares, borrow shares)
 * at specific timestamps. These functions aggregate historical events to calculate
 * current balances.
 */

import {
    BorrowAssetIsolated,
    RepayAssetIsolated,
    AddCollateralIsolated,
    RemoveCollateralIsolated,
    DepositIsolated,
    WithdrawIsolated
} from "ponder:schema";
import { eq, and, lte } from "ponder";
import { EXCHANGE_PRECISION } from "./constants";

/**
 * Enhanced balance result that includes both balance and contributing events
 */
export interface BalanceWithEvents {
    balance: bigint;
    events: Array<{
        eventType: 'collateral_add' | 'collateral_remove' | 'deposit' | 'withdraw' | 'borrow' | 'repay';
        timestamp: number;
        date: string;
        amount: string;
        txHash: string;
    }>;
}

/**
 * Get collateral balance for a user in an isolated pair at a specific timestamp
 * 
 * Collateral = Σ(AddCollateral) - Σ(RemoveCollateral)
 * 
 * Note: Collateral does NOT earn yield - it only backs borrows.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Collateral balance in asset tokens
 * 
 * @example
 * ```typescript
 * const collateral = await getIsolatedPairCollateralBalance(context, "0x123...", "0xPair...", 1234567890);
 * // Returns: 1000000000000000000n (1 token with 18 decimals)
 * ```
 */
export async function getIsolatedPairCollateralBalance(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    // Get all collateral events up to timestamp
    const [addEvents, removeEvents] = await Promise.all([
        dbQuery.select().from(AddCollateralIsolated).where(
            and(
                eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                eq(AddCollateralIsolated.pair, pair as `0x${string}`),
                lte(AddCollateralIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(RemoveCollateralIsolated).where(
            and(
                eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                eq(RemoveCollateralIsolated.pair, pair as `0x${string}`),
                lte(RemoveCollateralIsolated.timestamp, timestamp)
            )
        )
    ]);
    
    // Calculate net collateral
    let collateralBalance = 0n;
    
    for (const event of addEvents) {
        collateralBalance += event.collateralAmount;
    }
    
    for (const event of removeEvents) {
        collateralBalance -= event.collateralAmount;
    }
    
    return collateralBalance > 0n ? collateralBalance : 0n;
}

/**
 * Get asset shares for a user in an isolated pair at a specific timestamp
 * 
 * Asset Shares = Σ(Deposit.shares) - Σ(Withdraw.shares)
 * 
 * Asset shares represent vault deposits that earn yield.
 * To get actual token amount, multiply by exchange rate.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Asset shares (scaled balance)
 * 
 * @example
 * ```typescript
 * const shares = await getIsolatedPairAssetShares(context, "0x123...", "0xPair...", 1234567890);
 * // Returns: 1000000000000000000n (1000 shares with 18 decimals)
 * ```
 */
export async function getIsolatedPairAssetShares(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    // Get all deposit/withdraw events up to timestamp
    const [deposits, withdraws] = await Promise.all([
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.owner, user as `0x${string}`),
                eq(DepositIsolated.pair, pair as `0x${string}`),
                lte(DepositIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.owner, user as `0x${string}`),
                eq(WithdrawIsolated.pair, pair as `0x${string}`),
                lte(WithdrawIsolated.timestamp, timestamp)
            )
        )
    ]);
    
    // Calculate net shares
    let assetShares = 0n;
    
    for (const event of deposits) {
        assetShares += event.shares;
    }
    
    for (const event of withdraws) {
        assetShares -= event.shares;
    }
    
    return assetShares > 0n ? assetShares : 0n;
}

/**
 * Get borrow shares for a user in an isolated pair at a specific timestamp
 * 
 * Borrow Shares = Σ(BorrowAsset.sharesAdded) - Σ(RepayAsset.shares)
 * 
 * Borrow shares represent debt that accrues interest costs.
 * To get actual debt amount, multiply by exchange rate.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Borrow shares (scaled debt)
 * 
 * @example
 * ```typescript
 * const borrowShares = await getIsolatedPairBorrowShares(context, "0x123...", "0xPair...", 1234567890);
 * // Returns: 500000000000000000n (500 borrow shares with 18 decimals)
 * ```
 */
export async function getIsolatedPairBorrowShares(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    // Get all borrow/repay events up to timestamp
    const [borrows, repays] = await Promise.all([
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                lte(BorrowAssetIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                lte(RepayAssetIsolated.timestamp, timestamp)
            )
        )
    ]);
    
    // Calculate net borrow shares
    let borrowShares = 0n;
    
    for (const event of borrows) {
        borrowShares += event.sharesAdded;
    }
    
    for (const event of repays) {
        borrowShares -= event.shares;
    }
    
    return borrowShares > 0n ? borrowShares : 0n;
}

/**
 * Convert shares to assets using exchange rate
 * 
 * Formula: assets = shares × exchangeRate / EXCHANGE_PRECISION
 * 
 * This is the core conversion function for isolated pairs (ERC4626 standard).
 * As the exchange rate grows over time (due to interest), the same number of shares
 * converts to more assets - that's how yield is earned!
 * 
 * @param shares - Share amount (scaled balance)
 * @param exchangeRate - Current exchange rate (1e18 precision)
 * @returns Asset amount (actual token balance)
 * 
 * @example
 * ```typescript
 * // User has 1000 shares, exchange rate is 1.05
 * const assets = convertSharesToAssets(1000n * 1e18n, 1.05n * 1e18n);
 * // Returns: 1050n * 1e18n (1050 tokens)
 * ```
 * 
 * @note
 * For isolated pairs, the exchange rate grows over time as interest accrues,
 * similar to how liquidity index works in the regular AAVE pool.
 */
export function convertSharesToAssets(
    shares: bigint,
    exchangeRate: bigint
): bigint {
    if (shares === 0n || exchangeRate === 0n) {
        return 0n;
    }
    
    // assets = shares × exchangeRate / EXCHANGE_PRECISION
    // Add rounding: (shares × exchangeRate + EXCHANGE_PRECISION/2) / EXCHANGE_PRECISION
    return (shares * exchangeRate + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
}

/**
 * Enhanced version of getIsolatedPairCollateralBalance that also returns contributing events
 *
 * @param context - Ponder context
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Balance and contributing events
 */
export async function getIsolatedPairCollateralBalanceWithEvents(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<BalanceWithEvents> {
    const dbQuery = context.db.sql || context.db;

    // Get all collateral events up to timestamp
    const [addEvents, removeEvents] = await Promise.all([
        dbQuery.select().from(AddCollateralIsolated).where(
            and(
                eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                eq(AddCollateralIsolated.pair, pair as `0x${string}`),
                lte(AddCollateralIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(RemoveCollateralIsolated).where(
            and(
                eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                eq(RemoveCollateralIsolated.pair, pair as `0x${string}`),
                lte(RemoveCollateralIsolated.timestamp, timestamp)
            )
        )
    ]);

    // Calculate balance
    let balance = 0n;
    const events: BalanceWithEvents['events'] = [];

    // Add collateral events
    for (const event of addEvents) {
        balance += event.collateralAmount;
        events.push({
            eventType: 'collateral_add',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: event.collateralAmount.toString(),
            txHash: event.txHash
        });
    }

    // Remove collateral events
    for (const event of removeEvents) {
        balance -= event.collateralAmount;
        events.push({
            eventType: 'collateral_remove',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: event.collateralAmount.toString(),
            txHash: event.txHash
        });
    }

    // Sort events by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return { balance, events };
}

/**
 * Enhanced version of getIsolatedPairAssetShares that also returns contributing events
 *
 * @param context - Ponder context
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Asset shares balance and contributing events
 */
export async function getIsolatedPairAssetSharesWithEvents(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<BalanceWithEvents> {
    const dbQuery = context.db.sql || context.db;

    // Get all asset events up to timestamp
    const [depositEvents, withdrawEvents] = await Promise.all([
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.owner, user as `0x${string}`),
                eq(DepositIsolated.pair, pair as `0x${string}`),
                lte(DepositIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.owner, user as `0x${string}`),
                eq(WithdrawIsolated.pair, pair as `0x${string}`),
                lte(WithdrawIsolated.timestamp, timestamp)
            )
        )
    ]);

    // Calculate balance
    let balance = 0n;
    const events: BalanceWithEvents['events'] = [];

    // Deposit events
    for (const event of depositEvents) {
        balance += event.shares;
        events.push({
            eventType: 'deposit',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: event.assets.toString(),
            txHash: event.txHash
        });
    }

    // Withdraw events
    for (const event of withdrawEvents) {
        balance -= event.shares;
        events.push({
            eventType: 'withdraw',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: event.assets.toString(),
            txHash: event.txHash
        });
    }

    // Sort events by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return { balance, events };
}

/**
 * Enhanced version of getIsolatedPairBorrowShares that also returns contributing events
 *
 * @param context - Ponder context
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Borrow shares balance and contributing events
 */
export async function getIsolatedPairBorrowSharesWithEvents(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<BalanceWithEvents> {
    const dbQuery = context.db.sql || context.db;

    // Get all borrow events up to timestamp
    const [borrowEvents, repayEvents] = await Promise.all([
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                lte(BorrowAssetIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                lte(RepayAssetIsolated.timestamp, timestamp)
            )
        )
    ]);

    // Calculate balance
    let balance = 0n;
    const events: BalanceWithEvents['events'] = [];

    // Borrow events
    for (const event of borrowEvents) {
        balance += event.sharesAdded;
        events.push({
            eventType: 'borrow',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: event.borrowAmount.toString(),
            txHash: event.txHash
        });
    }

    // Repay events
    for (const event of repayEvents) {
        balance -= event.shares;
        events.push({
            eventType: 'repay',
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: event.amountToRepay.toString(),
            txHash: event.txHash
        });
    }

    // Sort events by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return { balance, events };
}

