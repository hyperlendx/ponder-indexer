import {createConfig, factory} from "ponder";
import {http, parseAbiItem} from "viem";

import {CorePoolAbi} from "./abis/CorePoolAbi";
import {OracleAbi} from "./abis/OracleAbi";
import {IsolatedAbi} from "./abis/IsolatedAbi";
import {HTokenAbi} from "./abis/HTokenAbi";
import {LoopingStrategyManagerFactoryAbi} from "./abis/LoopingStrategyManagerFactory";
import {IsolatedPairRegistry as IsolatedPairRegistryAbi} from "./abis/IsolatedPairRegistry";

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
        CorePool: {
            chain: "hyperEvm",
            abi: CorePoolAbi,
            address: [
                "0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b", //main pool
            ],
            startBlock: 787000,
        },
        Oracle: {
            chain: "hyperEvm",
            abi: OracleAbi,
            address: "0xC9Fb4fbE842d57EAc1dF3e641a281827493A630e", //main pool oracle
            startBlock: 787000,
        },
        HTokens: {
            abi: HTokenAbi,
            chain: "hyperEvm",
            address: factory({
                // The address of the factory contract that creates instances of this child contract.
                address: "0x8CB4310dD38F6fD59388C9DE225f328092bdC379",
                // The event emitted by the factory that announces a new instance of this child contract.
                event: parseAbiItem("event ReserveInitialized(address asset, address aToken, address stableDebtToken, address variableDebtToken, address interestRateStrategyAddress)"),
                // The name of the parameter that contains the address of the new child contract.
                parameter: "aToken",
            }),
            startBlock: 787000,
        },
        IsolatedPair: {
            abi: IsolatedAbi,
            chain: "hyperEvm",
            address: factory({
                // The address of the factory contract that creates instances of this child contract.
                address: "0xf55af86c9ec3a7d5fa6367c00a120e6b262f718d",
                // The event emitted by the factory that announces a new instance of this child contract.
                event: parseAbiItem("event AddPair(address pairAddress)"),
                // The name of the parameter that contains the address of the new child contract.
                parameter: "pairAddress",
            }),
            startBlock: 7336100,
        },

        LoopingStrategyManagerFactory: {
            abi: LoopingStrategyManagerFactoryAbi,
            chain: "hyperEvm",
            address: "0xc3Ed646181Ca80562e96d9e6CF4AF317d22F34b0",
            startBlock: 3414683,
        },
        IsolatedPairRegistryContract: {
            abi: IsolatedPairRegistryAbi,
            chain: "hyperEvm",
            address: "0xf55af86c9ec3a7d5fa6367c00a120e6b262f718d",
            startBlock: 787000,
        },
    },
    blocks: {
        ChainlinkOracleUpdate: {
            chain: "hyperEvm",
            interval: 300, // Every 300 blocks
            startBlock: 787000,
        },
        ChainlinkOracleIsolatedUpdate: {
            chain: "hyperEvm",
            interval: 300, // Every 300 blocks
            startBlock: 7336100,
        },
    },
});
