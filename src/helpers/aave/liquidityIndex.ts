import { ReserveDataEvent } from "ponder:schema";
import { eq, desc, lte, and } from "ponder";
import { RAY, SECONDS_PER_YEAR, RayMath } from "./rayMath";

/**
 * Calculate linear interest factor using AAVE's methodology
 *
 * This function calculates the linear interest growth factor over a given time period.
 * The formula follows AAVE's implementation: 1 + (rate * timeElapsed) / SECONDS_PER_YEAR
 *
 * @param liquidityRate - The annual liquidity rate in ray precision (1e27)
 *                       Expected range: 0 to ~1e27 (0% to ~100% APY)
 * @param timeElapsed - Time elapsed in seconds since last update
 *                     Expected range: 0 to ~31536000 (0 seconds to 1 year)
 * @returns The linear interest factor in ray precision (1e27)
 *          Returns RAY (1e27) for 0% interest or 0 time elapsed
 *          Returns > RAY for positive interest rates
 */
export function calculateLinearInterest(
    liquidityRate: bigint,
    timeElapsed: bigint
): bigint {
    // If no time has elapsed, return RAY (no growth)
    if (timeElapsed === 0n) {
        return RAY;
    }

    // If rate is 0, return RAY (no growth)
    if (liquidityRate === 0n) {
        return RAY;
    }

    // Calculate: RAY + (liquidityRate * timeElapsed) / SECONDS_PER_YEAR
    // SECONDS_PER_YEAR is not in RAY units, so use plain integer division
    const interestAccrued = (liquidityRate * timeElapsed) / SECONDS_PER_YEAR;

    return RAY + interestAccrued;
}

/**
 * Calculate new liquidity index using AAVE's linear interest methodology
 *
 * This is the core function for calculating how liquidity indices grow over time
 * in AAVE protocol. It applies linear interest growth to the previous index.
 * Compounding happens across successive index updates, not within this single calculation.
 *
 * Formula: newIndex = previousIndex * linearInterestFactor
 * Where: linearInterestFactor = 1 + (rate * timeElapsed) / SECONDS_PER_YEAR
 *
 */
export function calculateLiquidityIndex(
    previousIndex: bigint,
    liquidityRate: bigint,
    timeElapsed: bigint
): bigint {
    // Validate inputs
    if (previousIndex < RAY) {
        console.warn(`Invalid previousIndex: ${previousIndex.toString()}, using RAY`);
        previousIndex = RAY;
    }

    // Calculate the linear interest factor
    const linearInterestFactor = calculateLinearInterest(liquidityRate, timeElapsed);

    // Apply linear interest growth: newIndex = previousIndex * linearInterestFactor
    return RayMath.rayMul(previousIndex, linearInterestFactor);
}

/**
 * Validate that a liquidity index is reasonable
 */
export function validateLiquidityIndex(index: bigint): boolean {
    // Index should be at least 1 RAY and not exceed reasonable bounds
    return index >= RAY && index <= RAY * 10n; // Max 10x growth
}

/**
 * A point in the reserve's interest history: the state emitted by a
 * ReserveDataUpdated event (or a snapshot of it). Indices grow linearly from
 * `timestamp` at the given rates until the next ReserveDataUpdated.
 */
export interface ReserveIndexPoint {
    timestamp: number;
    liquidityIndex: bigint;
    liquidityRate: bigint;
    variableBorrowIndex: bigint;
    variableBorrowRate: bigint;
}

/**
 * Liquidity index at `targetTimestamp`, given the last reserve update at or
 * before it. Pure function; this is the exact math AAVE uses on-chain
 * (getReserveNormalizedIncome) and the semantics the DB-backed
 * calculateLiquidityIndexAtTimestamp has always had.
 */
export function liquidityIndexFromPoint(base: ReserveIndexPoint, targetTimestamp: number): bigint {
    const baseLiquidityIndex = base.liquidityIndex;
    if (!validateLiquidityIndex(baseLiquidityIndex)) {
        return RAY;
    }
    if (base.timestamp === targetTimestamp) {
        return baseLiquidityIndex;
    }
    const timeElapsed = BigInt(targetTimestamp - base.timestamp);
    const newLiquidityIndex = calculateLiquidityIndex(baseLiquidityIndex, base.liquidityRate, timeElapsed);
    if (!validateLiquidityIndex(newLiquidityIndex)) {
        console.warn(`Calculated liquidity index is invalid: ${newLiquidityIndex.toString()}, using base index`);
        return baseLiquidityIndex;
    }
    return newLiquidityIndex;
}

/**
 * Calculate liquidity index for any timestamp using AAVE's methodology
 *
 * This function reconstructs the liquidity index at any point in time by:
 * 1. Finding the most recent ReserveDataEvent at or before the target timestamp
 * 2. Applying AAVE's linear interest compounding from that point to the target time
 * 3. Handling edge cases like missing data or same-transaction updates
 *
 * The calculation follows AAVE's core formula:
 * newIndex = previousIndex * (1 + (rate * timeElapsed) / SECONDS_PER_YEAR)
 */
export async function calculateLiquidityIndexAtTimestamp(
    context: any,
    reserve: string,
    targetTimestamp: number,
    currentTxHash?: string
): Promise<bigint> {
    const { db } = context;

    try {
        // If we have a current transaction hash, first check if there's a ReserveDataEvent
        // in the same transaction (which would be the most up-to-date index)
        if (currentTxHash) {
            const dbQuery = db.sql || db;
            const sameTransactionEvents = await dbQuery
                .select({liquidityIndex: ReserveDataEvent.liquidityIndex})
                .from(ReserveDataEvent)
                .where(
                    and(
                        eq(ReserveDataEvent.reserve, reserve as `0x${string}`),
                        eq(ReserveDataEvent.txHash, currentTxHash as `0x${string}`)
                    )
                )
                .orderBy(desc(ReserveDataEvent.logIndex))
                .limit(1);

            if (sameTransactionEvents && sameTransactionEvents.length > 0) {
                return BigInt(sameTransactionEvents[0].liquidityIndex);
            }
        }

        // Query for the most recent ReserveDataEvent at or before the target timestamp
        // Use the reserveTimestampIdx index for efficient querying
        const dbQuery = db.sql || db;
        const events = await dbQuery
            .select({
                timestamp: ReserveDataEvent.timestamp,
                liquidityIndex: ReserveDataEvent.liquidityIndex,
                liquidityRate: ReserveDataEvent.liquidityRate,
                variableBorrowIndex: ReserveDataEvent.variableBorrowIndex,
                variableBorrowRate: ReserveDataEvent.variableBorrowRate,
            })
            .from(ReserveDataEvent)
            .where(
                and(
                    eq(ReserveDataEvent.reserve, reserve as `0x${string}`),
                    lte(ReserveDataEvent.timestamp, targetTimestamp)
                )
            )
            .orderBy(
                desc(ReserveDataEvent.timestamp),
                desc(ReserveDataEvent.blockNumber),
                desc(ReserveDataEvent.logIndex)
            )
            .limit(1); // Only need the most recent one

        if (!events || events.length === 0) {
            // No historical data found before the target timestamp
            // For current position queries, try to get the most recent event regardless of timestamp
            if (!currentTxHash) {
                const dbQuery = db.sql || db;
                const mostRecentEvents = await dbQuery
                    .select({liquidityIndex: ReserveDataEvent.liquidityIndex})
                    .from(ReserveDataEvent)
                    .where(eq(ReserveDataEvent.reserve, reserve as `0x${string}`))
                    .orderBy(
                        desc(ReserveDataEvent.timestamp),
                        desc(ReserveDataEvent.blockNumber),
                        desc(ReserveDataEvent.logIndex)
                    )
                    .limit(1);

                if (mostRecentEvents && mostRecentEvents.length > 0) {
                    return BigInt(mostRecentEvents[0].liquidityIndex);
                }
            }

            // No historical data found at all, return default liquidity index (1 RAY)
            return RAY;
        }

        const closestEvent = events[0];
        return liquidityIndexFromPoint({
            timestamp: Number(closestEvent.timestamp),
            liquidityIndex: BigInt(closestEvent.liquidityIndex),
            liquidityRate: BigInt(closestEvent.liquidityRate),
            variableBorrowIndex: BigInt(closestEvent.variableBorrowIndex),
            variableBorrowRate: BigInt(closestEvent.variableBorrowRate),
        }, targetTimestamp);

    } catch (error) {
        console.error(`Error calculating liquidity index for reserve ${reserve} at timestamp ${targetTimestamp}:`, error);
        // Return default index on error to prevent system failure
        return RAY;
    }
}
