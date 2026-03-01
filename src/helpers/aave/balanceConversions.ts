import { RayMath } from "./rayMath";

/**
 * Calculate actual balance from scaled balance and liquidity index (AAVE methodology)
 *
 * In AAVE, user balances are stored as "scaled balances" which remain constant,
 * while the "actual balance" grows over time as interest accrues through the
 * increasing liquidity index.
 *
 * Formula: actualBalance = scaledBalance * liquidityIndex / RAY
 *
 * @param scaledBalance - The user's scaled balance in ray precision (1e27)
 *                       This value remains constant in storage
 * @param liquidityIndex - Current liquidity index in ray precision (1e27)
 *                        This grows over time as interest accrues
 * @returns The actual balance in ray precision (1e27)
 *          This represents the current withdrawable amount
 *
 * @example
 * // User deposited 1000 USDC when index was 1.0, now index is 1.05
 * const scaled = 1000000000000000000000000000000n; // 1000 scaled USDC
 * const index = 1050000000000000000000000000n;     // 1.05 RAY
 * const actual = calculateActualBalance(scaled, index);
 * // Result: 1050000000000000000000000000000n (1050 actual USDC)
 */
export function calculateActualBalance(scaledBalance: bigint, liquidityIndex: bigint): bigint {
    return RayMath.rayMul(scaledBalance, liquidityIndex);
}

/**
 * Calculate scaled balance from actual balance and liquidity index (AAVE methodology)
 *
 * This is the inverse operation of calculateActualBalance, used when converting
 * deposit/withdrawal amounts to scaled balances for storage.
 *
 * Formula: scaledBalance = actualBalance * RAY / liquidityIndex
 *
 * @param actualBalance - The actual balance amount in ray precision (1e27)
 *                       This is typically a deposit/withdrawal amount
 * @param liquidityIndex - Current liquidity index in ray precision (1e27)
 *                        Used to normalize the amount to scaled form
 * @returns The scaled balance in ray precision (1e27)
 *          This is the amount stored in user's balance record
 *
 * @example
 * // User deposits 1000 USDC when index is 1.05
 * const actual = 1000000000000000000000000000000n; // 1000 actual USDC
 * const index = 1050000000000000000000000000n;     // 1.05 RAY
 * const scaled = calculateScaledBalance(actual, index);
 * // Result: ~952380952380952380952380952n (≈952.38 scaled USDC)
 */
export function calculateScaledBalance(actualBalance: bigint, liquidityIndex: bigint): bigint {
    return RayMath.rayDiv(actualBalance, liquidityIndex);
}

