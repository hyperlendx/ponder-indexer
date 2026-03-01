/**
 * wstHYPE Exchange Rate Functions
 * 
 * Functions for querying wstHYPE exchange rates (assetsPerShare).
 * 
 * Key difference from AAVE/Isolated pairs:
 * - Exchange rate is EVENT-BASED, not time-based
 * - Rate only changes on Rebase events
 * - Between events, the rate is CONSTANT
 */

import { WstHYPEExchangeRateSnapshot } from "ponder:schema";
import { lte, gte, desc, asc } from "ponder";

// Default exchange rate (1:1) with 18 decimals
const DEFAULT_EXCHANGE_RATE = BigInt(1e18);

/**
 * Get wstHYPE exchange rate (assetsPerShare) at a specific timestamp
 * 
 * Finds the most recent WstHYPEExchangeRateSnapshot at or before the target timestamp.
 * Since the rate only changes on Rebase events, the rate is constant between events.
 */
export async function getWstHYPEExchangeRateAtTimestamp(
    context: any,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const snapshots = await dbQuery
            .select()
            .from(WstHYPEExchangeRateSnapshot)
            .where(lte(WstHYPEExchangeRateSnapshot.timestamp, timestamp))
            .orderBy(desc(WstHYPEExchangeRateSnapshot.timestamp), desc(WstHYPEExchangeRateSnapshot.logIndex))
            .limit(1);

        if (snapshots.length === 0) {
            // No rebase events before this timestamp, return default 1:1 rate
            return DEFAULT_EXCHANGE_RATE;
        }

        return BigInt(snapshots[0].assetsPerShare);
    } catch (error) {
        console.error(`[wstHYPE] Error getting exchange rate at timestamp ${timestamp}:`, error);
        return DEFAULT_EXCHANGE_RATE;
    }
}

/**
 * Get all wstHYPE exchange rate snapshots within a time period
 */
export async function getWstHYPEExchangeRateSnapshots(
    context: any,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    id: string;
    currentSupply: bigint;
    newSupply: bigint;
    rebaseInterval: bigint;
    assetsPerShare: bigint;
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
            .from(WstHYPEExchangeRateSnapshot)
            .where(
                gte(WstHYPEExchangeRateSnapshot.timestamp, startTimestamp),
                lte(WstHYPEExchangeRateSnapshot.timestamp, endTimestamp)
            )
            .orderBy(asc(WstHYPEExchangeRateSnapshot.timestamp), asc(WstHYPEExchangeRateSnapshot.logIndex));

        return snapshots.map((s: any) => ({
            id: s.id,
            currentSupply: BigInt(s.currentSupply),
            newSupply: BigInt(s.newSupply),
            rebaseInterval: BigInt(s.rebaseInterval),
            assetsPerShare: BigInt(s.assetsPerShare),
            timestamp: s.timestamp,
            blockNumber: BigInt(s.blockNumber),
            logIndex: s.logIndex,
            txHash: s.txHash,
        }));
    } catch (error) {
        console.error(`[wstHYPE] Error getting exchange rate snapshots:`, error);
        return [];
    }
}

/**
 * Get the first wstHYPE exchange rate snapshot after a timestamp
 * Useful for finding the next rate change after a given point
 */
export async function getFirstWstHYPEExchangeRateAfterTimestamp(
    context: any,
    timestamp: number
): Promise<{
    assetsPerShare: bigint;
    timestamp: number;
} | null> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const snapshots = await dbQuery
            .select()
            .from(WstHYPEExchangeRateSnapshot)
            .where(gte(WstHYPEExchangeRateSnapshot.timestamp, timestamp))
            .orderBy(asc(WstHYPEExchangeRateSnapshot.timestamp), asc(WstHYPEExchangeRateSnapshot.logIndex))
            .limit(1);

        if (snapshots.length === 0) {
            return null;
        }

        return {
            assetsPerShare: BigInt(snapshots[0].assetsPerShare),
            timestamp: snapshots[0].timestamp,
        };
    } catch (error) {
        console.error(`[wstHYPE] Error getting first exchange rate after timestamp:`, error);
        return null;
    }
}

