/**
 * Yield Calculation Module
 * 
 * This module provides comprehensive yield tracking and reporting for AAVE/Hyperlend protocol:
 * - Balance queries (historical and current)
 * - Segmented yield calculations
 * - Monthly, daily, and custom period reports
 * - Portfolio value tracking
 */

// Re-export balance query functions
export * from "./balanceQueries";

// Re-export yield calculation functions
export * from "./yieldCalculations";

// Note: yieldReports.ts exports are handled separately to avoid circular dependencies
// Import from "./yieldReports" directly when needed

