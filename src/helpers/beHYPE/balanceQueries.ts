/**
 * beHYPE Pool Position Query Functions
 *
 * Functions for querying user beHYPE pool positions (supplies/withdrawals to HyperLend)
 * at specific timestamps and retrieving balance events for a time period.
 *
 * NOTE: This tracks beHYPE supplied to the HyperLend pool, NOT wallet balances.
 * Yield is calculated based on pool positions and exchange rate changes.
 *
 * Uses the existing UserBalanceEvent and UserPosition tables filtered by beHYPE asset address.
 */

import { UserBalanceEvent, UserPosition } from "ponder:schema";
import { eq, and, lte, gte, desc, asc } from "ponder";
import { getBeHYPEExchangeRateAtTimestamp } from "./exchangeRate";

// beHYPE token address
const BEHYPE_TOKEN_ADDRESS = "0xd8FC8F0b03eBA61F64D08B0bef69d80916E5DdA9".toLowerCase() as `0x${string}`;

/**
 * Get user's beHYPE pool balance (scaled balance) at a specific timestamp
 *
 * Finds the most recent UserBalanceEvent for beHYPE at or before the target timestamp
 * and returns the scaled balance from that event.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param timestamp - Target timestamp
 * @returns User's beHYPE scaled balance at the timestamp (0 if no events found)
 */
export async function getBeHYPEPoolBalanceAtTimestamp(
    context: any,
    user: string,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const events = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user.toLowerCase() as `0x${string}`),
                    eq(UserBalanceEvent.asset, BEHYPE_TOKEN_ADDRESS),
                    lte(UserBalanceEvent.timestamp, timestamp)
                )
            )
            .orderBy(desc(UserBalanceEvent.timestamp))
            .limit(1);

        if (events.length === 0) {
            return 0n;
        }

        return BigInt(events[0].scaledBalance);
    } catch (error) {
        console.error(`[beHYPE] Error getting pool balance at timestamp for user ${user}:`, error);
        return 0n;
    }
}

/**
 * Get all beHYPE pool balance events for a user within a time period
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of period (inclusive)
 * @param endTimestamp - End of period (inclusive)
 * @returns Array of pool balance events sorted by timestamp ascending
 */
export async function getBeHYPEPoolBalanceEvents(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    id: string;
    txHash: string;
    user: string;
    scaledBalance: bigint;
    balanceChange: bigint;
    eventType: string;
    timestamp: number;
    blockNumber: bigint;
    exchangeRate: bigint;
}>> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const events = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user.toLowerCase() as `0x${string}`),
                    eq(UserBalanceEvent.asset, BEHYPE_TOKEN_ADDRESS),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(UserBalanceEvent.timestamp));

        // Map events and fetch exchange rate for each
        const mappedEvents = await Promise.all(events.map(async (e: any) => {
            const exchangeRate = await getBeHYPEExchangeRateAtTimestamp(context, e.timestamp);
            return {
                id: e.id,
                txHash: e.txHash,
                user: e.user,
                scaledBalance: BigInt(e.scaledBalance),
                balanceChange: BigInt(e.transactionAmount),
                eventType: e.eventType,
                timestamp: e.timestamp,
                blockNumber: BigInt(e.blockNumber),
                exchangeRate: exchangeRate,
            };
        }));

        return mappedEvents;
    } catch (error) {
        console.error(`[beHYPE] Error getting pool balance events for user ${user}:`, error);
        return [];
    }
}

/**
 * Get current beHYPE pool position for a user
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @returns User's current beHYPE pool position or null if not found
 */
export async function getBeHYPEPoolPosition(
    context: any,
    user: string
): Promise<{
    scaledBalance: bigint;
    lastUpdated: number;
} | null> {
    const { db } = context;

    try {
        const positionId = `${user.toLowerCase()}-${BEHYPE_TOKEN_ADDRESS}`;
        const position = await db.find(UserPosition, { id: positionId });

        if (!position) {
            return null;
        }

        return {
            scaledBalance: BigInt(position.scaledATokenBalance),
            lastUpdated: position.lastUpdated,
        };
    } catch (error) {
        console.error(`[beHYPE] Error getting pool position for user ${user}:`, error);
        return null;
    }
}

