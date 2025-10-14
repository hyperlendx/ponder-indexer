/**
 * Isolated Pair Exchange Rate Calculations
 * 
 * Functions for calculating and extrapolating exchange rates at specific timestamps.
 * Exchange rates grow over time as interest accrues, similar to AAVE's liquidity index.
 */

import { EXCHANGE_PRECISION } from "./constants";

/**
 * Calculate exchange rate at a specific timestamp by extrapolating from the most recent event
 *
 * Similar to calculateLiquidityIndexAtTimestamp() for AAVE pool, this function:
 * 1. Finds the most recent event before the target timestamp
 * 2. Calculates the implied interest rate from recent exchange rate changes
 * 3. Extrapolates the exchange rate to the target timestamp
 *
 * This ensures accurate yield calculations even when there are no events during the query period.
 * 
 * The extrapolation uses linear interpolation based on the rate of change between the two
 * most recent events. This is a reasonable approximation for short time periods.
 * 
 * @param context - Ponder context with database access
 * @param pair - Isolated pair address
 * @param targetTimestamp - Target timestamp to calculate exchange rate for
 * @returns Exchange rate at target timestamp (1e18 precision)
 * 
 * @example
 * ```typescript
 * // Get exchange rate at specific timestamp
 * const rate = await calculateIsolatedPairExchangeRateAtTimestamp(context, "0xPair...", 1234567890);
 * // Returns: 1050000000000000000n (1.05 exchange rate)
 * ```
 * 
 * @note
 * Accuracy considerations:
 * - Most accurate when events are frequent (daily or more)
 * - Uses linear approximation (not compound interest)
 * - May be less accurate for long extrapolation periods (> 7 days)
 * - Assumes constant interest rate between events
 */
export async function calculateIsolatedPairExchangeRateAtTimestamp(
    context: any,
    pair: string,
    targetTimestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;

    try {
        // Get the two most recent events before the target timestamp to calculate interest rate
        const result = await dbQuery.sql.query(`
            SELECT exchange_rate, timestamp
            FROM (
                SELECT exchange_rate, timestamp FROM borrow_asset_isolated
                WHERE pair = ${pair} AND timestamp <= ${targetTimestamp} AND exchange_rate IS NOT NULL
                UNION ALL
                SELECT exchange_rate, timestamp FROM repay_asset_isolated
                WHERE pair = ${pair} AND timestamp <= ${targetTimestamp} AND exchange_rate IS NOT NULL
                UNION ALL
                SELECT exchange_rate, timestamp FROM deposit_isolated
                WHERE pair = ${pair} AND timestamp <= ${targetTimestamp} AND exchange_rate IS NOT NULL
                UNION ALL
                SELECT exchange_rate, timestamp FROM withdraw_isolated
                WHERE pair = ${pair} AND timestamp <= ${targetTimestamp} AND exchange_rate IS NOT NULL
            ) AS all_events
            ORDER BY timestamp DESC
            LIMIT 2
        `);

        if (!result.rows || result.rows.length === 0) {
            // No events found, return default 1:1 exchange rate
            return EXCHANGE_PRECISION;
        }

        const mostRecentEvent = result.rows[0];
        const mostRecentRate = BigInt(mostRecentEvent.exchange_rate);
        const mostRecentTimestamp = Number(mostRecentEvent.timestamp);

        // If the most recent event is exactly at the target timestamp, return it directly
        if (mostRecentTimestamp === targetTimestamp) {
            return mostRecentRate;
        }

        // Calculate time elapsed since the most recent event
        const timeElapsed = BigInt(targetTimestamp - mostRecentTimestamp);

        // If we have at least 2 events, calculate the implied interest rate
        if (result.rows.length >= 2) {
            const previousEvent = result.rows[1];
            const previousRate = BigInt(previousEvent.exchange_rate);
            const previousTimestamp = Number(previousEvent.timestamp);

            // Calculate the time between the two events
            const timeBetweenEvents = BigInt(mostRecentTimestamp - previousTimestamp);

            if (timeBetweenEvents > 0n && mostRecentRate > previousRate) {
                // Calculate the rate of change per second
                // rateChange = (newRate - oldRate) / oldRate / timeElapsed
                const rateChange = ((mostRecentRate - previousRate) * EXCHANGE_PRECISION) / previousRate;
                const ratePerSecond = rateChange / timeBetweenEvents;

                // Extrapolate to target timestamp
                // newRate = mostRecentRate * (1 + ratePerSecond * timeElapsed / EXCHANGE_PRECISION)
                const extrapolatedRate = mostRecentRate + (mostRecentRate * ratePerSecond * timeElapsed) / EXCHANGE_PRECISION;

                return extrapolatedRate;
            }
        }

        // If we can't calculate an interest rate, just return the most recent rate
        // This happens when:
        // - Only 1 event exists
        // - Exchange rate decreased (liquidation/loss event)
        // - No time elapsed between events
        return mostRecentRate;

    } catch (error: any) {
        console.error(`Error calculating exchange rate for pair ${pair} at timestamp ${targetTimestamp}:`, error.message);
        return EXCHANGE_PRECISION;
    }
}

/**
 * Get exchange rate for an isolated pair at a specific timestamp (legacy function)
 *
 * @deprecated Use calculateIsolatedPairExchangeRateAtTimestamp() instead for accurate calculations
 * 
 * This function is kept for backward compatibility but simply delegates to the main
 * calculation function.
 * 
 * @param context - Ponder context with database access
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Exchange rate at timestamp (1e18 precision)
 */
export async function getIsolatedPairExchangeRate(
    context: any,
    pair: string,
    timestamp: number
): Promise<bigint> {
    return calculateIsolatedPairExchangeRateAtTimestamp(context, pair, timestamp);
}

