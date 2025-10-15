/**
 * Isolated Pair Position Calculations
 * 
 * Functions for calculating user positions in isolated pairs.
 * Positions combine balances (shares, collateral) with exchange rates
 * to provide a complete view of user holdings.
 */

import {
    getIsolatedPairCollateralBalance,
    getIsolatedPairAssetShares,
    getIsolatedPairBorrowShares,
    convertSharesToAssets
} from "./balanceQueries";
import { getIsolatedPairExchangeRate } from "./exchangeRate";
import { getUserIsolatedPairs } from "./pairTracking";

/**
 * Position data for a single isolated pair
 */
export interface IsolatedPairPosition {
    pair: string;
    collateralAmount: bigint;
    assetShares: bigint;
    borrowShares: bigint;
    assetAmount: bigint;
    borrowAmount: bigint;
    exchangeRate: bigint;
}

/**
 * Calculate isolated pair position for a user at a specific timestamp
 * 
 * Returns collateral, asset shares, borrow shares, and converted amounts.
 * This provides a complete snapshot of the user's position in a single pair.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Position data including shares and converted amounts
 * 
 * @example
 * ```typescript
 * const position = await calculateIsolatedPairPosition(context, "0x123...", "0xPair...", 1234567890);
 * // Returns: {
 * //   pair: "0xPair...",
 * //   collateralAmount: 1000000000000000000n,  // 1 token collateral
 * //   assetShares: 1000000000000000000n,       // 1000 asset shares
 * //   borrowShares: 500000000000000000n,       // 500 borrow shares
 * //   assetAmount: 1050000000000000000n,       // 1050 tokens (shares × rate)
 * //   borrowAmount: 525000000000000000n,       // 525 tokens (shares × rate)
 * //   exchangeRate: 1050000000000000000n       // 1.05 exchange rate
 * // }
 * ```
 */
export async function calculateIsolatedPairPosition(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<IsolatedPairPosition> {
    // Get all balances and exchange rate in parallel
    const [collateralAmount, assetShares, borrowShares, exchangeRate] = await Promise.all([
        getIsolatedPairCollateralBalance(context, user, pair, timestamp),
        getIsolatedPairAssetShares(context, user, pair, timestamp),
        getIsolatedPairBorrowShares(context, user, pair, timestamp),
        getIsolatedPairExchangeRate(context, pair, timestamp)
    ]);

    // Convert shares to amounts using the exchange rate
    const assetAmount = convertSharesToAssets(assetShares, exchangeRate);
    const borrowAmount = convertSharesToAssets(borrowShares, exchangeRate);

    return {
        pair,
        collateralAmount,
        assetShares,
        borrowShares,
        assetAmount,
        borrowAmount,
        exchangeRate
    };
}

/**
 * Calculate all isolated pair positions for a user at a specific timestamp
 * 
 * This is the main function used by APIs to get complete isolated pair data.
 * It finds all pairs the user has interacted with and calculates positions for each.
 * 
 * Positions with zero balances are filtered out.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param timestamp - Target timestamp
 * @param startTimestamp - Optional start timestamp for filtering pairs (backward compatibility)
 * @returns Array of position data for all active pairs
 * 
 * @example
 * ```typescript
 * const positions = await calculateAllIsolatedPairPositions(context, "0x123...", 1234567890);
 * // Returns: [
 * //   { pair: "0xPair1...", collateralAmount: 1000n, assetShares: 1000n, ... },
 * //   { pair: "0xPair2...", collateralAmount: 2000n, assetShares: 2000n, ... }
 * // ]
 * ```
 */
export async function calculateAllIsolatedPairPositions(
    context: any,
    user: string,
    timestamp: number,
    startTimestamp?: number
): Promise<IsolatedPairPosition[]> {
    // Get all pairs user has interacted with
    // Use a wide time range to catch all historical interactions
    const effectiveStartTimestamp = startTimestamp || 0;
    const pairs = await getUserIsolatedPairs(context, user, effectiveStartTimestamp, timestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Calculate position for each pair in parallel
    const positions = await Promise.all(
        pairs.map(pair => calculateIsolatedPairPosition(context, user, pair, timestamp))
    );

    // Filter out pairs with zero balances
    return positions.filter(pos =>
        pos.collateralAmount > 0n ||
        pos.assetShares > 0n ||
        pos.borrowShares > 0n
    );
}

