/**
 * USDC on HyperEVM - the only core pool reserve this indexer tracks.
 *
 * Every CorePool event handler and the oracle price snapshot job are restricted
 * to this reserve. See ponder.config.ts for the log-level event filters.
 */
export const USDC_ADDRESS = "0xb88339CB7199b77E23DB6E890353E22632Ba630f" as const;

/** hToken (aToken) of the USDC reserve on the HyperLend core pool */
export const USDC_HTOKEN_ADDRESS = "0x744E4f26ee30213989216E1632D9BE3547C4885b" as const;

export const USDC_DECIMALS = 6;

/**
 * Case-insensitive check whether an address is the USDC reserve.
 */
export function isUSDC(address: string): boolean {
    return address.toLowerCase() === USDC_ADDRESS.toLowerCase();
}
