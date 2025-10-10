import { ReserveDataEvent } from "ponder:schema";
import { eq, desc, lte, and } from "ponder";
import { RAY, SECONDS_PER_YEAR, RayMath } from "./rayMath";
import { calculateLinearInterest } from "./liquidityIndex";

/**
 * Calculate new variable borrow index using AAVE's linear interest methodology
 *
 * This is the borrow-side equivalent of calculateLiquidityIndex().
 * It applies linear interest growth to the previous borrow index.
 * 
 * The formula is identical to liquidity index calculation:
 * newIndex = previousIndex * (1 + (rate * timeElapsed) / SECONDS_PER_YEAR)
 *
 * @param previousIndex - Previous variable borrow index in ray precision (1e27)
 * @param variableBorrowRate - The annual variable borrow rate in ray precision (1e27)
 * @param timeElapsed - Time elapsed in seconds since last update
 * @returns New variable borrow index in ray precision (1e27)
 */
export function calculateVariableBorrowIndex(
    previousIndex: bigint,
    variableBorrowRate: bigint,
    timeElapsed: bigint
): bigint {
    // Validate inputs
    if (previousIndex < RAY) {
        console.warn(`Invalid previousIndex: ${previousIndex.toString()}, using RAY`);
        previousIndex = RAY;
    }

    // Calculate the linear interest factor using the same formula as supply side
    const linearInterestFactor = calculateLinearInterest(variableBorrowRate, timeElapsed);

    // Apply linear interest growth: newIndex = previousIndex * linearInterestFactor
    return RayMath.rayMul(previousIndex, linearInterestFactor);
}

/**
 * Validate that a variable borrow index is reasonable
 * Uses the same validation logic as liquidity index
 */
export function validateVariableBorrowIndex(index: bigint): boolean {
    // Index should be at least 1 RAY and not exceed reasonable bounds
    return index >= RAY && index <= RAY * 10n; // Max 10x growth
}

/**
 * Calculate variable borrow index for any timestamp using AAVE's methodology
 *
 * This is the borrow-side equivalent of calculateLiquidityIndexAtTimestamp().
 * It reconstructs the variable borrow index at any point in time by:
 * 1. Finding the most recent ReserveDataEvent at or before the target timestamp
 * 2. Applying AAVE's linear interest compounding from that point to the target time
 * 3. Handling edge cases like missing data or same-transaction updates
 *
 * The calculation follows AAVE's core formula:
 * newIndex = previousIndex * (1 + (rate * timeElapsed) / SECONDS_PER_YEAR)
 *
 * @param context - Ponder context with database access
 * @param reserve - Reserve asset address
 * @param targetTimestamp - Target timestamp to calculate index for
 * @param currentTxHash - Optional transaction hash for same-transaction lookups
 * @returns Variable borrow index at the target timestamp in ray precision (1e27)
 */
export async function calculateVariableBorrowIndexAtTimestamp(
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
                .select()
                .from(ReserveDataEvent)
                .where(
                    and(
                        eq(ReserveDataEvent.reserve, reserve as `0x${string}`),
                        eq(ReserveDataEvent.txHash, currentTxHash as `0x${string}`)
                    )
                );

            if (sameTransactionEvents && sameTransactionEvents.length > 0) {
                return BigInt(sameTransactionEvents[0].variableBorrowIndex);
            }
        }

        // Query for the most recent ReserveDataEvent at or before the target timestamp
        const dbQuery = db.sql || db;
        const events = await dbQuery
            .select()
            .from(ReserveDataEvent)
            .where(
                and(
                    eq(ReserveDataEvent.reserve, reserve as `0x${string}`),
                    lte(ReserveDataEvent.timestamp, targetTimestamp)
                )
            )
            .orderBy(desc(ReserveDataEvent.timestamp))
            .limit(1); // Only need the most recent one

        if (!events || events.length === 0) {
            // No historical data found before the target timestamp
            // For current position queries, try to get the most recent event regardless of timestamp
            if (!currentTxHash) {
                const dbQuery = db.sql || db;
                const mostRecentEvents = await dbQuery
                    .select()
                    .from(ReserveDataEvent)
                    .where(eq(ReserveDataEvent.reserve, reserve as `0x${string}`))
                    .orderBy(desc(ReserveDataEvent.timestamp))
                    .limit(1);

                if (mostRecentEvents && mostRecentEvents.length > 0) {
                    return BigInt(mostRecentEvents[0].variableBorrowIndex);
                }
            }

            // No historical data found at all, return default borrow index (1 RAY)
            return RAY;
        }

        const closestEvent = events[0];
        // Validate the base variable borrow index
        const baseVariableBorrowIndex = BigInt(closestEvent.variableBorrowIndex);
        if (!validateVariableBorrowIndex(baseVariableBorrowIndex)) {
            return RAY;
        }

        // If the event timestamp exactly matches the target, return the index directly
        if (closestEvent.timestamp === targetTimestamp) {
            return baseVariableBorrowIndex;
        }

        // Calculate the time elapsed since the closest event
        const timeElapsed = BigInt(targetTimestamp - closestEvent.timestamp);

        // Get the variable borrow rate from the event (in ray precision)
        const variableBorrowRate = BigInt(closestEvent.variableBorrowRate);

        // Use AAVE's borrow index calculation to get the new index
        const newVariableBorrowIndex = calculateVariableBorrowIndex(
            baseVariableBorrowIndex,
            variableBorrowRate,
            timeElapsed
        );

        // Validate the calculated index
        if (!validateVariableBorrowIndex(newVariableBorrowIndex)) {
            console.warn(`Calculated variable borrow index is invalid: ${newVariableBorrowIndex.toString()}, using base index`);
            return baseVariableBorrowIndex;
        }

        return newVariableBorrowIndex;

    } catch (error) {
        console.error(`Error calculating variable borrow index for reserve ${reserve} at timestamp ${targetTimestamp}:`, error);
        // Return default index on error to prevent system failure
        return RAY;
    }
}

