/**
 * kHYPE Exchange Rate Query Functions
 * 
 * Functions for querying kHYPE exchange rate at specific timestamps.
 * 
 * IMPORTANT: kHYPE exchange rate is EVENT-BASED, not time-based.
 * The rate only changes when RewardEventReported or SlashingEventReported events occur.
 * Between events, the rate is CONSTANT.
 * 
 * This means we can simply find the most recent snapshot at or before a timestamp
 * to get the accurate exchange rate - no interpolation or calculation needed.
 */

import { KHYPEExchangeRateSnapshot } from "ponder:schema";
import { lte, gte, and, desc, asc } from "ponder";

// Default exchange rate: 1 kHYPE = 1 HYPE (18 decimals)
const DEFAULT_EXCHANGE_RATE = BigInt(1e18);

/**
 * Get kHYPE exchange rate at a specific timestamp
 * 
 * Since exchange rate only changes on events, we simply find the most recent
 * snapshot at or before the target timestamp.
 * 
 * @param context - Ponder context with database access
 * @param timestamp - Target timestamp
 * @returns Exchange rate (HYPE per kHYPE) with 18 decimals precision
 */
export async function getExchangeRateAtTimestamp(
    context: any,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const snapshots = await dbQuery
            .select()
            .from(KHYPEExchangeRateSnapshot)
            .where(lte(KHYPEExchangeRateSnapshot.timestamp, timestamp))
            .orderBy(desc(KHYPEExchangeRateSnapshot.timestamp), desc(KHYPEExchangeRateSnapshot.logIndex))
            .limit(1);

        if (snapshots.length === 0) {
            // No snapshots before this timestamp - return default 1:1 rate
            return DEFAULT_EXCHANGE_RATE;
        }

        return BigInt(snapshots[0].exchangeRate);
    } catch (error) {
        console.error(`[kHYPE] Error getting exchange rate at timestamp ${timestamp}:`, error);
        return DEFAULT_EXCHANGE_RATE;
    }
}

/**
 * Get all exchange rate snapshots within a time period
 * 
 * @param context - Ponder context with database access
 * @param startTimestamp - Start of period (inclusive)
 * @param endTimestamp - End of period (inclusive)
 * @returns Array of exchange rate snapshots sorted by timestamp ascending
 */
export async function getExchangeRateSnapshots(
    context: any,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    id: string;
    exchangeRate: bigint;
    eventType: string;
    eventAmount: bigint;
    timestamp: number;
    blockNumber: bigint;
    logIndex: number;
    txHash: string;
}>> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const snapshots = await dbQuery
            .select()
            .from(KHYPEExchangeRateSnapshot)
            .where(
                and(
                    gte(KHYPEExchangeRateSnapshot.timestamp, startTimestamp),
                    lte(KHYPEExchangeRateSnapshot.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(KHYPEExchangeRateSnapshot.timestamp), asc(KHYPEExchangeRateSnapshot.logIndex));

        return snapshots.map((s: any) => ({
            id: s.id,
            exchangeRate: BigInt(s.exchangeRate),
            eventType: s.eventType,
            eventAmount: BigInt(s.eventAmount),
            timestamp: s.timestamp,
            blockNumber: BigInt(s.blockNumber),
            logIndex: s.logIndex,
            txHash: s.txHash,
        }));
    } catch (error) {
        console.error(`[kHYPE] Error getting exchange rate snapshots:`, error);
        return [];
    }
}

/**
 * Get the first exchange rate snapshot at or after a timestamp
 * Useful for finding the rate at the start of a period
 * 
 * @param context - Ponder context with database access
 * @param timestamp - Target timestamp
 * @returns Exchange rate snapshot or null if none found
 */
export async function getFirstExchangeRateAfterTimestamp(
    context: any,
    timestamp: number
): Promise<{
    exchangeRate: bigint;
    timestamp: number;
} | null> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const snapshots = await dbQuery
            .select()
            .from(KHYPEExchangeRateSnapshot)
            .where(gte(KHYPEExchangeRateSnapshot.timestamp, timestamp))
            .orderBy(asc(KHYPEExchangeRateSnapshot.timestamp), asc(KHYPEExchangeRateSnapshot.logIndex))
            .limit(1);

        if (snapshots.length === 0) {
            return null;
        }

        return {
            exchangeRate: BigInt(snapshots[0].exchangeRate),
            timestamp: snapshots[0].timestamp,
        };
    } catch (error) {
        console.error(`[kHYPE] Error getting first exchange rate after timestamp:`, error);
        return null;
    }
}

