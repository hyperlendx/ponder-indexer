/**
 * Isolated Pair Portfolio Value Calculations
 *
 * Functions for calculating daily portfolio values for isolated pairs.
 * Portfolio Value = Total Supplied (Collateral + Assets) - Total Borrowed
 */

import { calculateAllIsolatedPairPositions } from "./positionCalculations";
import { getDecimals } from "../../getDecimals";
import { DepositIsolated, BorrowAssetIsolated, AddCollateralIsolated } from "ponder:schema";
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
            collateralAmount: bigint;
            assetAmount: bigint;
            borrowAmount: bigint;
            netPosition: bigint;
            collateralUSD: string;
            assetUSD: string;
            borrowedUSD: string;
            netPositionUSD: string;
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
                // Get decimals for this pair
                const decimals = await getDecimals(context, pos.pair) || 18;

                // Get historical price at day end from events
                // Try DepositIsolated first
                let assetPrice: bigint | undefined = undefined;

                const depositEvents = await dbQuery
                    .select()
                    .from(DepositIsolated)
                    .where(
                        and(
                            eq(DepositIsolated.owner, user as `0x${string}`),
                            eq(DepositIsolated.pair, pos.pair as `0x${string}`),
                            lte(DepositIsolated.timestamp, dayEnd)
                        )
                    )
                    .orderBy(desc(DepositIsolated.timestamp))
                    .limit(1);

                if (depositEvents.length > 0) {
                    assetPrice = depositEvents[0].price;
                }


                // If no deposit events, try BorrowAssetIsolated
                if (!assetPrice) {
                    const borrowEvents = await dbQuery
                        .select()
                        .from(BorrowAssetIsolated)
                        .where(
                            and(
                                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                                eq(BorrowAssetIsolated.pair, pos.pair as `0x${string}`),
                                lte(BorrowAssetIsolated.timestamp, dayEnd)
                            )
                        )
                        .orderBy(desc(BorrowAssetIsolated.timestamp))
                        .limit(1);

                    if (borrowEvents.length > 0) {
                        assetPrice = borrowEvents[0].price;
                    }
                }

                // If still no price, try AddCollateralIsolated
                if (!assetPrice) {
                    const collateralEvents = await dbQuery
                        .select()
                        .from(AddCollateralIsolated)
                        .where(
                            and(
                                eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                                eq(AddCollateralIsolated.pair, pos.pair as `0x${string}`),
                                lte(AddCollateralIsolated.timestamp, dayEnd)
                            )
                        )
                        .orderBy(desc(AddCollateralIsolated.timestamp))
                        .limit(1);

                    if (collateralEvents.length > 0) {
                        assetPrice = collateralEvents[0].price;
                    }
                }

                // Calculate USD values
                const collateralUSD = calculateUSDValueNumber(pos.collateralAmount, assetPrice, decimals);
                const assetUSD = calculateUSDValueNumber(pos.assetAmount, assetPrice, decimals);
                const borrowedUSD = calculateUSDValueNumber(pos.borrowAmount, assetPrice, decimals);
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
                    collateralAmount: pos.collateralAmount,
                    assetAmount: pos.assetAmount,
                    borrowAmount: pos.borrowAmount,
                    netPosition,
                    collateralUSD: collateralUSD.toFixed(4),
                    assetUSD: assetUSD.toFixed(4),
                    borrowedUSD: borrowedUSD.toFixed(4),
                    netPositionUSD: netPositionUSD.toFixed(4)
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
                portfolioValueUSD: portfolioValueUSD.toFixed(4),
                totalSuppliedUSD: totalSuppliedUSD.toFixed(4),
                totalBorrowedUSD: totalBorrowedUSD.toFixed(4),
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

