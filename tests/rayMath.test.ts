/**
 * Test suite for Ray Math operations and core calculations
 * These tests don't depend on external modules and can run independently
 */

import { describe, it, expect } from 'vitest';

// Constants
const RAY = 1000000000000000000000000000n; // 1e27
const SECONDS_PER_YEAR = 31536000n; // 365 * 24 * 60 * 60

/**
 * Ray math operations for high precision calculations
 */
class RayMath {
    /**
     * Multiply two ray values
     */
    static rayMul(a: bigint, b: bigint): bigint {
        return (a * b + RAY / 2n) / RAY;
    }

    /**
     * Divide two ray values
     */
    static rayDiv(a: bigint, b: bigint): bigint {
        return (a * RAY + b / 2n) / b;
    }

    /**
     * Convert a percentage rate to ray format
     * @param rate - Rate in basis points (e.g., 500 = 5%)
     */
    static percentToRay(rate: number): bigint {
        return BigInt(rate) * RAY / 10000n;
    }

    /**
     * Convert ray to percentage
     */
    static rayToPercent(ray: bigint): number {
        return Number(ray * 10000n / RAY);
    }
}

/**
 * Calculate actual balance from scaled balance and current liquidity index
 */
function calculateActualBalance(scaledBalance: bigint, liquidityIndex: bigint): bigint {
    return RayMath.rayMul(scaledBalance, liquidityIndex);
}

/**
 * Calculate scaled balance from actual balance and current liquidity index
 */
function calculateScaledBalance(actualBalance: bigint, liquidityIndex: bigint): bigint {
    return RayMath.rayDiv(actualBalance, liquidityIndex);
}

/**
 * Format ray value for display (convert to decimal with specified precision)
 */
function formatRayValue(value: bigint, decimals: number = 18): string {
    const divisor = 10n ** BigInt(decimals);
    const scaled = value / (RAY / divisor);
    const integer = scaled / divisor;
    const fraction = scaled % divisor;
    
    return `${integer}.${fraction.toString().padStart(decimals, '0')}`;
}

/**
 * Validate that a liquidity index is reasonable
 */
function validateLiquidityIndex(index: bigint): boolean {
    // Index should be at least 1 RAY and not exceed reasonable bounds
    return index >= RAY && index <= RAY * 10n; // Max 10x growth
}

describe('Ray Math Operations', () => {
    it('should correctly multiply ray values', () => {
        const a = RAY; // 1.0
        const b = RAY * 2n; // 2.0
        const result = RayMath.rayMul(a, b);
        expect(result).toBe(RAY * 2n); // 2.0
    });

    it('should correctly divide ray values', () => {
        const a = RAY * 4n; // 4.0
        const b = RAY * 2n; // 2.0
        const result = RayMath.rayDiv(a, b);
        expect(result).toBe(RAY * 2n); // 2.0
    });

    it('should handle percentage conversion', () => {
        const fivePercent = RayMath.percentToRay(500); // 5% (500 basis points)
        const expectedRay = RAY * 5n / 100n;
        expect(fivePercent).toBe(expectedRay);
        
        const backToPercent = RayMath.rayToPercent(fivePercent);
        expect(backToPercent).toBe(500); // Should return basis points (500 = 5%)
    });

    it('should handle precision correctly', () => {
        const smallValue = RAY / 1000n; // 0.001
        const result = RayMath.rayMul(smallValue, RAY);
        expect(result).toBe(smallValue);
    });

    it('should handle zero values', () => {
        expect(RayMath.rayMul(0n, RAY)).toBe(0n);
        expect(RayMath.rayMul(RAY, 0n)).toBe(0n);
        expect(RayMath.rayDiv(0n, RAY)).toBe(0n);
    });
});

describe('Balance Calculations', () => {
    it('should correctly calculate actual balance from scaled balance', () => {
        const scaledBalance = RAY; // 1.0 scaled
        const liquidityIndex = RAY * 12n / 10n; // 1.2 index
        const actualBalance = calculateActualBalance(scaledBalance, liquidityIndex);
        expect(actualBalance).toBe(RAY * 12n / 10n); // 1.2 actual
    });

    it('should correctly calculate scaled balance from actual balance', () => {
        const actualBalance = RAY * 12n / 10n; // 1.2 actual
        const liquidityIndex = RAY * 12n / 10n; // 1.2 index
        const scaledBalance = calculateScaledBalance(actualBalance, liquidityIndex);
        expect(scaledBalance).toBe(RAY); // 1.0 scaled
    });

    it('should handle zero balances', () => {
        const zeroScaled = calculateActualBalance(0n, RAY);
        const zeroActual = calculateScaledBalance(0n, RAY);
        expect(zeroScaled).toBe(0n);
        expect(zeroActual).toBe(0n);
    });

    it('should maintain precision in round-trip calculations', () => {
        const originalScaled = RAY * 123456789n / 100000000n; // 1.23456789
        const liquidityIndex = RAY * 15n / 10n; // 1.5
        
        const actual = calculateActualBalance(originalScaled, liquidityIndex);
        const backToScaled = calculateScaledBalance(actual, liquidityIndex);
        
        // Should be very close due to ray precision
        const difference = originalScaled > backToScaled 
            ? originalScaled - backToScaled 
            : backToScaled - originalScaled;
        expect(difference).toBeLessThan(10n); // Allow small rounding error
    });
});

describe('Validation Functions', () => {
    it('should validate reasonable liquidity indices', () => {
        expect(validateLiquidityIndex(RAY)).toBe(true); // 1.0
        expect(validateLiquidityIndex(RAY * 2n)).toBe(true); // 2.0
        expect(validateLiquidityIndex(RAY * 10n)).toBe(true); // 10.0 (max)
        
        expect(validateLiquidityIndex(RAY / 2n)).toBe(false); // 0.5 (too low)
        expect(validateLiquidityIndex(RAY * 11n)).toBe(false); // 11.0 (too high)
        expect(validateLiquidityIndex(0n)).toBe(false); // 0 (invalid)
    });
});

describe('Formatting Functions', () => {
    it('should format ray values correctly', () => {
        const oneRay = RAY;
        const formatted = formatRayValue(oneRay, 18);
        expect(formatted).toBe('1.000000000000000000');
        
        const halfRay = RAY / 2n;
        const formattedHalf = formatRayValue(halfRay, 18);
        expect(formattedHalf).toBe('0.500000000000000000');
    });

    it('should handle different decimal places', () => {
        const value = RAY * 123n / 100n; // 1.23
        const formatted = formatRayValue(value, 2);
        expect(formatted).toBe('1.23');
    });

    it('should handle zero values', () => {
        const formatted = formatRayValue(0n, 18);
        expect(formatted).toBe('0.000000000000000000');
    });
});

describe('Interest Calculation Scenarios', () => {
    it('should calculate simple interest correctly', () => {
        // Scenario: 1000 tokens deposited at 5% APY for 1 year
        const principal = RAY * 1000n; // 1000 tokens
        const rate = RAY * 5n / 100n; // 5% APY
        const timeElapsed = SECONDS_PER_YEAR; // 1 year
        
        // Calculate expected interest: principal * rate * time
        const expectedInterest = RayMath.rayMul(
            RayMath.rayMul(principal, rate),
            RayMath.rayDiv(timeElapsed, SECONDS_PER_YEAR)
        );
        
        expect(expectedInterest).toBe(RAY * 50n); // 50 tokens interest
    });

    it('should calculate compound interest approximation', () => {
        // Scenario: Starting with index 1.0, 5% rate for 1 year
        const initialIndex = RAY;
        const rate = RAY * 5n / 100n; // 5% APY
        const timeElapsed = SECONDS_PER_YEAR; // 1 year
        
        // Linear approximation: newIndex = oldIndex * (1 + rate * time)
        const interestAccrued = RayMath.rayMul(
            rate,
            RayMath.rayDiv(timeElapsed, SECONDS_PER_YEAR)
        );
        const newIndex = RayMath.rayMul(initialIndex, RAY + interestAccrued);
        
        expect(newIndex).toBe(RAY * 105n / 100n); // 1.05 index
    });

    it('should handle partial year calculations', () => {
        // Scenario: 6 months at 10% APY
        const principal = RAY * 1000n; // 1000 tokens
        const rate = RAY * 10n / 100n; // 10% APY
        const timeElapsed = SECONDS_PER_YEAR / 2n; // 6 months
        
        const expectedInterest = RayMath.rayMul(
            RayMath.rayMul(principal, rate),
            RayMath.rayDiv(timeElapsed, SECONDS_PER_YEAR)
        );
        
        expect(expectedInterest).toBe(RAY * 50n); // 50 tokens interest (5% for 6 months)
    });
});

describe('Edge Cases', () => {
    it('should handle very small amounts', () => {
        const smallAmount = 1n; // 1 wei
        const index = RAY;
        
        const actual = calculateActualBalance(smallAmount, index);
        const scaled = calculateScaledBalance(actual, index);
        
        expect(actual).toBeGreaterThan(0n);
        expect(scaled).toBeGreaterThan(0n);
    });

    it('should handle very large amounts', () => {
        const largeAmount = RAY * 1000000000n; // 1 billion tokens
        const index = RAY * 2n; // 2.0 index
        
        const actual = calculateActualBalance(largeAmount, index);
        expect(actual).toBe(RAY * 2000000000n); // 2 billion tokens
    });

    it('should handle zero time elapsed', () => {
        const principal = RAY * 1000n;
        const rate = RAY * 5n / 100n;
        const timeElapsed = 0n;
        
        const interest = RayMath.rayMul(
            RayMath.rayMul(principal, rate),
            RayMath.rayDiv(timeElapsed, SECONDS_PER_YEAR)
        );
        
        expect(interest).toBe(0n);
    });
});
