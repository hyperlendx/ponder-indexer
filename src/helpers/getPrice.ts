import { OracleAbi } from "../../abis/OracleAbi";
import { IsolatedAbi } from "../../abis/IsolatedAbi";

import config from "../../ponder.config";

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
    const priceData = await context.client.readContract({
        abi: IsolatedAbi,
        address: pair,
        functionName: "exchangeRateInfo",
        args: []
    });

    return priceData.highExchangeRate;
}