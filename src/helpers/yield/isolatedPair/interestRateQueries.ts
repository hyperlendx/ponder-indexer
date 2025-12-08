/**
 * Interest Rate Queries for Isolated Pairs
 *
 * This module provides functions to query interest rates (ratePerSec) for isolated pairs.
 * The interest rate is used to extrapolate exchange rates between on-chain events.
 *
 * The ratePerSec is emitted in UpdateRate events and represents the per-second interest rate
 * that borrowers pay. This rate is used to calculate how much the exchange rate grows over time.
 */

import { UpdateRateIsolated, AddInterestIsolated } from "ponder:schema";
import { eq, lte, desc, and } from "ponder";

/**
 * Get the interest rate (ratePerSec) at a specific timestamp
 *
 * This function queries the most recent UpdateRate event at or before the target timestamp
 * to get the ratePerSec that was active at that time.
 *
 * If no UpdateRate event is found, it falls back to checking AddInterest events
 * which also contain the rate.
 *
 * @param db - Database connection
 * @param pair - Isolated pair address
 * @param targetTimestamp - Target timestamp to get the rate for
 * @returns The ratePerSec at the target timestamp (1e18 precision), or 0n if not found
 *
 * @example
 * ```typescript
 * const ratePerSec = await getInterestRateAtTimestamp(db, "0xPair...", 1234567890);
 * // Returns: 158548959919n (approximately 0.5% APY)
 * ```
 */
export async function getInterestRateAtTimestamp(
    db: any,
    pair: string,
    targetTimestamp: number
): Promise<bigint> {
    // Handle both indexing context (db.sql) and API context (db)
    const dbQuery = db.sql || db;

    try {
        // First, try to get the rate from UpdateRate events
        const updateRateEvents = await dbQuery
            .select()
            .from(UpdateRateIsolated)
            .where(
                and(
                    eq(UpdateRateIsolated.pair, pair as `0x${string}`),
                    lte(UpdateRateIsolated.timestamp, targetTimestamp)
                )
            )
            .orderBy(desc(UpdateRateIsolated.timestamp))
            .limit(1);

        if (updateRateEvents && updateRateEvents.length > 0) {
            return BigInt(updateRateEvents[0].newRatePerSec);
        }

        // Fallback: try to get the rate from AddInterest events
        // AddInterest events contain the 'rate' field which is the ratePerSec
        const addInterestEvents = await dbQuery
            .select()
            .from(AddInterestIsolated)
            .where(
                and(
                    eq(AddInterestIsolated.pair, pair as `0x${string}`),
                    lte(AddInterestIsolated.timestamp, targetTimestamp)
                )
            )
            .orderBy(desc(AddInterestIsolated.timestamp))
            .limit(1);

        if (addInterestEvents && addInterestEvents.length > 0) {
            return BigInt(addInterestEvents[0].rate);
        }

        // No rate found - return 0 (no interest accrual)
        return 0n;

    } catch (error) {
        console.error(`Error getting interest rate for pair ${pair} at timestamp ${targetTimestamp}:`, error);
        return 0n;
    }
}

/**
 * Get all interest rate changes for a pair within a time range
 *
 * This is useful for calculating accurate interest accrual over a period
 * where the rate may have changed multiple times.
 *
 * @param db - Database connection
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of the time range
 * @param endTimestamp - End of the time range
 * @returns Array of rate changes with timestamps
 */
export async function getInterestRateChanges(
    db: any,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{ timestamp: number; ratePerSec: bigint }>> {
    const dbQuery = db.sql || db;

    try {
        const events = await dbQuery
            .select()
            .from(UpdateRateIsolated)
            .where(
                and(
                    eq(UpdateRateIsolated.pair, pair as `0x${string}`),
                    lte(UpdateRateIsolated.timestamp, endTimestamp)
                )
            )
            .orderBy(desc(UpdateRateIsolated.timestamp));

        // Filter to only include events that affect the time range
        // (events at or before endTimestamp that set the rate for part of the range)
        return events
            .filter((e: any) => e.timestamp <= endTimestamp)
            .map((e: any) => ({
                timestamp: e.timestamp,
                ratePerSec: BigInt(e.newRatePerSec),
            }));

    } catch (error) {
        console.error(`Error getting interest rate changes for pair ${pair}:`, error);
        return [];
    }
}

