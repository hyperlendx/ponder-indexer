import {db} from "ponder:api";
import schema from "ponder:schema";
import {Hono} from "hono";
import {graphql, eq, and, desc} from "ponder";
import {
    calculateUserDailyYieldBreakdown,
    calculateUserDailyPortfolioValue,
} from "../helpers/yield/yieldReports";
import {cors} from 'hono/cors'

const app = new Hono();

//fix CORS
app.use('/*', cors({
    origin: '*',
    allowHeaders: ['Origin', 'Content-Type', 'Accept', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: false, // Must be false when using wildcard '*'
}))

// Add GraphQL endpoint
app.use("/", graphql({db, schema}));
app.use("/graphql", graphql({db, schema}));

// Get custom period yield data for a specific user and time range (core pool, USDC reserve only)
// Uses comprehensive activity-based approach - only USDC is indexed, so at most one asset is returned
app.get("/user/:address/custom-period-yield", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 2 years)
    const maxPeriodSeconds = 2 * 365 * 24 * 60 * 60; // 2 years
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 2 years"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Use the simplified yield calculation with detailed breakdowns
        const {calculateUserYieldPositions} = await import("../helpers/yield/positionCalculations");
        const positions = await calculateUserYieldPositions(context, userAddress, fromTimestamp, toTimestamp);

        if (positions.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                assets: [],
                totalAssets: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Format the response data - only activity metrics, yield calculations, and detailed breakdowns
        // USD values are already calculated in calculateUserYieldPositions
        const formattedAssets = positions.map(pos => ({
            asset: pos.asset,
            totalYieldEarned: pos.totalYieldEarned.toString(),
            totalBorrowCost: pos.totalBorrowCost.toString(),
            totalDeposited: pos.totalDeposited.toString(),
            totalWithdrawn: pos.totalWithdrawn.toString(),
            totalBorrowed: pos.totalBorrowed.toString(),
            totalRepaid: pos.totalRepaid.toString(),
            // USD values (pre-calculated in calculateUserYieldPositions)
            totalYieldEarnedUSD: pos.totalYieldEarnedUSD,
            totalBorrowCostUSD: pos.totalBorrowCostUSD,
            totalDepositedUSD: pos.totalDepositedUSD,
            totalWithdrawnUSD: pos.totalWithdrawnUSD,
            totalBorrowedUSD: pos.totalBorrowedUSD,
            totalRepaidUSD: pos.totalRepaidUSD,
            totalRawDepositedUSD: pos.totalRawDepositedUSD,
            totalRawBorrowedUSD: pos.totalRawBorrowedUSD,
            totalScaledDepositedUSD: pos.totalScaledDepositedUSD,
            totalScaledBorrowedUSD: pos.totalScaledBorrowedUSD,
            // Other fields
            totalScaledDeposited: pos.totalScaledDeposited.toString(),
            totalScaledBorrowed: pos.totalScaledBorrowed.toString(),
            totalRawDeposited: pos.totalRawDeposited.toString(),
            totalRawBorrowed: pos.totalRawBorrowed.toString(),
            netDeposits: pos.netDeposits.toString(),
            netBorrows: pos.netBorrows.toString(),
            events: pos.events, // Already formatted with string amounts and assetPrice
            events_before_period: pos.events_before_period, // Events that contributed to starting balances
            starting_balances: {
                deposits: pos.starting_balances.deposits.toString(),
                borrows: pos.starting_balances.borrows.toString(),
                scaledDeposits: pos.starting_balances.scaledDeposits.toString(),
                scaledBorrows: pos.starting_balances.scaledBorrows.toString(),
                rawDeposits: pos.starting_balances.rawDeposits.toString(),
                rawBorrows: pos.starting_balances.rawBorrows.toString()
            },
            yieldSegments: pos.yieldSegments.map(seg => ({
                startTime: seg.startTime,
                endTime: seg.endTime,
                startDate: seg.startDate,
                endDate: seg.endDate,
                scaledBalance: seg.scaledBalance.toString(),
                actualBalance: seg.actualBalance.toString(),
                startLiquidityIndex: seg.startLiquidityIndex.toString(),
                endLiquidityIndex: seg.endLiquidityIndex.toString(),
                segmentYield: seg.segmentYield.toString(),
                segmentYieldUSD: seg.segmentYieldUSD, // USD value for this segment
                durationDays: seg.durationDays,
                assetPrice: seg.assetPrice, // Asset price during this segment
                assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
            })),
            borrowCostSegments: pos.borrowCostSegments.map(seg => ({
                startTime: seg.startTime,
                endTime: seg.endTime,
                startDate: seg.startDate,
                endDate: seg.endDate,
                scaledBorrowBalance: seg.scaledBorrowBalance.toString(),
                actualBorrowBalance: seg.actualBorrowBalance.toString(),
                startBorrowIndex: seg.startBorrowIndex.toString(),
                endBorrowIndex: seg.endBorrowIndex.toString(),
                segmentBorrowCost: seg.segmentBorrowCost.toString(),
                segmentBorrowCostUSD: seg.segmentBorrowCostUSD, // USD value for this segment
                durationDays: seg.durationDays,
                assetPrice: seg.assetPrice, // Asset price during this segment
                assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            assets: formattedAssets,
            totalAssets: formattedAssets.length,
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating custom period yield:", error);
        return c.json({
            error: "Failed to calculate custom period yield data",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});


// Get daily yield breakdown for a specific user over a custom time period
app.get("/user/:address/daily-yield-breakdown", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 1 year for daily breakdown)
    const maxPeriodSeconds = 365 * 24 * 60 * 60; // 1 year
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 1 year for daily breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate daily yield breakdown for regular pool only
        const yieldData = await calculateUserDailyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        // Note: yieldData.dailyValues now includes all days in the period (including zero-yield days)
        // Only return empty response if no data could be calculated at all (e.g., no assets found)
        if (yieldData.dailyValues.length === 0 && !yieldData.currentValue) {
            // Calculate expected number of days for empty response
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                dailyBreakdown: [],
                currentValue: null,
                summary: {
                    totalDaysInPeriod: expectedDays,
                    hasPartialDay: false
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period",
                note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = yieldData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            assetYield: day.assetYield.toString(),
            borrowCost: day.borrowCost.toString(),
            netYield: day.netYield.toString(),
            assetYieldUSD: day.assetYieldUSD,
            borrowCostUSD: day.borrowCostUSD,
            netYieldUSD: day.netYieldUSD,
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                assetPrice: asset.assetPrice,
                assetPriceTimestamp: asset.assetPriceTimestamp,
                assetYield: asset.assetYield.toString(),
                borrowCost: asset.borrowCost.toString(),
                netYield: asset.netYield.toString(),
                assetYieldUSD: asset.assetYieldUSD,
                borrowCostUSD: asset.borrowCostUSD,
                netYieldUSD: asset.netYieldUSD,
                segments: asset.segments, // Already converted to strings in the helper function
                borrowSegments: asset.borrowSegments // Already converted to strings in the helper function
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyBreakdown: serializedBreakdown,
            summary: {
                totalDaysInPeriod: yieldData.dailyValues.length
            },
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places"
        });

    } catch (error) {
        console.error("Error calculating daily yield breakdown:", error);
        return c.json({error: "Failed to calculate daily yield breakdown"}, 500);
    }
});

// Get daily portfolio values for a specific user over a custom time period
// Portfolio Value = Total Supplied - Total Borrowed
app.get("/user/:address/daily-portfolio-value", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 1 year for daily breakdown)
    const maxPeriodSeconds = 365 * 24 * 60 * 60; // 1 year
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 1 year for daily breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate daily portfolio values for regular pool only
        const portfolioData = await calculateUserDailyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        if (portfolioData.dailyValues.length === 0) {
            // Calculate expected number of days for empty response
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: expectedDays,
                dailyPortfolioValues: [],
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedPortfolio = portfolioData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            portfolioValue: day.portfolioValue.toString(),
            totalSupplied: day.totalSupplied.toString(),
            totalBorrowed: day.totalBorrowed.toString(),
            portfolioValueUSD: day.portfolioValueUSD,
            totalSuppliedUSD: day.totalSuppliedUSD,
            totalBorrowedUSD: day.totalBorrowedUSD,
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                borrowed: asset.borrowed.toString(),
                netPosition: asset.netPosition.toString(),
                suppliedUSD: asset.suppliedUSD,
                borrowedUSD: asset.borrowedUSD,
                netPositionUSD: asset.netPositionUSD,
                assetPrice: asset.assetPrice, // Oracle price used for USD calculations (8 decimals)
                assetPriceTimestamp: asset.assetPriceTimestamp // Timestamp when the price was recorded
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: portfolioData.dailyValues.length,
            dailyPortfolioValues: serializedPortfolio,
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places. Portfolio values represent actual balances (including accrued interest/yield) at the END of each day (23:59:59 UTC)."
        });

    } catch (error) {
        console.error("Error calculating daily portfolio values:", error);
        return c.json({error: "Failed to calculate daily portfolio values"}, 500);
    }
});

export default app;
