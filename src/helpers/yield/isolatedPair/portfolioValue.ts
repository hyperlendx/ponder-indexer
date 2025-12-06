/**
 * Isolated Pair Portfolio Value Calculations
 *
 * Functions for calculating daily portfolio values for isolated pairs.
 * Portfolio Value = Total Supplied (Collateral + Assets) - Total Borrowed
 */

import { calculateAllIsolatedPairPositions } from "./positionCalculations";
import { AssetPriceSnapshot, IsolatedPairRegistry } from "ponder:schema";
import { eq, and, lte, desc } from "ponder";
import { calculateUSDValueNumber } from "../../usdCalculations";

/**
 * Calculate daily portfolio values for isolated pairs over a custom time period
 * Portfolio Value = Total Supplied (Collateral + Assets) - Total Borrowed
 *
 * Returns daily breakdown showing collateral, assets, and borrowed amounts per pair,
 * suitable for portfolio value charts and net worth tracking.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of time period (Unix timestamp)
 * @param endTimestamp - End of time period (Unix timestamp)
 * @returns Object with dailyValues array containing portfolio data for each day
 */
export async function calculateUserDailyIsolatedPairPortfolioValue(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    dailyValues: Array<{
        date: string;
        timestamp: number;
        portfolioValue: bigint;
        totalSupplied: bigint;
        totalBorrowed: bigint;
        portfolioValueUSD: string;
        totalSuppliedUSD: string;
        totalBorrowedUSD: string;
        pairs: Array<{
            pair: string;
            collateralAddress: string; // Collateral token address (e.g., WHLP)
            assetAddress: string; // Asset token address (e.g., USDT0)
            collateralAmount: bigint;
            assetAmount: bigint;
            borrowAmount: bigint;
            netPosition: bigint;
            collateralUSD: string;
            assetUSD: string;
            borrowedUSD: string;
            netPositionUSD: string;
            collateralPrice?: string; // Collateral USD price from Chainlink (8 decimals)
            collateralPriceTimestamp?: number; // Timestamp when the collateral price was recorded
            assetPrice?: string; // Asset USD price from Chainlink (8 decimals)
            assetPriceTimestamp?: number; // Timestamp when the asset price was recorded
        }>;
    }>;
}> {
    try {
        const dbQuery = context.db.sql || context.db;

        // Calculate start of first day and last day (midnight UTC)
        const startDate = new Date(startTimestamp * 1000);
        startDate.setUTCHours(0, 0, 0, 0);
        const firstDayStart = Math.floor(startDate.getTime() / 1000);

        const endDate = new Date(endTimestamp * 1000);
        endDate.setUTCHours(0, 0, 0, 0);
        const lastDayStart = Math.floor(endDate.getTime() / 1000);

        const oneDaySeconds = 24 * 60 * 60;
        const dailyValues = [];

        // Generate portfolio values for each day at END of day (23:59:59 UTC)
        for (let dayStart = firstDayStart; dayStart <= lastDayStart; dayStart += oneDaySeconds) {
            // Calculate at END of day instead of start
            const dayEnd = dayStart + oneDaySeconds - 1;
            const positions = await calculateAllIsolatedPairPositions(context, user, dayEnd);

            if (positions.length === 0) {
                continue; // Skip days with no positions
            }

            let totalSupplied = 0n;
            let totalBorrowed = 0n;
            let totalSuppliedUSD = 0;
            let totalBorrowedUSD = 0;

            const pairsWithUSD = [];

            // Process each pair and calculate USD values
            for (const pos of positions) {
                // Get pair info from IsolatedPairRegistry (asset, collateral addresses)
                const pairInfo = await dbQuery
                    .select()
                    .from(IsolatedPairRegistry)
                    .where(eq(IsolatedPairRegistry.id, pos.pair as `0x${string}`))
                    .limit(1);

                if (pairInfo.length === 0) {
                    console.warn(`[portfolioValue] Pair ${pos.pair} not found in registry, skipping`);
                    continue;
                }

                const { asset: assetAddress, collateral: collateralAddress } = pairInfo[0];

                // Get collateral USD price and decimals from AssetPriceSnapshot
                const collateralPriceSnapshots = await dbQuery
                    .select()
                    .from(AssetPriceSnapshot)
                    .where(
                        and(
                            eq(AssetPriceSnapshot.asset, collateralAddress),
                            lte(AssetPriceSnapshot.timestamp, dayEnd)
                        )
                    )
                    .orderBy(desc(AssetPriceSnapshot.timestamp))
                    .limit(1);

                const collateralPrice = collateralPriceSnapshots.length > 0 ? collateralPriceSnapshots[0].price : undefined;
                const collateralDecimals = collateralPriceSnapshots.length > 0 ? collateralPriceSnapshots[0].decimals : 18;
                const collateralPriceTimestamp = collateralPriceSnapshots.length > 0 ? collateralPriceSnapshots[0].timestamp : undefined;

                // Get asset USD price and decimals from AssetPriceSnapshot
                const assetPriceSnapshots = await dbQuery
                    .select()
                    .from(AssetPriceSnapshot)
                    .where(
                        and(
                            eq(AssetPriceSnapshot.asset, assetAddress),
                            lte(AssetPriceSnapshot.timestamp, dayEnd)
                        )
                    )
                    .orderBy(desc(AssetPriceSnapshot.timestamp))
                    .limit(1);

                const assetPrice = assetPriceSnapshots.length > 0 ? assetPriceSnapshots[0].price : undefined;
                const assetDecimals = assetPriceSnapshots.length > 0 ? assetPriceSnapshots[0].decimals : 6;
                const assetPriceTimestamp = assetPriceSnapshots.length > 0 ? assetPriceSnapshots[0].timestamp : undefined;

                // Calculate USD values using direct USD prices from Chainlink
                // Both prices are in 8 decimals (USD)
                const collateralUSD = calculateUSDValueNumber(pos.collateralAmount, collateralPrice, collateralDecimals);
                const assetUSD = calculateUSDValueNumber(pos.assetAmount, assetPrice, assetDecimals);
                const borrowedUSD = calculateUSDValueNumber(pos.borrowAmount, assetPrice, assetDecimals);

                const suppliedUSD = collateralUSD + assetUSD;
                const netPositionUSD = suppliedUSD - borrowedUSD;

                // Calculate net position in token terms
                const netPosition = (pos.collateralAmount + pos.assetAmount) - pos.borrowAmount;

                totalSupplied += pos.collateralAmount + pos.assetAmount;
                totalBorrowed += pos.borrowAmount;
                totalSuppliedUSD += suppliedUSD;
                totalBorrowedUSD += borrowedUSD;

                pairsWithUSD.push({
                    pair: pos.pair,
                    collateralAddress: collateralAddress as string,
                    assetAddress: assetAddress as string,
                    collateralAmount: pos.collateralAmount,
                    assetAmount: pos.assetAmount,
                    borrowAmount: pos.borrowAmount,
                    netPosition,
                    collateralUSD: collateralUSD.toString(),
                    assetUSD: assetUSD.toString(),
                    borrowedUSD: borrowedUSD.toString(),
                    netPositionUSD: netPositionUSD.toString(),
                    collateralPrice: collateralPrice?.toString(),
                    collateralPriceTimestamp,
                    assetPrice: assetPrice?.toString(),
                    assetPriceTimestamp
                });
            }

            const portfolioValue = totalSupplied - totalBorrowed;
            const portfolioValueUSD = totalSuppliedUSD - totalBorrowedUSD;

            dailyValues.push({
                date: new Date(dayStart * 1000).toISOString().split('T')[0]!,
                timestamp: dayEnd,
                portfolioValue,
                totalSupplied,
                totalBorrowed,
                portfolioValueUSD: portfolioValueUSD.toString(),
                totalSuppliedUSD: totalSuppliedUSD.toString(),
                totalBorrowedUSD: totalBorrowedUSD.toString(),
                pairs: pairsWithUSD
            });
        }

        return {
            dailyValues
        };

    } catch (error) {
        console.error(`❌ Error in calculateUserDailyIsolatedPairPortfolioValue for user ${user}:`, error);
        throw error;
    }
}

