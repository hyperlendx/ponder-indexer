/**
 * Vault Exchange Rate Calculations for Isolated Pairs
 *
 * This module provides exchange rate calculations by tracking the vault state
 * (totalAsset.amount and totalAsset.shares) just like the contract does.
 *
 * The exchange rate is calculated as: totalAsset.amount / totalAsset.shares
 *
 * This matches the calculation the contract uses in VaultAccountingLibrary.toAmount()
 */

import { EXCHANGE_PRECISION } from "./constants";
import {
    getVaultStateAtTimestamp,
    calculateExchangeRateFromVaultState,
    getCurrentVaultState,
} from "./vaultState";

/**
 * Calculate exchange rate at a specific timestamp using vault state
 *
 * This function calculates the exchange rate by querying the vault state
 * (totalAsset.amount and totalAsset.shares) at the target timestamp.
 *
 * The calculation is: exchangeRate = totalAsset.amount / totalAsset.shares
 *
 * This matches what the contract does in VaultAccountingLibrary.toAmount()
 *
 * @param context - Ponder context with database access
 * @param pair - Isolated pair address
 * @param targetTimestamp - Target timestamp to calculate exchange rate for
 * @returns Exchange rate at target timestamp (1e18 precision)
 *
 * @example
 * ```typescript
 * // Get exchange rate at specific timestamp
 * const rate = await calculateIsolatedPairExchangeRate(context, "0xPair...", 1234567890);
 * // Returns: 1050000000000000000n (1.05 exchange rate)
 * ```
 *
 * @note
 * This calculation:
 * - Uses actual vault state from events
 * - Is deterministic (same inputs always produce same output)
 * - Matches contract behavior
 * - Requires no approximation or extrapolation
 */
export async function calculateIsolatedPairExchangeRate(
    context: any,
    pair: string,
    targetTimestamp: number
): Promise<bigint> {
    const { db } = context;

    try {
        // Get vault state at the target timestamp
        const vaultState = await getVaultStateAtTimestamp(db, pair, targetTimestamp);

        if (!vaultState) {
            // No vault state found - pair hasn't been initialized yet
            return EXCHANGE_PRECISION; // Default 1:1
        }

        // Calculate exchange rate from vault state
        return calculateExchangeRateFromVaultState(
            vaultState.totalAssetAmount,
            vaultState.totalAssetShares
        );

    } catch (error: any) {
        console.error(`Error calculating exchange rate for pair ${pair} at timestamp ${targetTimestamp}:`, error);
        return EXCHANGE_PRECISION;
    }
}

/**
 * Get the current exchange rate for a pair (at latest block)
 *
 * This is useful for getting the most up-to-date exchange rate without
 * specifying a target timestamp.
 *
 * @param context - Ponder context with database access
 * @param pair - Isolated pair address
 * @returns Current exchange rate (1e18 precision)
 */
export async function getCurrentExchangeRate(
    context: any,
    pair: string
): Promise<bigint> {
    const { db } = context;

    try {
        // Get the most recent vault state
        const vaultState = await getCurrentVaultState(db, pair);

        if (!vaultState) {
            return EXCHANGE_PRECISION; // Default 1:1
        }

        // Calculate exchange rate from vault state
        return calculateExchangeRateFromVaultState(
            vaultState.totalAssetAmount,
            vaultState.totalAssetShares
        );

    } catch (error: any) {
        console.error(`Error getting current exchange rate for pair ${pair}:`, error);
        return EXCHANGE_PRECISION;
    }
}

