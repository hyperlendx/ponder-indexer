import { OracleAbi } from "../../abis/OracleAbi";
import { IsolatedAbi } from "../../abis/IsolatedAbi";
import { IsolatedPairOracleAbi } from "../../abis/IsolatedPairOracleAbi";
import { UiDataProviderIsolatedAbi } from "../../abis/UiDataProviderIsolatedAbi";
import { ChainlinkAggregatorAbi } from "../../abis/ChainlinkAggregatorAbi";
import { AssetPriceSnapshot, IsolatedPairPriceSnapshot } from "ponder:schema";
import { eq, and, lte, gte, desc } from "ponder";

import config from "../../ponder.config";

/**
 * Result type for isolated pair asset info with USD prices
 */
export interface IsolatedPairAssetInfo {
    assetAddress: `0x${string}` | null;
    collateralAddress: `0x${string}` | null;
    assetPrice: bigint | null;
    collateralPrice: bigint | null;
}

/**
 * Cached metadata for isolated pairs (addresses and oracle info don't change)
 */
interface IsolatedPairMetadataCache {
    assetAddress: `0x${string}`;
    collateralAddress: `0x${string}`;
    chainlinkAssetOracle: `0x${string}` | null;
    chainlinkCollateralOracle: `0x${string}` | null;
}

// Cache for pair metadata - this data doesn't change for a given pair
const isolatedPairMetadataCache: Map<string, IsolatedPairMetadataCache> = new Map();

/**
 * Get asset and collateral addresses with their USD prices from Chainlink oracles for an isolated pair
 * Metadata (addresses, oracle addresses) is cached since it doesn't change.
 * Prices are fetched fresh each time.
 *
 * @param context - Ponder context with client
 * @param event - Ponder event
 * @param pair - Isolated pair address
 * @returns Asset info including addresses and USD prices (8 decimals precision)
 */
export async function getIsolatedPairAssetInfo(context: any, event: any, pair: string): Promise<IsolatedPairAssetInfo> {
    const result: IsolatedPairAssetInfo = {
        assetAddress: null,
        collateralAddress: null,
        assetPrice: null,
        collateralPrice: null
    };

    // Skip if block is before pair was deployed. Only fetch prices after the first isolated tx.
    if(event.block.number < 7350443){
        return result;
    }


    const normalizedPair = pair.toLowerCase();
    const zeroAddr = "0x0000000000000000000000000000000000000000";

    try {
        // Check cache first for metadata
        let metadata = isolatedPairMetadataCache.get(normalizedPair);

        if (!metadata) {
            // Fetch and cache metadata
            const uiDataProviderAddress = config.contracts.UiDataProviderIsolated.address as `0x${string}`;

            const pairData = await context.client.readContract({
                abi: UiDataProviderIsolatedAbi,
                address: uiDataProviderAddress,
                functionName: "getPairData",
                args: [pair]
            });

            if (pairData) {
                const chainlinkAsset = pairData.exchangeRate.chainlinkAssetAddress as `0x${string}`;
                const chainlinkCollateral = pairData.exchangeRate.chainlinkCollateralAddress as `0x${string}`;

                metadata = {
                    assetAddress: pairData.asset as `0x${string}`,
                    collateralAddress: pairData.collateral as `0x${string}`,
                    chainlinkAssetOracle: (chainlinkAsset && chainlinkAsset !== zeroAddr) ? chainlinkAsset : null,
                    chainlinkCollateralOracle: (chainlinkCollateral && chainlinkCollateral !== zeroAddr) ? chainlinkCollateral : null
                };

                isolatedPairMetadataCache.set(normalizedPair, metadata);
            }
        }

        if (metadata) {
            result.assetAddress = metadata.assetAddress;
            result.collateralAddress = metadata.collateralAddress;

            // Fetch fresh prices from Chainlink oracles in parallel
            const pricePromises: Promise<void>[] = [];

            if (metadata.chainlinkAssetOracle) {
                pricePromises.push(
                    context.client.readContract({
                        abi: ChainlinkAggregatorAbi,
                        address: metadata.chainlinkAssetOracle,
                        functionName: "latestRoundData",
                        args: []
                    }).then((priceData: any) => {
                        result.assetPrice = priceData?.[1] ?? null;
                    }).catch((e: any) => {
                        console.error(`[getIsolatedPairAssetInfo] Error fetching Chainlink asset price for pair ${pair}: ${e.message}`);
                    })
                );
            }

            if (metadata.chainlinkCollateralOracle) {
                pricePromises.push(
                    context.client.readContract({
                        abi: ChainlinkAggregatorAbi,
                        address: metadata.chainlinkCollateralOracle,
                        functionName: "latestRoundData",
                        args: []
                    }).then((priceData: any) => {
                        result.collateralPrice = priceData?.[1] ?? null;
                    }).catch((e: any) => {
                        console.error(`[getIsolatedPairAssetInfo] Error fetching Chainlink collateral price for pair ${pair}: ${e.message}`);
                    })
                );
            }

            await Promise.all(pricePromises);
        }
    } catch (e: any) {
        console.error(`[getIsolatedPairAssetInfo] Error fetching asset/collateral info for pair ${pair}: ${e.message}`);
    }

    return result;
}

export async function getOraclePrice(context: any, reserve: string){
    const priceData = await context.client.readContract({
        abi: OracleAbi,
        address: config.contracts.Oracle.address,
        functionName: "getAssetPrice",
        args: [reserve]
    });

    return priceData;
}

export async function getIsolatedOraclePrice(context: any, pair: string){
    const prices = await getIsolatedOraclePrices(context, pair);
    return prices ? prices.priceHigh : null;
}

/**
 * Get both low and high prices from an isolated pair's oracle
 * @returns { priceLow, priceHigh } or null if error
 */
export async function getIsolatedOraclePrices(context: any, pair: string): Promise<{ priceLow: bigint; priceHigh: bigint } | null> {
    try {
        // Validate pair address
        if (!pair || pair === "0xNEW" || pair === "0x0000000000000000000000000000000000000000") {
            console.error(`[getIsolatedOraclePrices] Invalid pair address: ${pair}`);
            return null;
        }

        // First, get the oracle address from the pair's exchangeRateInfo
        const exchangeRateInfo = await context.client.readContract({
            abi: IsolatedAbi,
            address: pair,
            functionName: "exchangeRateInfo",
            args: []
        });

        if (!exchangeRateInfo) {
            console.error(`[getIsolatedOraclePrices] exchangeRateInfo returned null for pair ${pair}`);
            return null;
        }

        // Get oracle address (first field in the tuple)
        const oracleAddress = exchangeRateInfo[0];

        // Check if oracle address is valid (not zero address)
        if (!oracleAddress || oracleAddress === "0x0000000000000000000000000000000000000000") {
            console.error(`[getIsolatedOraclePrices] Invalid oracle address for pair ${pair}: ${oracleAddress}`);
            return null;
        }

        // Get the price from the oracle using getPrices function (no args needed)
        // Returns (_isBadData, _priceLow, _priceHigh)
        const priceData = await context.client.readContract({
            abi: IsolatedPairOracleAbi,
            address: oracleAddress,
            functionName: "getPrices",
            args: []
        });

        // Validate price data structure
        if (!priceData || priceData.length < 3) {
            console.error(`[getIsolatedOraclePrices] Oracle returned invalid price data for pair ${pair}`);
            return null;
        }

        const [_isBadData, _priceLow, _priceHigh] = priceData;

        // Check if the oracle marked the data as bad
        if (_isBadData) {
            console.error(`[getIsolatedOraclePrices] Oracle marked price data as bad for pair ${pair}`);
            return null;
        }

        return { priceLow: _priceLow, priceHigh: _priceHigh };

    } catch (error: any) {
        console.error(`[getIsolatedOraclePrices] Error getting oracle price for pair ${pair}:`, error);
        console.error(`[getIsolatedOraclePrices] Error details:`, error.message);
        return null;
    }
}

/**
 * Get the most appropriate asset price for a time segment
 * Finds the closest price snapshot to the segment's midpoint time from the oracle snapshots
 *
 * @param context - Ponder context with database access
 * @param asset - Asset address (for regular pools) or pair address (for isolated pairs)
 * @param startTime - Segment start timestamp
 * @param endTime - Segment end timestamp
 * @param isIsolatedPair - Whether this is for an isolated pair
 * @returns Asset price as bigint (8 decimals precision) or 0n if not found
 */
export async function getAssetPriceForSegment(
    context: any,
    asset: string,
    startTime: number,
    endTime: number,
    isIsolatedPair: boolean = false
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    // Calculate segment midpoint for finding closest price
    const segmentMidpoint = Math.floor((startTime + endTime) / 2);

    try {
        if (isIsolatedPair) {
            // For isolated pairs, query IsolatedPairPriceSnapshot
            // Get the most recent snapshot before or at the segment midpoint
            const snapshots = await dbQuery.select().from(IsolatedPairPriceSnapshot).where(
                and(
                    eq(IsolatedPairPriceSnapshot.pair, asset as `0x${string}`),
                    lte(IsolatedPairPriceSnapshot.timestamp, segmentMidpoint)
                )
            ).orderBy(desc(IsolatedPairPriceSnapshot.timestamp)).limit(1);

            if (snapshots.length > 0 && snapshots[0].priceHigh > 0n) {
                return snapshots[0].priceHigh;
            }

        } else {
            // For regular pools, query AssetPriceSnapshot
            // Get the most recent snapshot before or at the segment midpoint
            const snapshots = await dbQuery.select().from(AssetPriceSnapshot).where(
                and(
                    eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                    lte(AssetPriceSnapshot.timestamp, segmentMidpoint)
                )
            ).orderBy(desc(AssetPriceSnapshot.timestamp)).limit(1);

            if (snapshots.length > 0 && snapshots[0].price > 0n) {
                return snapshots[0].price;
            }
        }

        return 0n; // No price found

    } catch (error) {
        console.error(`Error fetching asset price for segment: ${error}`);
        return 0n;
    }
}