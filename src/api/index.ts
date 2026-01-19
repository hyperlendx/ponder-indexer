import {db} from "ponder:api";
import schema from "ponder:schema";
import {Hono} from "hono";
import {graphql, eq, and, desc} from "ponder";
import {
    calculateUserDailyYieldBreakdown,
    calculateUserDailyPortfolioValue,
} from "../helpers/yield/yieldReports";
import {
    calculateAllIsolatedPairPositions,
    calculateDailyIsolatedPairYields,
    calculateUserDailyIsolatedPairPortfolioValue,
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
            // USD values (pre-calculated in calculateUserIsolatedYieldPositions)
            totalYieldEarnedUSD: pos.totalYieldEarnedUSD ?? '0.00',
            totalBorrowCostUSD: pos.totalBorrowCostUSD ?? '0.00',
            totalDepositedUSD: pos.totalDepositedUSD ?? '0.00',
            totalWithdrawnUSD: pos.totalWithdrawnUSD ?? '0.00',
            totalBorrowedUSD: pos.totalBorrowedUSD ?? '0.00',
            totalRepaidUSD: pos.totalRepaidUSD ?? '0.00',
            totalCollateralAddedUSD: pos.totalCollateralAddedUSD ?? '0.00',
            totalCollateralRemovedUSD: pos.totalCollateralRemovedUSD ?? '0.00',
            totalRawDepositedUSD: pos.totalRawDepositedUSD ?? '0.00',
            totalRawBorrowedUSD: pos.totalRawBorrowedUSD ?? '0.00',
            totalScaledDepositedUSD: pos.totalScaledDepositedUSD ?? '0.00',
            totalScaledBorrowedUSD: pos.totalScaledBorrowedUSD ?? '0.00',
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
                    segmentYieldUSD: seg.segmentYieldUSD ?? '0.00', // USD value for this segment
                    durationDays: seg.durationDays ?? 0,
                    assetAddress: seg.assetAddress ?? '', // Asset token address
                    assetPrice: seg.assetPrice ?? '0', // Asset price during this segment
                    assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
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
                    segmentBorrowCostUSD: seg.segmentBorrowCostUSD ?? '0.00', // USD value for this segment
                    durationDays: seg.durationDays ?? 0,
                    assetAddress: seg.assetAddress ?? '', // Asset token address
                    assetPrice: seg.assetPrice ?? '0', // Asset price during this segment
                    assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
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

        if (yieldData.dailyValues.length === 0) {
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
                summary: {
                    totalDaysInPeriod: expectedDays
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period",
                note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = yieldData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            dailyYield: day.dailyYield.toString(),
            assetYieldUSD: day.assetYieldUSD,
            borrowCostUSD: day.borrowCostUSD,
            netYieldUSD: day.netYieldUSD,
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                assetAddress: pair.assetAddress,
                assetPrice: pair.assetPrice,
                assetPriceTimestamp: pair.assetPriceTimestamp,
                assetYield: pair.assetYield.toString(),
                borrowCost: pair.borrowCost.toString(),
                netYield: pair.netYield.toString(),
                assetYieldUSD: pair.assetYieldUSD,
                borrowCostUSD: pair.borrowCostUSD,
                netYieldUSD: pair.netYieldUSD
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
            note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places. IMPORTANT: assetYield and borrowCost can be NEGATIVE. They represent value changes: assetYield = change in deposit value (can be negative if exchange rate drops), borrowCost = change in debt value (can be negative if debt shrinks, which is a gain). netYield = assetYield - borrowCost."
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

        // Calculate daily portfolio values for isolated pairs
        const portfolioData = await calculateUserDailyIsolatedPairPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        if (portfolioData.dailyValues.length === 0) {
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
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                collateralAddress: pair.collateralAddress,
                assetAddress: pair.assetAddress,
                collateralAmount: pair.collateralAmount.toString(),
                assetAmount: pair.assetAmount.toString(),
                borrowAmount: pair.borrowAmount.toString(),
                netPosition: pair.netPosition.toString(),
                collateralUSD: pair.collateralUSD,
                assetUSD: pair.assetUSD,
                borrowedUSD: pair.borrowedUSD,
                netPositionUSD: pair.netPositionUSD,
                collateralPrice: pair.collateralPrice, // Collateral USD price from Chainlink (8 decimals)
                collateralPriceTimestamp: pair.collateralPriceTimestamp, // Timestamp when the collateral price was recorded
                assetPrice: pair.assetPrice, // Asset USD price from Chainlink (8 decimals)
                assetPriceTimestamp: pair.assetPriceTimestamp // Timestamp when the asset price was recorded
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
        console.error("Error calculating isolated pair daily portfolio values:", error);
        return c.json({error: "Failed to calculate isolated pair daily portfolio values"}, 500);
    }
});

// Get kHYPE staking yield for a user over a custom time period
// kHYPE is Kinetiq's liquid staking token - exchange rate changes on reward/slashing events
app.get("/user/:address/custom-period-yield-khype", async (c) => {
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

        const { calculateKHYPECustomPeriodYield } = await import("../helpers/kHYPE/yieldCalculations");
        const result = await calculateKHYPECustomPeriodYield(context, userAddress, fromTimestamp, toTimestamp);

        return c.json({
            user: result.user,
            asset: result.asset,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: new Date(result.fromTimestamp * 1000).toISOString(),
            toDate: new Date(result.toTimestamp * 1000).toISOString(),
            days: Math.round((result.toTimestamp - result.fromTimestamp) / (24 * 60 * 60) * 100) / 100,

            // Yield earned from exchange rate appreciation (staking rewards)
            totalYieldEarned: result.totalYieldEarned,
            totalYieldEarnedUSD: result.totalYieldEarnedUSD,

            // Detailed breakdown by segment
            yieldSegments: result.yieldSegments,

            calculatedAt: Math.floor(Date.now() / 1000),
            note: "This endpoint returns ONLY the staking yield from kHYPE exchange rate appreciation. Use /custom-period-yield for deposit/withdraw/borrow/repay activity and borrow costs. Add this yield to the kHYPE asset from that endpoint.",
        });

    } catch (error) {
        console.error("Error calculating kHYPE custom period yield:", error);
        return c.json({
            error: "Failed to calculate kHYPE custom period yield data",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// Get kHYPE daily yield breakdown for a user over a time period
// Breaks down yield into complete 24-hour UTC days (midnight to midnight)
app.get("/user/:address/daily-yield-breakdown-khype", async (c) => {
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

        const { calculateKHYPEDailyYieldBreakdown } = await import("../helpers/kHYPE/yieldCalculations");
        const result = await calculateKHYPEDailyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        // kHYPE token address for easy mapping to core pool response
        const KHYPE_TOKEN_ADDRESS = "0xB4E0dB23D8573990bF0A89e4a438B5b8E3f4f5E6".toLowerCase();

        return c.json({
            user: result.user,
            asset: KHYPE_TOKEN_ADDRESS,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: result.fromDate,
            toDate: result.toDate,
            days: result.dailyBreakdown.length,

            // Yield earned from exchange rate appreciation (staking rewards)
            totalYieldEarned: result.totalYieldEarned,
            totalYieldEarnedUSD: result.totalYieldEarnedUSD,

            // Daily breakdown
            dailyBreakdown: result.dailyBreakdown,

            calculatedAt: Math.floor(Date.now() / 1000),
            note: "This endpoint returns ONLY the daily staking yield from kHYPE exchange rate appreciation. Use /custom-period-yield for deposit/withdraw/borrow/repay activity and borrow costs. Add this yield to the kHYPE asset from that endpoint.",
        });

    } catch (error) {
        console.error("Error calculating kHYPE daily yield breakdown:", error);
        return c.json({
            error: "Failed to calculate kHYPE daily yield breakdown",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// Get daily portfolio values for kHYPE holdings
// Portfolio Value = kHYPE balance × exchange rate (in HYPE and USD)
app.get("/user/:address/daily-portfolio-value-khype", async (c) => {
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

        const { calculateKHYPEDailyPortfolioValue } = await import("../helpers/kHYPE/yieldCalculations");
        const result = await calculateKHYPEDailyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        // kHYPE token address for easy mapping to core pool response
        const KHYPE_TOKEN_ADDRESS = "0xB4E0dB23D8573990bF0A89e4a438B5b8E3f4f5E6".toLowerCase();

        if (result.dailyPortfolioValues.length === 0) {
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                asset: KHYPE_TOKEN_ADDRESS,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: expectedDays,
                dailyPortfolioValues: [],
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No kHYPE positions found for this user during the specified period"
            });
        }

        return c.json({
            user: result.user,
            asset: KHYPE_TOKEN_ADDRESS,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: result.fromDate,
            toDate: result.toDate,
            days: result.days,
            dailyPortfolioValues: result.dailyPortfolioValues,
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "Portfolio values represent kHYPE holdings at the END of each day (23:59:59 UTC). USD values are calculated using HYPE oracle prices. For partial days (current day), values are calculated at the toTimestamp."
        });

    } catch (error) {
        console.error("Error calculating kHYPE daily portfolio values:", error);
        return c.json({
            error: "Failed to calculate kHYPE daily portfolio values",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// ============================================================================
// beHYPE (Hyperlend Liquid Staking) Endpoints
// beHYPE is Hyperlend's liquid staking token - exchange rate changes via ExchangeRatioUpdated events (~2x/day)
// ============================================================================

// Get beHYPE staking yield for a user over a custom time period
app.get("/user/:address/custom-period-yield-behype", async (c) => {
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

        const { calculateBeHYPECustomPeriodYield } = await import("../helpers/beHYPE/yieldCalculations");
        const result = await calculateBeHYPECustomPeriodYield(context, userAddress, fromTimestamp, toTimestamp);

        return c.json({
            user: result.user,
            asset: result.asset,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: new Date(result.fromTimestamp * 1000).toISOString(),
            toDate: new Date(result.toTimestamp * 1000).toISOString(),

            // Yield earned from exchange rate appreciation (staking rewards)
            totalYieldEarned: result.totalYieldEarned,
            totalYieldEarnedUSD: result.totalYieldEarnedUSD,

            // Detailed breakdown by segment
            yieldSegments: result.yieldSegments,

            calculatedAt: Math.floor(Date.now() / 1000),
            note: "This endpoint returns ONLY the staking yield from beHYPE exchange rate appreciation. Use /custom-period-yield for deposit/withdraw/borrow/repay activity and borrow costs. Add this yield to the beHYPE asset from that endpoint.",
        });

    } catch (error) {
        console.error("Error calculating beHYPE custom period yield:", error);
        return c.json({
            error: "Failed to calculate beHYPE custom period yield data",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// Get daily portfolio values for beHYPE holdings
// Portfolio Value = beHYPE balance × exchange rate (in HYPE and USD)
app.get("/user/:address/daily-portfolio-value-behype", async (c) => {
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

        const { calculateBeHYPEDailyPortfolioValue } = await import("../helpers/beHYPE/yieldCalculations");
        const result = await calculateBeHYPEDailyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        // beHYPE token address for easy mapping to core pool response
        const BEHYPE_TOKEN_ADDRESS = "0xd8FC8F0b03eBA61F64D08B0bef69d80916E5DdA9".toLowerCase();

        if (result.dailyPortfolioValues.length === 0) {
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                asset: BEHYPE_TOKEN_ADDRESS,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: expectedDays,
                dailyPortfolioValues: [],
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No beHYPE pool positions found for this user during the specified period"
            });
        }

        return c.json({
            user: result.user,
            asset: BEHYPE_TOKEN_ADDRESS,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: result.fromDate,
            toDate: result.toDate,
            days: result.days,
            dailyPortfolioValues: result.dailyPortfolioValues,
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "Portfolio values represent beHYPE pool positions (supplied to HyperLend) at the END of each day (23:59:59 UTC). USD values are calculated using HYPE oracle prices. For partial days (current day), values are calculated at the toTimestamp."
        });

    } catch (error) {
        console.error("Error calculating beHYPE daily portfolio values:", error);
        return c.json({
            error: "Failed to calculate beHYPE daily portfolio values",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// Get beHYPE daily yield breakdown for a user over a time period
// Breaks down yield into complete 24-hour UTC days (midnight to midnight)
app.get("/user/:address/daily-yield-breakdown-behype", async (c) => {
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

        const { calculateBeHYPEDailyYieldBreakdown } = await import("../helpers/beHYPE/yieldCalculations");
        const result = await calculateBeHYPEDailyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        // beHYPE token address for easy mapping to core pool response
        const BEHYPE_TOKEN_ADDRESS = "0xd8FC8F0b03eBA61F64D08B0bef69d80916E5DdA9".toLowerCase();

        return c.json({
            user: result.user,
            asset: BEHYPE_TOKEN_ADDRESS,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: result.fromDate,
            toDate: result.toDate,
            days: result.dailyBreakdown.length,

            // Yield earned from exchange rate appreciation (staking rewards)
            totalYieldEarned: result.totalYieldEarned,
            totalYieldEarnedUSD: result.totalYieldEarnedUSD,

            // Daily breakdown
            dailyBreakdown: result.dailyBreakdown,

            calculatedAt: Math.floor(Date.now() / 1000),
            note: "This endpoint returns ONLY the daily staking yield from beHYPE exchange rate appreciation. Use /custom-period-yield for deposit/withdraw/borrow/repay activity and borrow costs. Add this yield to the beHYPE asset from that endpoint.",
        });

    } catch (error) {
        console.error("Error calculating beHYPE daily yield breakdown:", error);
        return c.json({
            error: "Failed to calculate beHYPE daily yield breakdown",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// ============================================================================
// wstHYPE (Wrapped stHYPE) Endpoints
// wstHYPE is a non-rebasing wrapper for stHYPE - balance stays constant but value
// increases via assetsPerShare exchange rate on Rebase events.
// NOTE: Unlike kHYPE/beHYPE which track pool positions, wstHYPE tracks WALLET balances
// because wstHYPE is held directly in wallets, not supplied to HyperLend pool.
// ============================================================================

// Get wstHYPE staking yield for a user over a custom time period
app.get("/user/:address/custom-period-yield-wsthype", async (c) => {
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

        const { calculateWstHYPECustomPeriodYield } = await import("../helpers/wstHYPE/yieldCalculations");
        const result = await calculateWstHYPECustomPeriodYield(context, userAddress, fromTimestamp, toTimestamp);

        return c.json({
            user: result.user,
            asset: result.asset,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: new Date(result.fromTimestamp * 1000).toISOString(),
            toDate: new Date(result.toTimestamp * 1000).toISOString(),

            // Yield earned from exchange rate appreciation (staking rewards)
            totalYieldEarned: result.totalYieldEarned,
            totalYieldEarnedUSD: result.totalYieldEarnedUSD,

            // Detailed breakdown by segment
            yieldSegments: result.yieldSegments,

            calculatedAt: Math.floor(Date.now() / 1000),
            note: "This endpoint returns the staking yield from wstHYPE exchange rate appreciation. wstHYPE is a non-rebasing wrapper for stHYPE - balance stays constant but value increases via assetsPerShare exchange rate. Unlike kHYPE/beHYPE, this tracks WALLET balances (not pool positions).",
        });

    } catch (error) {
        console.error("Error calculating wstHYPE custom period yield:", error);
        return c.json({
            error: "Failed to calculate wstHYPE custom period yield data",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// Get wstHYPE daily yield breakdown for a user over a time period
// Breaks down yield into complete 24-hour UTC days (midnight to midnight)
app.get("/user/:address/daily-yield-breakdown-wsthype", async (c) => {
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

        const { calculateWstHYPEDailyYieldBreakdown } = await import("../helpers/wstHYPE/yieldCalculations");
        const result = await calculateWstHYPEDailyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        // wstHYPE token address for easy mapping
        const WSTHYPE_TOKEN_ADDRESS = "0x94e8396e0869c9F2200760aF63c94A00F2a0dB9D".toLowerCase();

        return c.json({
            user: result.user,
            asset: WSTHYPE_TOKEN_ADDRESS,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: result.fromDate,
            toDate: result.toDate,
            days: result.dailyBreakdown.length,

            // Yield earned from exchange rate appreciation (staking rewards)
            totalYieldEarned: result.totalYieldEarned,
            totalYieldEarnedUSD: result.totalYieldEarnedUSD,

            // Daily breakdown
            dailyBreakdown: result.dailyBreakdown,

            calculatedAt: Math.floor(Date.now() / 1000),
            note: "This endpoint returns the daily staking yield from wstHYPE exchange rate appreciation. wstHYPE is a non-rebasing wrapper for stHYPE - balance stays constant but value increases via assetsPerShare exchange rate. Unlike kHYPE/beHYPE, this tracks WALLET balances (not pool positions).",
        });

    } catch (error) {
        console.error("Error calculating wstHYPE daily yield breakdown:", error);
        return c.json({
            error: "Failed to calculate wstHYPE daily yield breakdown",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

// Get daily portfolio values for wstHYPE holdings
// Portfolio Value = wstHYPE balance × exchange rate (in HYPE and USD)
app.get("/user/:address/daily-portfolio-value-wsthype", async (c) => {
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

        const { calculateWstHYPEDailyPortfolioValue } = await import("../helpers/wstHYPE/yieldCalculations");
        const result = await calculateWstHYPEDailyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        // wstHYPE token address for easy mapping
        const WSTHYPE_TOKEN_ADDRESS = "0x94e8396e0869c9F2200760aF63c94A00F2a0dB9D".toLowerCase();

        if (result.dailyPortfolioValues.length === 0) {
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                asset: WSTHYPE_TOKEN_ADDRESS,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: expectedDays,
                dailyPortfolioValues: [],
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No wstHYPE wallet holdings found for this user during the specified period"
            });
        }

        return c.json({
            user: result.user,
            asset: WSTHYPE_TOKEN_ADDRESS,
            fromTimestamp: result.fromTimestamp,
            toTimestamp: result.toTimestamp,
            fromDate: result.fromDate,
            toDate: result.toDate,
            days: result.days,
            dailyPortfolioValues: result.dailyPortfolioValues,
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "Portfolio values represent wstHYPE WALLET holdings at the END of each day (23:59:59 UTC). USD values are calculated using HYPE oracle prices. Unlike kHYPE/beHYPE, this tracks wallet balances (not pool positions)."
        });

    } catch (error) {
        console.error("Error calculating wstHYPE daily portfolio values:", error);
        return c.json({
            error: "Failed to calculate wstHYPE daily portfolio values",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

export default app;
