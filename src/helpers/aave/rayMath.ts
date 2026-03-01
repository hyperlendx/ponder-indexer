// Constants for ray math (1e27 precision)
export const RAY = 1000000000000000000000000000n; // 1e27
export const SECONDS_PER_YEAR = 31536000n; // 365 * 24 * 60 * 60

/**
 * Ray math operations for high precision calculations (AAVE methodology)
 *
 * Ray precision uses 1e27 (27 decimal places) for maximum precision in DeFi calculations.
 * This matches AAVE's implementation and prevents precision loss in interest calculations.
 *
 * All operations include rounding to nearest integer to match AAVE's behavior.
 */
export class RayMath {
    /**
     * Multiply two ray values with proper rounding
     *
     * Formula: (a * b + RAY/2) / RAY
     * The RAY/2 addition provides rounding to nearest integer.
     *
     * @param a - First ray value (1e27 precision)
     * @param b - Second ray value (1e27 precision)
     * @returns Product in ray precision with proper rounding
     *
     * @example
     * // Multiply 1.5 * 2.0 in ray precision
     * const a = 1500000000000000000000000000n; // 1.5 RAY
     * const b = 2000000000000000000000000000n; // 2.0 RAY
     * const result = RayMath.rayMul(a, b);
     * // Result: 3000000000000000000000000000n (3.0 RAY)
     */
    static rayMul(a: bigint, b: bigint): bigint {
        return (a * b + RAY / 2n) / RAY;
    }

    /**
     * Divide two ray values with proper rounding
     *
     * Formula: (a * RAY + b/2) / b
     * The b/2 addition provides rounding to nearest integer.
     *
     * @param a - Dividend in ray precision (1e27)
     * @param b - Divisor in ray precision (1e27)
     * @returns Quotient in ray precision with proper rounding
     * @throws Will throw if b is zero (division by zero)
     *
     * @example
     * // Divide 3.0 / 2.0 in ray precision
     * const a = 3000000000000000000000000000n; // 3.0 RAY
     * const b = 2000000000000000000000000000n; // 2.0 RAY
     * const result = RayMath.rayDiv(a, b);
     * // Result: 1500000000000000000000000000n (1.5 RAY)
     */
    static rayDiv(a: bigint, b: bigint): bigint {
        if (b === 0n) {
            throw new Error("Division by zero in rayDiv");
        }
        return (a * RAY + b / 2n) / b;
    }
}

