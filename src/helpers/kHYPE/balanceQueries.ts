/**
 * kHYPE Balance Query Functions
 * 
 * Functions for querying user kHYPE balances at specific timestamps
 * and retrieving balance events for a time period.
 */

import { KHYPEBalanceEvent, UserKHYPEPosition } from "ponder:schema";
import { eq, and, lte, gte, desc, asc } from "ponder";

/**
 * Get user's kHYPE balance at a specific timestamp
 * 
 * Finds the most recent KHYPEBalanceEvent at or before the target timestamp
 * and returns the balance from that event.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param timestamp - Target timestamp
 * @returns User's kHYPE balance at the timestamp (0 if no events found)
 */
export async function getKHYPEBalanceAtTimestamp(
    context: any,
    user: string,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const events = await dbQuery
            .select()
            .from(KHYPEBalanceEvent)
            .where(
                and(
                    eq(KHYPEBalanceEvent.user, user.toLowerCase() as `0x${string}`),
                    lte(KHYPEBalanceEvent.timestamp, timestamp)
                )
            )
            .orderBy(desc(KHYPEBalanceEvent.timestamp), desc(KHYPEBalanceEvent.logIndex))
            .limit(1);

        if (events.length === 0) {
            return 0n;
        }

        return BigInt(events[0].balance);
    } catch (error) {
        console.error(`[kHYPE] Error getting balance at timestamp for user ${user}:`, error);
        return 0n;
    }
}

/**
 * Get all kHYPE balance events for a user within a time period
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of period (inclusive)
 * @param endTimestamp - End of period (inclusive)
 * @returns Array of balance events sorted by timestamp ascending
 */
export async function getKHYPEBalanceEvents(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    id: string;
    txHash: string;
    user: string;
    balance: bigint;
    balanceChange: bigint;
    eventType: string;
    counterparty: string;
    timestamp: number;
    blockNumber: bigint;
    logIndex: number;
}>> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const events = await dbQuery
            .select()
            .from(KHYPEBalanceEvent)
            .where(
                and(
                    eq(KHYPEBalanceEvent.user, user.toLowerCase() as `0x${string}`),
                    gte(KHYPEBalanceEvent.timestamp, startTimestamp),
                    lte(KHYPEBalanceEvent.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(KHYPEBalanceEvent.timestamp), asc(KHYPEBalanceEvent.logIndex));

        return events.map((e: any) => ({
            id: e.id,
            txHash: e.txHash,
            user: e.user,
            balance: BigInt(e.balance),
            balanceChange: BigInt(e.balanceChange),
            eventType: e.eventType,
            counterparty: e.counterparty,
            timestamp: e.timestamp,
            blockNumber: BigInt(e.blockNumber),
            logIndex: e.logIndex,
        }));
    } catch (error) {
        console.error(`[kHYPE] Error getting balance events for user ${user}:`, error);
        return [];
    }
}

/**
 * Get current kHYPE position for a user
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @returns User's current kHYPE position or null if not found
 */
export async function getKHYPEPosition(
    context: any,
    user: string
): Promise<{
    balance: bigint;
    totalMinted: bigint;
    totalBurned: bigint;
    totalTransferredIn: bigint;
    totalTransferredOut: bigint;
    lastUpdated: number;
} | null> {
    const { db } = context;

    try {
        const position = await db.find(UserKHYPEPosition, { id: user.toLowerCase() as `0x${string}` });
        
        if (!position) {
            return null;
        }

        return {
            balance: BigInt(position.balance),
            totalMinted: BigInt(position.totalMinted),
            totalBurned: BigInt(position.totalBurned),
            totalTransferredIn: BigInt(position.totalTransferredIn),
            totalTransferredOut: BigInt(position.totalTransferredOut),
            lastUpdated: position.lastUpdated,
        };
    } catch (error) {
        console.error(`[kHYPE] Error getting position for user ${user}:`, error);
        return null;
    }
}

