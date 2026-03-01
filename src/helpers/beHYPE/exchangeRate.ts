/**
 * beHYPE Exchange Rate Query Functions
 * 
 * Functions for querying beHYPE exchange rate at specific timestamps.
 * 
 * IMPORTANT: beHYPE exchange rate is EVENT-BASED, not time-based.
 * The rate only changes when ExchangeRatioUpdated events occur (~2x/day via keeper).
 * Between events, the rate is CONSTANT.
 * 
 * This means we can simply find the most recent snapshot at or before a timestamp
 * to get the accurate exchange rate - no interpolation or calculation needed.
 */

import { BeHYPEExchangeRateSnapshot } from "ponder:schema";
import { lte, gte, and, desc, asc } from "ponder";

// Default exchange rate: 1 beHYPE = 1 HYPE (18 decimals)
const DEFAULT_EXCHANGE_RATE = BigInt(1e18);

/**
 * Get beHYPE exchange rate at a specific timestamp
 * 
 * Since exchange rate only changes on ExchangeRatioUpdated events, we simply find
 * the most recent snapshot at or before the target timestamp.
 * 
 * @param context - Ponder context with database access
 * @param timestamp - Target timestamp
 * @returns Exchange rate (HYPE per beHYPE) with 18 decimals precision
 */
export async function getBeHYPEExchangeRateAtTimestamp(
    context: any,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const snapshots = await dbQuery
            .select()
            .from(BeHYPEExchangeRateSnapshot)
            .where(lte(BeHYPEExchangeRateSnapshot.timestamp, timestamp))
            .orderBy(desc(BeHYPEExchangeRateSnapshot.timestamp), desc(BeHYPEExchangeRateSnapshot.logIndex))
            .limit(1);

        if (snapshots.length === 0) {
            // No snapshots before this timestamp - return default 1:1 rate
            return DEFAULT_EXCHANGE_RATE;
        }

        // Return the newExchangeRate from the snapshot (rate AFTER the update)
        return BigInt(snapshots[0].newExchangeRate);
    } catch (error) {
        console.error(`[beHYPE] Error getting exchange rate at timestamp ${timestamp}:`, error);
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
export async function getBeHYPEExchangeRateSnapshots(
    context: any,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    id: string;
    oldExchangeRate: bigint;
    newExchangeRate: bigint;
    yearlyRateInBps: number;
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
            .from(BeHYPEExchangeRateSnapshot)
            .where(
                and(
                    gte(BeHYPEExchangeRateSnapshot.timestamp, startTimestamp),
                    lte(BeHYPEExchangeRateSnapshot.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(BeHYPEExchangeRateSnapshot.timestamp), asc(BeHYPEExchangeRateSnapshot.logIndex));

        return snapshots.map((s: any) => ({
            id: s.id,
            oldExchangeRate: BigInt(s.oldExchangeRate),
            newExchangeRate: BigInt(s.newExchangeRate),
            yearlyRateInBps: s.yearlyRateInBps,
            timestamp: s.timestamp,
            blockNumber: BigInt(s.blockNumber),
            logIndex: s.logIndex,
            txHash: s.txHash,
        }));
    } catch (error) {
        console.error(`[beHYPE] Error getting exchange rate snapshots:`, error);
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
export async function getFirstBeHYPEExchangeRateAfterTimestamp(
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
            .from(BeHYPEExchangeRateSnapshot)
            .where(gte(BeHYPEExchangeRateSnapshot.timestamp, timestamp))
            .orderBy(asc(BeHYPEExchangeRateSnapshot.timestamp), asc(BeHYPEExchangeRateSnapshot.logIndex))
            .limit(1);

        if (snapshots.length === 0) {
            return null;
        }

        return {
            exchangeRate: BigInt(snapshots[0].newExchangeRate),
            timestamp: snapshots[0].timestamp,
        };
    } catch (error) {
        console.error(`[beHYPE] Error getting first exchange rate after timestamp:`, error);
        return null;
    }
}

