/**
 * Isolated Pair Event Query Functions
 * 
 * Functions for querying and normalizing events from the database.
 * These are internal helper functions used by yield calculations.
 */

import {
    BorrowAssetIsolated,
    RepayAssetIsolated,
    DepositIsolated,
    WithdrawIsolated
} from "ponder:schema";
import { eq, and, lte, gte } from "ponder";

/**
 * Unified event format for yield calculations
 * 
 * All events (deposit, withdraw, borrow, repay) are normalized to this format
 * to simplify the segment-based yield calculation logic.
 */
export interface UnifiedPairEvent {
    timestamp: number;
    type: 'deposit' | 'withdraw' | 'borrow' | 'repay';
    assetSharesDelta: bigint;  // Change in asset shares (positive = deposit, negative = withdraw)
    borrowSharesDelta: bigint; // Change in borrow shares (positive = borrow, negative = repay)
    exchangeRate: bigint;      // Exchange rate at time of event
}

/**
 * Get all events for a user in a specific pair during a time period
 * 
 * Returns events sorted by timestamp in ascending order.
 * All events are normalized to a unified format for easier processing.
 * 
 * This is an internal helper function used by yield calculation logic.
 * It queries all four event types (deposit, withdraw, borrow, repay) and
 * combines them into a single chronological stream.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period (inclusive)
 * @param endTimestamp - End of time period (inclusive)
 * @returns Array of unified events sorted by timestamp
 * 
 * @example
 * ```typescript
 * const events = await getUserPairEvents(context, "0x123...", "0xPair...", 1000, 2000);
 * // Returns: [
 * //   { timestamp: 1100, type: 'deposit', assetSharesDelta: 100n, borrowSharesDelta: 0n, exchangeRate: 1.05e18 },
 * //   { timestamp: 1500, type: 'borrow', assetSharesDelta: 0n, borrowSharesDelta: 50n, exchangeRate: 1.06e18 },
 * //   ...
 * // ]
 * ```
 * 
 * @internal This function is not exported from the main index
 */
export async function getUserPairEvents(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<UnifiedPairEvent[]> {
    const dbQuery = context.db.sql || context.db;

    // Query all events for this user and pair during the period
    const [deposits, withdraws, borrows, repays] = await Promise.all([
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.owner, user as `0x${string}`),
                eq(DepositIsolated.pair, pair as `0x${string}`),
                gte(DepositIsolated.timestamp, startTimestamp),
                lte(DepositIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.owner, user as `0x${string}`),
                eq(WithdrawIsolated.pair, pair as `0x${string}`),
                gte(WithdrawIsolated.timestamp, startTimestamp),
                lte(WithdrawIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                gte(BorrowAssetIsolated.timestamp, startTimestamp),
                lte(BorrowAssetIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                gte(RepayAssetIsolated.timestamp, startTimestamp),
                lte(RepayAssetIsolated.timestamp, endTimestamp)
            )
        )
    ]);

    // Convert to unified event format
    const events: UnifiedPairEvent[] = [];

    // Process deposits: add asset shares
    for (const deposit of deposits) {
        events.push({
            timestamp: Number(deposit.timestamp),
            type: 'deposit',
            assetSharesDelta: deposit.shares, // Positive - adding shares
            borrowSharesDelta: 0n,
            exchangeRate: deposit.exchangeRate
        });
    }

    // Process withdraws: remove asset shares
    for (const withdraw of withdraws) {
        events.push({
            timestamp: Number(withdraw.timestamp),
            type: 'withdraw',
            assetSharesDelta: 0n - withdraw.shares, // Negative - removing shares
            borrowSharesDelta: 0n,
            exchangeRate: withdraw.exchangeRate
        });
    }

    // Process borrows: add borrow shares (debt)
    for (const borrow of borrows) {
        events.push({
            timestamp: Number(borrow.timestamp),
            type: 'borrow',
            assetSharesDelta: 0n,
            borrowSharesDelta: borrow.sharesAdded, // Positive - adding debt
            exchangeRate: borrow.exchangeRate
        });
    }

    // Process repays: remove borrow shares (reduce debt)
    for (const repay of repays) {
        events.push({
            timestamp: Number(repay.timestamp),
            type: 'repay',
            assetSharesDelta: 0n,
            borrowSharesDelta: 0n - repay.shares, // Negative - reducing debt
            exchangeRate: repay.exchangeRate
        });
    }

    // Sort by timestamp (ascending order for chronological processing)
    events.sort((a, b) => a.timestamp - b.timestamp);

    return events;
}

