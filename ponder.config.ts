import {createConfig} from "ponder";
import {http} from "viem";

import {CorePoolAbi} from "./abis/CorePoolAbi";
import {OracleAbi} from "./abis/OracleAbi";
import {HTokenAbi} from "./abis/HTokenAbi";
import {USDC_ADDRESS, USDC_HTOKEN_ADDRESS} from "./src/helpers/usdc";

export default createConfig({
    chains: {
        hyperEvm: {
            id: 999,
            rpc: http(process.env.PONDER_RPC_URL_999, {
                // Optimize batch requests
                batch: {
                    batchSize: 100, // Increase batch size for faster RPC calls
                    wait: 16, // Reduce wait time between batches
                },
                // Add retry logic
                retryCount: 3,
                retryDelay: 1000,
            }),
        },
    },
    contracts: {
        // ====================================================================
        // HyperLend core pool - USDC reserve only.
        // Every event below indexes its reserve/asset argument as a log topic,
        // so filtering on USDC happens at the eth_getLogs level and logs for
        // other reserves are never fetched. Events without a reserve argument
        // (e.g. UserEModeSet) are intentionally not indexed.
        // ====================================================================
        CorePool: {
            chain: "hyperEvm",
            abi: CorePoolAbi,
            address: "0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b", //main pool
            startBlock: 787000,
            filter: [
                {event: "Supply", args: {reserve: USDC_ADDRESS}},
                {event: "Withdraw", args: {reserve: USDC_ADDRESS}},
                {event: "Borrow", args: {reserve: USDC_ADDRESS}},
                {event: "Repay", args: {reserve: USDC_ADDRESS}},
                // Liquidations are kept when USDC is EITHER the collateral or the debt asset.
                // A single log filter cannot express an OR across two topic positions (and
                // Ponder keeps only one filter per event), so all LiquidationCall logs are
                // fetched and the handler in src/index.ts drops the non-USDC ones.
                {event: "LiquidationCall", args: {}},
                {event: "FlashLoan", args: {asset: USDC_ADDRESS}},
                {event: "ReserveDataUpdated", args: {reserve: USDC_ADDRESS}},
                {event: "ReserveUsedAsCollateralEnabled", args: {reserve: USDC_ADDRESS}},
                {event: "ReserveUsedAsCollateralDisabled", args: {reserve: USDC_ADDRESS}},
                {event: "SwapBorrowRateMode", args: {reserve: USDC_ADDRESS}},
                {event: "MintedToTreasury", args: {reserve: USDC_ADDRESS}},
                {event: "MintUnbacked", args: {reserve: USDC_ADDRESS}},
                {event: "BackUnbacked", args: {reserve: USDC_ADDRESS}},
                {event: "RebalanceStableBorrowRate", args: {reserve: USDC_ADDRESS}},
                {event: "IsolationModeTotalDebtUpdated", args: {asset: USDC_ADDRESS}},
            ],
        },
        Oracle: {
            chain: "hyperEvm",
            abi: OracleAbi,
            address: "0xC9Fb4fbE842d57EAc1dF3e641a281827493A630e", //main pool oracle
            startBlock: 787000,
        },
        // hToken (aToken) of the USDC reserve - tracks BalanceTransfer events
        USDCHToken: {
            abi: HTokenAbi,
            chain: "hyperEvm",
            address: USDC_HTOKEN_ADDRESS,
            startBlock: 787000,
        },
    },
    blocks: {
        // Hourly USDC oracle anchor shared by all event and report calculations.
        ChainlinkOracleUpdate: {
            chain: "hyperEvm",
            interval: 3600,
            startBlock: 787000,
        },
    },
});
