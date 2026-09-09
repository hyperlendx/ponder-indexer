import { OracleAbi } from "../../abis/OracleAbi";
import config from "../../ponder.config";

/**
 * Read the current oracle price of a core pool reserve (8 decimals precision)
 */
export async function getOraclePrice(context: any, reserve: string){
    const priceData = await context.client.readContract({
        abi: OracleAbi,
        address: config.contracts.Oracle.address,
        functionName: "getAssetPrice",
        args: [reserve]
    });

    return priceData;
}
