import { db } from "ponder:api";
import { UserDeposit, UserPosition, UserMonthlyInterest, ReserveDataEvent } from "ponder:schema";
import schema from "ponder:schema";
import { Hono } from "hono";
import { eq, graphql, and, desc, lte } from "ponder";
import { getUserPosition, getUserPositions } from "../helpers/userPositionManager";
import { getUserMonthlyInterestSummary } from "../helpers/monthlyInterestCalculator";
import { calculateLiquidityIndexAtTimestamp, formatRayValue } from "../helpers/interestCalculations";

const app = new Hono();

// Add GraphQL endpoint
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

// Custom API endpoint to get user's current deposits
app.get("/user/:address/deposits", async (c) => {
    const userAddress = c.req.param("address");

    if (!userAddress) {
        return c.json({ error: "User address is required" }, 400);
    }

    try {
        // Get current deposits for the user using Drizzle
        const deposits = await db
            .select()
            .from(UserDeposit)
            .where(eq(UserDeposit.user, userAddress as `0x${string}`));

        // Group deposits by token address
        const groupedDeposits: Record<string, any[]> = {};
        const uniqueTokens = new Set<string>();

        deposits.forEach(deposit => {
            const tokenAddress = deposit.token;

            if(!tokenAddress) return;

            uniqueTokens.add(tokenAddress);

            // Initialize array for this token if it doesn't exist
            if (!groupedDeposits[tokenAddress]) {
                groupedDeposits[tokenAddress] = [];
            }

            // Add the complete deposit record to the token's array
            groupedDeposits[tokenAddress].push({
                id: deposit.id,
                user: deposit.user,
                token: deposit.token,
                currentBalance: deposit.currentBalance?.toString(),
                lastUpdated: deposit.lastUpdated
            });
        });

        return c.json({
            user: userAddress,
            deposits: groupedDeposits,
            totalTokens: uniqueTokens.size
        });
    } catch (error) {
        console.error("Error fetching user deposits:", error);
        return c.json({ error: "Failed to fetch user deposits" }, 500);
    }
});

// Enhanced Interest Tracking API Endpoints



// Get user's current positions with interest tracking
app.get("/user/:address/positions", async (c) => {
    const userAddress = c.req.param("address");

    if (!userAddress) {
        return c.json({ error: "User address is required" }, 400);
    }

    try {
        // Create a mock context for helper functions
        const context = { db };
        const positions = await getUserPositions(context, userAddress);
        console.log("positions", positions);
        const formattedPositions = positions.map(pos => ({
            asset: pos.asset,
            scaledBalance: pos.scaledBalance.toString(),
            actualBalance: pos.actualBalance.toString(),
            totalDeposits: pos.totalDeposits.toString(),
            totalWithdrawals: pos.totalWithdrawals.toString(),
            currentYield: pos.currentYield.toString(),
            lastUpdated: pos.lastUpdated,
            // Format for display
            actualBalanceFormatted: formatRayValue(pos.actualBalance),
            currentYieldFormatted: formatRayValue(pos.currentYield),
        }));

        return c.json({
            user: userAddress,
            positions: formattedPositions,
            totalPositions: formattedPositions.length,
            timestamp: Math.floor(Date.now() / 1000)
        });
    } catch (error) {
        console.error("Error fetching user positions123:", userAddress);
        return c.json({ error: "Failed to fetch user positions" }, 500);
    }
});

// Get user's interest for a specific asset and period
// app.get("/user/:address/interest/:asset/:period", async (c) => {
//     const userAddress = c.req.param("address");
//     const asset = c.req.param("asset");
//     const period = c.req.param("period");
//
//     if (!userAddress || !asset || !period) {
//         return c.json({ error: "User address, asset, and period are required" }, 400);
//     }
//
//     try {
//         const context = { db };
//
//         // Parse period (format: YYYY-MM or "current")
//         if (period === "current") {
//             // Get current position and yield
//             const position = await getUserPosition(context, userAddress, asset);
//
//             if (!position) {
//                 return c.json({
//                     user: userAddress,
//                     asset,
//                     period: "current",
//                     interestEarned: "0",
//                     message: "No position found"
//                 });
//             }
//
//             return c.json({
//                 user: userAddress,
//                 asset,
//                 period: "current",
//                 interestEarned: position.currentYield.toString(),
//                 interestEarnedFormatted: formatRayValue(position.currentYield),
//                 actualBalance: position.actualBalance.toString(),
//                 actualBalanceFormatted: formatRayValue(position.actualBalance),
//                 totalDeposits: position.totalDeposits.toString(),
//                 totalWithdrawals: position.totalWithdrawals.toString(),
//                 lastUpdated: position.lastUpdated
//             });
//         } else {
//             // Parse YYYY-MM format
//             const [yearStr, monthStr] = period.split("-");
//             const year = parseInt(yearStr);
//             const month = parseInt(monthStr);
//
//             if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
//                 return c.json({ error: "Invalid period format. Use YYYY-MM or 'current'" }, 400);
//             }
//
//             // Get monthly interest data
//             const monthlyData = await getUserMonthlyInterestSummary(context, userAddress, year, month);
//             const assetData = monthlyData.find(d => d.asset.toLowerCase() === asset.toLowerCase());
//
//             if (!assetData) {
//                 return c.json({
//                     user: userAddress,
//                     asset,
//                     period,
//                     year,
//                     month,
//                     interestEarned: "0",
//                     message: "No interest data found for this period"
//                 });
//             }
//
//             return c.json({
//                 user: userAddress,
//                 asset,
//                 period,
//                 year,
//                 month,
//                 interestEarned: assetData.interestEarned.toString(),
//                 interestEarnedFormatted: formatRayValue(assetData.interestEarned),
//                 netDeposits: assetData.netDeposits.toString(),
//                 netDepositsFormatted: formatRayValue(assetData.netDeposits),
//                 calculatedAt: assetData.calculatedAt
//             });
//         }
//     } catch (error) {
//         console.error("Error fetching user interest:", error);
//         return c.json({ error: "Failed to fetch user interest" }, 500);
//     }
// });
//
// // Get reserve liquidity index at a specific timestamp
// app.get("/reserve/:asset/index/:timestamp", async (c) => {
//     const asset = c.req.param("asset");
//     const timestampStr = c.req.param("timestamp");
//
//     if (!asset || !timestampStr) {
//         return c.json({ error: "Asset and timestamp are required" }, 400);
//     }
//
//     const timestamp = parseInt(timestampStr);
//     if (isNaN(timestamp)) {
//         return c.json({ error: "Invalid timestamp" }, 400);
//     }
//
//     try {
//         const context = { db };
//         const liquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, timestamp);
//
//         return c.json({
//             asset,
//             timestamp,
//             liquidityIndex: liquidityIndex.toString(),
//             liquidityIndexFormatted: formatRayValue(liquidityIndex),
//             calculatedAt: Math.floor(Date.now() / 1000)
//         });
//     } catch (error) {
//         console.error("Error calculating liquidity index:", error);
//         return c.json({ error: "Failed to calculate liquidity index" }, 500);
//     }
// });
//
// // Get user's monthly interest summary
// app.get("/user/:address/monthly-interest", async (c) => {
//     const userAddress = c.req.param("address");
//     const yearParam = c.req.query("year");
//     const monthParam = c.req.query("month");
//
//     if (!userAddress) {
//         return c.json({ error: "User address is required" }, 400);
//     }
//
//     try {
//         const context = { db };
//         let year: number | undefined;
//         let month: number | undefined;
//
//         if (yearParam) {
//             year = parseInt(yearParam);
//             if (isNaN(year)) {
//                 return c.json({ error: "Invalid year parameter" }, 400);
//             }
//         }
//
//         if (monthParam) {
//             month = parseInt(monthParam);
//             if (isNaN(month) || month < 1 || month > 12) {
//                 return c.json({ error: "Invalid month parameter (1-12)" }, 400);
//             }
//         }
//
//         const monthlyData = await getUserMonthlyInterestSummary(context, userAddress, year, month);
//
//         // Group by month and calculate totals
//         const groupedData: Record<string, any> = {};
//         let totalInterest = 0n;
//
//         monthlyData.forEach(record => {
//             const monthKey = `${record.year}-${record.month.toString().padStart(2, '0')}`;
//
//             if (!groupedData[monthKey]) {
//                 groupedData[monthKey] = {
//                     year: record.year,
//                     month: record.month,
//                     assets: {},
//                     totalInterest: 0n,
//                     totalNetDeposits: 0n
//                 };
//             }
//
//             groupedData[monthKey].assets[record.asset] = {
//                 interestEarned: record.interestEarned.toString(),
//                 interestEarnedFormatted: formatRayValue(record.interestEarned),
//                 netDeposits: record.netDeposits.toString(),
//                 netDepositsFormatted: formatRayValue(record.netDeposits),
//                 calculatedAt: record.calculatedAt
//             };
//
//             groupedData[monthKey].totalInterest += record.interestEarned;
//             groupedData[monthKey].totalNetDeposits += record.netDeposits;
//             totalInterest += record.interestEarned;
//         });
//
//         // Format totals
//         Object.values(groupedData).forEach((monthData: any) => {
//             monthData.totalInterest = monthData.totalInterest.toString();
//             monthData.totalInterestFormatted = formatRayValue(monthData.totalInterest);
//             monthData.totalNetDeposits = monthData.totalNetDeposits.toString();
//             monthData.totalNetDepositsFormatted = formatRayValue(monthData.totalNetDeposits);
//         });
//
//         return c.json({
//             user: userAddress,
//             monthlyInterest: groupedData,
//             totalInterestEarned: totalInterest.toString(),
//             totalInterestEarnedFormatted: formatRayValue(totalInterest),
//             filters: { year, month },
//             timestamp: Math.floor(Date.now() / 1000)
//         });
//     } catch (error) {
//         console.error("Error fetching monthly interest summary:", error);
//         return c.json({ error: "Failed to fetch monthly interest summary" }, 500);
//     }
// });
//
// Get reserve data events for a specific asset
app.get("/reserve/:asset/events", async (c) => {
    const asset = c.req.param("asset");
    const limitParam = c.req.query("limit") || "50";
    const offsetParam = c.req.query("offset") || "0";

    if (!asset) {
        return c.json({ error: "Asset address is required" }, 400);
    }

    const limit = parseInt(limitParam);
    const offset = parseInt(offsetParam);

    if (isNaN(limit) || isNaN(offset) || limit < 1 || limit > 1000) {
        return c.json({ error: "Invalid limit (1-1000) or offset" }, 400);
    }

    try {
        const events = await db
            .select()
            .from(ReserveDataEvent)
            .where(eq(ReserveDataEvent.reserve, asset as `0x${string}`))
            .orderBy(desc(ReserveDataEvent.timestamp))
            .limit(limit)
            .offset(offset);

        const formattedEvents = events.map(event => ({
            id: event.id,
            txHash: event.txHash,
            reserve: event.reserve,
            liquidityIndex: event.liquidityIndex.toString(),
            liquidityIndexFormatted: formatRayValue(event.liquidityIndex),
            liquidityRate: event.liquidityRate.toString(),
            liquidityRateFormatted: formatRayValue(event.liquidityRate),
            timestamp: event.timestamp,
            blockNumber: event.blockNumber.toString(),
            date: new Date(event.timestamp * 1000).toISOString()
        }));

        return c.json({
            asset,
            events: formattedEvents,
            pagination: {
                limit,
                offset,
                count: formattedEvents.length
            }
        });
    } catch (error) {
        console.error("Error fetching reserve events:", error);
        return c.json({ error: "Failed to fetch reserve events" }, 500);
    }
});
//
// // Get user balance events for tracking deposit/withdrawal history
// app.get("/user/:address/balance-events/:asset", async (c) => {
//     const userAddress = c.req.param("address");
//     const asset = c.req.param("asset");
//     const limitParam = c.req.query("limit") || "50";
//     const offsetParam = c.req.query("offset") || "0";
//
//     if (!userAddress || !asset) {
//         return c.json({ error: "User address and asset are required" }, 400);
//     }
//
//     const limit = parseInt(limitParam);
//     const offset = parseInt(offsetParam);
//
//     if (isNaN(limit) || isNaN(offset) || limit < 1 || limit > 1000) {
//         return c.json({ error: "Invalid limit (1-1000) or offset" }, 400);
//     }
//
//     try {
//         const events = await db
//             .select()
//             .from(UserBalanceEvent)
//             .where(
//                 and(
//                     eq(UserBalanceEvent.user, userAddress as `0x${string}`),
//                     eq(UserBalanceEvent.asset, asset as `0x${string}`)
//                 )
//             )
//             .orderBy(desc(UserBalanceEvent.timestamp))
//             .limit(limit)
//             .offset(offset);
//
//         const formattedEvents = events.map(event => ({
//             id: event.id,
//             txHash: event.txHash,
//             user: event.user,
//             asset: event.asset,
//             scaledBalance: event.scaledBalance.toString(),
//             eventType: event.eventType,
//             timestamp: event.timestamp,
//             blockNumber: event.blockNumber.toString(),
//             liquidityIndex: event.liquidityIndex.toString(),
//             liquidityIndexFormatted: formatRayValue(event.liquidityIndex),
//             date: new Date(event.timestamp * 1000).toISOString()
//         }));
//
//         return c.json({
//             user: userAddress,
//             asset,
//             events: formattedEvents,
//             pagination: {
//                 limit,
//                 offset,
//                 count: formattedEvents.length
//             }
//         });
//     } catch (error) {
//         console.error("Error fetching user balance events:", error);
//         return c.json({ error: "Failed to fetch user balance events" }, 500);
//     }
// });

// Get reserve liquidity index at a specific timestamp
app.get("/api/reserves/:reserveAddress/liquidity-index", async (c) => {
    const reserveAddress = c.req.param("reserveAddress");
    const timestampParam = c.req.query("timestamp");

    if (!reserveAddress) {
        return c.json({ error: "Reserve address is required" }, 400);
    }

    // Validate reserve address format (basic hex address validation)
    if (!/^0x[a-fA-F0-9]{40}$/.test(reserveAddress)) {
        return c.json({
            error: "Invalid reserve address format",
            code: "INVALID_ADDRESS",
            reserveAddress
        }, 400);
    }

    try {
        // Parse timestamp or use current timestamp
        let timestamp: number;
        if (timestampParam) {
            timestamp = parseInt(timestampParam);
            if (isNaN(timestamp) || timestamp < 0) {
                return c.json({
                    error: "Invalid timestamp parameter",
                    code: "INVALID_TIMESTAMP"
                }, 400);
            }
        } else {
            timestamp = Math.floor(Date.now() / 1000);
        }

        const context = { db };
        const liquidityIndex = await calculateLiquidityIndexAtTimestamp(
            context,
            reserveAddress,
            timestamp
        );

        return c.json({
            reserveAddress,
            timestamp,
            liquidityIndex: liquidityIndex.toString(),
            liquidityIndexFormatted: formatRayValue(liquidityIndex),
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating liquidity index:", error);
        return c.json({
            error: "Failed to calculate liquidity index",
            code: "CALCULATION_ERROR",
            reserveAddress
        }, 500);
    }
});

// Custom health check endpoint
app.get("/custom-health", async (c) => {
    return c.json({ status: "ok", timestamp: Date.now() });
});

export default app;
