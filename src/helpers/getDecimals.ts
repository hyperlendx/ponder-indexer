import {USDC_ADDRESS, USDC_DECIMALS} from "./usdc";

const tokenDecimalsMap: Record<string, number> = {
    [USDC_ADDRESS.toLowerCase()]: USDC_DECIMALS,
};

/**
 * Get token decimals from hardcoded map
 *
 * @param context - Ponder context (not used, kept for API compatibility)
 * @param reserve - Token address
 * @returns Token decimals (number), or undefined if not found
 */
export async function getDecimals(context: any, reserve: string): Promise<number | undefined> {
    const normalizedAddress = reserve.toLowerCase();
    return tokenDecimalsMap[normalizedAddress];
}
