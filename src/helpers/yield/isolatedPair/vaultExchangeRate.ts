/**
 * Vault Exchange Rate Calculations for Isolated Pairs
 *
 * This module provides exchange rate calculations by tracking the vault state
 * (totalAsset and totalBorrow) just like the contract does.
 *
 * The exchange rate is calculated as: totalAsset.amount / totalAsset.shares
 *
 * This matches the calculation the contract uses in VaultAccountingLibrary.toAmount()
 *
 * IMPORTANT: Exchange rates are extrapolated between events using the PRECISE formula
 * that matches the contract's _calculateInterest function (pairCore.sol lines 360-385):
 *
 * 1. Interest accrues on totalBorrowAmount (not totalAssetAmount)
 * 2. FULL interest is added to BOTH totalBorrow.amount AND totalAsset.amount
 * 3. Protocol fees are handled by minting new shares (diluting lenders), NOT by reducing interest
 *
 * Formula (matching contract exactly):
 *   interestEarned = totalBorrowAmount × ratePerSec × timeElapsed / RATE_PRECISION
 *   newTotalAssetAmount = totalAssetAmount + interestEarned  // FULL interest
 *   feesAmount = interestEarned × feeToProtocolRate / FEE_PRECISION
 *   feesShare = feesAmount × totalAssetShares / (newTotalAssetAmount - feesAmount)
 *   newTotalAssetShares = totalAssetShares + feesShare  // Dilutes lenders
 *   newExchangeRate = newTotalAssetAmount × 1e18 / newTotalAssetShares
 */

import { EXCHANGE_PRECISION } from "./constants";
import {
    getVaultStateWithTimestamp,
    calculateExchangeRateFromVaultState,
} from "./vaultState";
import { getInterestRateAtTimestamp } from "./interestRateQueries";

// Fee precision used in the contract (feeToProtocolRate is in this precision)
// feeToProtocolRate of 20000 = 2% (20000 / 1000000)
const FEE_PRECISION = 1000000n;

// Default fee to protocol rate (2%) - used if we can't get the actual value
const DEFAULT_FEE_TO_PROTOCOL_RATE = 20000n;

/**
 * Calculate exchange rate at a specific timestamp using vault state with PRECISE interest extrapolation
 *
 * This function calculates the exchange rate by:
 * 1. Getting the most recent vault state (including borrow state) at or before the target timestamp
 * 2. Getting the interest rate (ratePerSec) at that time
 * 3. Calculating interest earned on the borrowed amount
 * 4. Adding FULL interest to totalAssetAmount (not net of fees)
 * 5. Calculating fee shares that dilute lenders
 * 6. Calculating the new exchange rate with updated amount AND shares
 *
 * This PRECISELY matches the contract's _calculateInterest function (pairCore.sol lines 360-385).
 *
 * @param context - Ponder context with database access
 * @param pair - Isolated pair address
 * @param targetTimestamp - Target timestamp to calculate exchange rate for
 * @param feeToProtocolRate - Optional fee rate (defaults to 2% = 20000)
 * @returns Exchange rate at target timestamp (1e18 precision)
 *
 * @example
 * ```typescript
 * // Get exchange rate at specific timestamp
 * const rate = await calculateIsolatedPairExchangeRate(context, "0xPair...", 1234567890);
 * // Returns: 1050000000000000000n (1.05 exchange rate)
 * ```
 */
export async function calculateIsolatedPairExchangeRate(
    context: any,
    pair: string,
    targetTimestamp: number,
    feeToProtocolRate: bigint = DEFAULT_FEE_TO_PROTOCOL_RATE
): Promise<bigint> {
    const { db } = context;

    try {
        // Get vault state WITH its timestamp so we can extrapolate
        const vaultStateWithTime = await getVaultStateWithTimestamp(db, pair, targetTimestamp);

        if (!vaultStateWithTime) {
            // No vault state found - pair hasn't been initialized yet
            return EXCHANGE_PRECISION; // Default 1:1
        }

        // Calculate base exchange rate from vault state
        const baseExchangeRate = calculateExchangeRateFromVaultState(
            vaultStateWithTime.totalAssetAmount,
            vaultStateWithTime.totalAssetShares
        );

        // If the vault state timestamp matches the target, no extrapolation needed
        if (vaultStateWithTime.timestamp >= targetTimestamp) {
            return baseExchangeRate;
        }

        // If there's no borrowed amount, no interest accrues
        if (vaultStateWithTime.totalBorrowAmount === 0n) {
            return baseExchangeRate;
        }

        // Calculate time elapsed since the last vault state update
        const timeElapsed = BigInt(targetTimestamp - vaultStateWithTime.timestamp);

        // Get the interest rate at the vault state timestamp
        const ratePerSec = await getInterestRateAtTimestamp(db, pair, vaultStateWithTime.timestamp);

        if (ratePerSec === 0n) {
            // No interest rate found or rate is 0, return base exchange rate
            return baseExchangeRate;
        }

        // PRECISE CALCULATION matching the contract's _calculateInterest function:
        //
        // Contract formula (pairCore.sol lines 360-385):
        //   interestEarned = (deltaTime * totalBorrow.amount * newRate) / RATE_PRECISION
        //   totalBorrow.amount += interestEarned
        //   totalAsset.amount += interestEarned  // FULL interest goes to totalAsset
        //   if (feeToProtocolRate > 0):
        //     feesAmount = (interestEarned * feeToProtocolRate) / FEE_PRECISION
        //     feesShare = (feesAmount * totalAsset.shares) / (totalAsset.amount - feesAmount)
        //     totalAsset.shares += feesShare  // Protocol gets shares, diluting lenders
        //
        // IMPORTANT: The contract adds FULL interestEarned to totalAsset.amount,
        // NOT (interestEarned - fees). Fees are handled by minting new shares to protocol.

        // 1. Calculate interest earned on borrowed amount
        // RATE_PRECISION = EXCHANGE_PRECISION = 1e18
        const interestEarned = (vaultStateWithTime.totalBorrowAmount * ratePerSec * timeElapsed) / EXCHANGE_PRECISION;

        // 2. Calculate new totalAssetAmount (FULL interest, not net of fees)
        const newTotalAssetAmount = vaultStateWithTime.totalAssetAmount + interestEarned;

        // 3. Calculate fee shares that dilute lenders
        let newTotalAssetShares = vaultStateWithTime.totalAssetShares;
        if (feeToProtocolRate > 0n && interestEarned > 0n) {
            const feesAmount = (interestEarned * feeToProtocolRate) / FEE_PRECISION;
            // feesShare = (feesAmount * totalAsset.shares) / (totalAsset.amount - feesAmount)
            // Note: totalAsset.amount here is AFTER adding interestEarned
            const denominator = newTotalAssetAmount - feesAmount;
            if (denominator > 0n) {
                const feesShare = (feesAmount * vaultStateWithTime.totalAssetShares) / denominator;
                newTotalAssetShares = vaultStateWithTime.totalAssetShares + feesShare;
            }
        }

        // 4. Calculate new exchange rate with updated amount AND shares
        const extrapolatedRate = calculateExchangeRateFromVaultState(
            newTotalAssetAmount,
            newTotalAssetShares
        );

        return extrapolatedRate;

    } catch (error: any) {
        console.error(`Error calculating exchange rate for pair ${pair} at timestamp ${targetTimestamp}:`, error);
        return EXCHANGE_PRECISION;
    }
}

