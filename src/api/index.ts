import {db} from "ponder:api";
import schema from "ponder:schema";
import {Hono} from "hono";
import {graphql} from "ponder";
import {
    calculateUserDailyYieldBreakdown,
    calculateUserDailyPortfolioValue,
} from "../helpers/yield/yieldReports";
import {
    calculateAllIsolatedPairPositions,
    calculateDailyIsolatedPairYields,
} from "../helpers/yield/isolatedPair";
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

// Get custom period yield data for a specific user and time range (core pool only)
// Uses comprehensive activity-based approach - shows ALL assets with activity during period
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
        const formattedAssets = positions.map(pos => ({
            asset: pos.asset,
            totalYieldEarned: pos.totalYieldEarned.toString(),
            totalBorrowCost: pos.totalBorrowCost.toString(),
            totalDeposited: pos.totalDeposited.toString(),
            totalWithdrawn: pos.totalWithdrawn.toString(),
            totalBorrowed: pos.totalBorrowed.toString(),
            totalRepaid: pos.totalRepaid.toString(),
            totalScaledDeposited: pos.totalScaledDeposited.toString(),
            totalScaledBorrowed: pos.totalScaledBorrowed.toString(),
            totalRawDeposited: pos.totalRawDeposited.toString(),
            totalRawBorrowed: pos.totalRawBorrowed.toString(),
            netDeposits: pos.netDeposits.toString(),
            netBorrows: pos.netBorrows.toString(),
            events: pos.events, // Already formatted with string amounts
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
                durationDays: seg.durationDays
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
                durationDays: seg.durationDays
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

// Get custom period yield data for isolated pairs only
// Uses comprehensive activity-based approach - shows ALL pairs with activity during period
app.get("/user/:address/custom-period-yield-isolated", async (c) => {
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

        console.log(`Starting isolated pair yield calculation for user ${userAddress} from ${fromTimestamp} to ${toTimestamp}`);

        // Use the simplified isolated yield calculation with detailed breakdowns
        const {calculateUserIsolatedYieldPositions} = await import("../helpers/yield/isolatedPair/positionCalculations");

        console.log("About to call calculateUserIsolatedYieldPositions...");
        const positions = await calculateUserIsolatedYieldPositions(context, userAddress, fromTimestamp, toTimestamp);
        console.log(`Calculation completed, found ${positions.length} positions`);

        if (positions.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                pairs: [],
                totalPairs: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Format the response data - only activity metrics, yield calculations, and detailed breakdowns
        const formattedPairs = positions.map((pos) => {
            return {
            pair: pos.pair,
            totalYieldEarned: pos.totalYieldEarned?.toString() ?? '0',
            totalBorrowCost: pos.totalBorrowCost?.toString() ?? '0',
            totalDeposited: pos.totalDeposited?.toString() ?? '0',
            totalWithdrawn: pos.totalWithdrawn?.toString() ?? '0',
            totalBorrowed: pos.totalBorrowed?.toString() ?? '0',
            totalRepaid: pos.totalRepaid?.toString() ?? '0',
            totalCollateralAdded: pos.totalCollateralAdded?.toString() ?? '0',
            totalCollateralRemoved: pos.totalCollateralRemoved?.toString() ?? '0',
            totalScaledDeposited: pos.totalScaledDeposited?.toString() ?? '0',
            totalScaledBorrowed: pos.totalScaledBorrowed?.toString() ?? '0',
            totalRawDeposited: pos.totalRawDeposited?.toString() ?? '0',
            totalRawBorrowed: pos.totalRawBorrowed?.toString() ?? '0',
            netDeposits: pos.netDeposits?.toString() ?? '0',
            netBorrows: pos.netBorrows?.toString() ?? '0',
            netCollateral: pos.netCollateral?.toString() ?? '0',
            events: pos.events ?? [], // Already formatted with string amounts
            events_before_period: pos.events_before_period ?? [], // Events that contributed to starting balances
            starting_balances: {
                collateral: pos.starting_balances?.collateral?.toString() ?? '0',
                deposits: pos.starting_balances?.deposits?.toString() ?? '0',
                borrows: pos.starting_balances?.borrows?.toString() ?? '0',
                scaledDeposits: pos.starting_balances?.scaledDeposits?.toString() ?? '0',
                scaledBorrows: pos.starting_balances?.scaledBorrows?.toString() ?? '0',
                rawDeposits: pos.starting_balances?.rawDeposits?.toString() ?? '0',
                rawBorrows: pos.starting_balances?.rawBorrows?.toString() ?? '0'
            },
            yieldSegments: (pos.yieldSegments ?? []).map((seg) => {
                if (!seg) {
                    console.error(`yieldSegment is null/undefined!`);
                    throw new Error(`yieldSegment is null/undefined`);
                }
                return {
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    startDate: seg.startDate,
                    endDate: seg.endDate,
                    assetShares: seg.assetShares?.toString() ?? '0',
                    actualAssetAmount: seg.actualAssetAmount?.toString() ?? '0',
                    startExchangeRate: seg.startExchangeRate?.toString() ?? '0',
                    endExchangeRate: seg.endExchangeRate?.toString() ?? '0',
                    segmentYield: seg.segmentYield?.toString() ?? '0',
                    durationDays: seg.durationDays ?? 0
                };
            }),
            borrowCostSegments: (pos.borrowCostSegments ?? []).map((seg) => {
                if (!seg) {
                    console.error(`borrowCostSegment is null/undefined!`);
                    throw new Error(`borrowCostSegment is null/undefined`);
                }
                return {
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    startDate: seg.startDate,
                    endDate: seg.endDate,
                    borrowShares: seg.borrowShares?.toString() ?? '0',
                    actualBorrowAmount: seg.actualBorrowAmount?.toString() ?? '0',
                    startExchangeRate: seg.startExchangeRate?.toString() ?? '0',
                    endExchangeRate: seg.endExchangeRate?.toString() ?? '0',
                    segmentBorrowCost: seg.segmentBorrowCost?.toString() ?? '0',
                    durationDays: seg.durationDays ?? 0
                };
            })
        };
        });

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            pairs: formattedPairs,
            totalPairs: formattedPairs.length,
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating isolated pair yield:", error);
        // @ts-ignore
        console.error("Error details:", error.message);
        return c.json({
            error: "Failed to calculate isolated pair yield data",
            // @ts-ignore
            details: error.message,
            user: userAddress,
            fromTimestamp,
            toTimestamp
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
                note: "To calculate total yield in USD, sum (assetYield / 10^decimals * price) for each asset using current oracle prices"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = yieldData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                assetYield: asset.assetYield.toString(),
                borrowCost: asset.borrowCost.toString(),
                netYield: asset.netYield.toString(),
                segments: asset.segments, // Already converted to strings in the helper function
                borrowSegments: asset.borrowSegments // Already converted to strings in the helper function
            }))
        }));

        // Serialize current value if present
        const serializedCurrentValue = yieldData.currentValue ? {
            date: yieldData.currentValue.date,
            timestamp: yieldData.currentValue.timestamp,
            isPartialDay: yieldData.currentValue.isPartialDay,
            assets: yieldData.currentValue.assets.map(asset => ({
                asset: asset.asset,
                assetYield: asset.assetYield.toString(),
                borrowCost: asset.borrowCost.toString(),
                netYield: asset.netYield.toString(),
                segments: asset.segments, // Already converted to strings in the helper function
                borrowSegments: asset.borrowSegments // Already converted to strings in the helper function
            }))
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyBreakdown: serializedBreakdown,
            currentValue: serializedCurrentValue,
            summary: {
                totalDaysInPeriod: yieldData.dailyValues.length,
                hasPartialDay: !!yieldData.currentValue
            },
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "To calculate total yield in USD, sum (assetYield / 10^decimals * price) for each asset using current oracle prices"
        });

    } catch (error) {
        console.error("Error calculating daily yield breakdown:", error);
        return c.json({error: "Failed to calculate daily yield breakdown"}, 500);
    }
});

// Get daily yield breakdown for isolated pairs only
app.get("/user/:address/daily-yield-breakdown-isolated", async (c) => {
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

        // Clear exchange rate cache for this request to prevent stale data
        const {clearExchangeRateCache} = await import("../helpers/yield/isolatedPair/exchangeRate");
        clearExchangeRateCache();

        // Calculate daily yield for isolated pairs
        const yieldData = await calculateDailyIsolatedPairYields(context, userAddress, fromTimestamp, toTimestamp);

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
                message: "No isolated pair positions found for this user during the specified period",
                note: "To calculate total yield in USD, sum (assetYield / 10^decimals * price) for each asset using current oracle prices"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = yieldData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowCost: pair.borrowCost.toString(),
                netYield: pair.netYield.toString()
            }))
        }));

        // Serialize current value if present
        const serializedCurrentValue = yieldData.currentValue ? {
            date: yieldData.currentValue.date,
            timestamp: yieldData.currentValue.timestamp,
            isPartialDay: yieldData.currentValue.isPartialDay,
            pairs: yieldData.currentValue.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowCost: pair.borrowCost.toString(),
                netYield: pair.netYield.toString()
            }))
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyBreakdown: serializedBreakdown,
            currentValue: serializedCurrentValue,
            summary: {
                totalDaysInPeriod: yieldData.dailyValues.length,
                hasPartialDay: !!yieldData.currentValue
            },
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "IMPORTANT: assetYield and borrowCost can be NEGATIVE. They represent value changes: assetYield = change in deposit value (can be negative if exchange rate drops), borrowCost = change in debt value (can be negative if debt shrinks, which is a gain). netYield = assetYield - borrowCost. To calculate in USD: sum ((assetYield - borrowCost) / 10^decimals * price) for each pair."
        });

    } catch (error) {
        console.error("Error calculating isolated pair daily yield breakdown:", error);
        return c.json({error: "Failed to calculate isolated pair daily yield breakdown"}, 500);
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
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                borrowed: asset.borrowed.toString(),
                netPosition: asset.netPosition.toString()
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
            note: "Portfolio values represent actual balances (including accrued interest/yield) at the START of each day (midnight UTC). To calculate total portfolio value in USD, sum ((supplied - borrowed) / 10^decimals * price) for each asset using current oracle prices."
        });

    } catch (error) {
        console.error("Error calculating daily portfolio values:", error);
        return c.json({error: "Failed to calculate daily portfolio values"}, 500);
    }
});

// Get daily portfolio values for isolated pairs only
app.get("/user/:address/daily-portfolio-value-isolated", async (c) => {
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

        // Clear exchange rate cache for this request to prevent stale data
        const {clearExchangeRateCache} = await import("../helpers/yield/isolatedPair/exchangeRate");
        clearExchangeRateCache();

        // Calculate isolated pair positions for each complete day
        const dailyIsolatedPairs: Array<{
            date: string;
            timestamp: number;
            pairs: Array<any>;
        }> = [];

        // Generate daily timestamps (only complete days at midnight UTC)
        const oneDaySeconds = 24 * 60 * 60;

        // Calculate the start of each day in the range
        const startDate = new Date(fromTimestamp * 1000);
        const endDate = new Date(toTimestamp * 1000);

        // Get the start of the first day (midnight UTC)
        const firstDayStart = Math.floor(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) / 1000);

        // Get the start of the last day (midnight UTC)
        const lastDayStart = Math.floor(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) / 1000);

        // Generate portfolio values for each day at midnight UTC
        for (let ts = firstDayStart; ts <= lastDayStart; ts += oneDaySeconds) {
            const positions = await calculateAllIsolatedPairPositions(context, userAddress, ts, fromTimestamp);

            dailyIsolatedPairs.push({
                date: new Date(ts * 1000).toISOString().split('T')[0]!,
                timestamp: ts,
                pairs: positions.map(pos => ({
                    pair: pos.pair,
                    collateralAmount: pos.collateralAmount.toString(),
                    assetAmount: pos.assetAmount.toString(),
                    borrowAmount: pos.borrowAmount.toString()
                }))
            });
        }

        if (dailyIsolatedPairs.length === 0) {
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
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: dailyIsolatedPairs.length,
            dailyPortfolioValues: dailyIsolatedPairs,
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "Portfolio values represent actual balances (including accrued interest/yield) at the START of each day (midnight UTC). To calculate total portfolio value in USD, sum ((collateralAmount + assetAmount - borrowAmount) / 10^decimals * price) for each pair using current oracle prices."
        });

    } catch (error) {
        console.error("Error calculating isolated pair daily portfolio values:", error);
        return c.json({error: "Failed to calculate isolated pair daily portfolio values"}, 500);
    }
});

export default app;
