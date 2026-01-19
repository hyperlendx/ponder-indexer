import {createConfig, factory} from "ponder";
import {http, parseAbiItem} from "viem";

import {CorePoolAbi} from "./abis/CorePoolAbi";
import {OracleAbi} from "./abis/OracleAbi";
import {IsolatedAbi} from "./abis/IsolatedAbi";
import {HTokenAbi} from "./abis/HTokenAbi";
import {LoopingStrategyManagerFactoryAbi} from "./abis/LoopingStrategyManagerFactory";
import {IsolatedPairRegistry as IsolatedPairRegistryAbi} from "./abis/IsolatedPairRegistry";
import {UiDataProviderIsolatedAbi as UiDataProviderIsolatedAbi} from "./abis/UiDataProviderIsolatedAbi";

// kHYPE (Kinetiq Liquid Staking) ABIs
import {ValidatorManagerAbi} from "./abis/ValidatorManagerAbi";
import {StakingAccountantAbi} from "./abis/StakingAccountantAbi";

// beHYPE (Hyperlend Liquid Staking) ABIs
import {BEHYPEAbi} from "./abis/BEHYPEAbi";
import {StakingCoreAbi} from "./abis/StakingCoreAbi";

// wstHYPE (Thunderhead Wrapped Staked HYPE) ABIs
import {WSTHYPEAbi} from "./abis/WSTHYPEAbi";

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

        UiDataProviderIsolated: {
            abi: UiDataProviderIsolatedAbi,
            chain: "hyperEvm",
            address: "0xa4622037080B84dCAf12d24593D3D7cf0f414578",
            startBlock: 7350442,
        },

        LoopingStrategyManagerFactory: {
            abi: LoopingStrategyManagerFactoryAbi,
            chain: "hyperEvm",
            address: "0xc3Ed646181Ca80562e96d9e6CF4AF317d22F34b0",
            startBlock: 7336100,
        },
        IsolatedPairRegistryContract: {
            abi: IsolatedPairRegistryAbi,
            chain: "hyperEvm",
            address: "0xf55af86c9ec3a7d5fa6367c00a120e6b262f718d",
            startBlock: 7336100,
        },

        // ============================================================================
        // kHYPE (Kinetiq Liquid Staking) Contracts
        // Track RewardEventReported and SlashingEventReported for exchange rate changes
        // kHYPE pool positions are tracked via CorePool:Supply/Withdraw events
        // ============================================================================

        // ValidatorManager - Track RewardEventReported and SlashingEventReported events
        // These are the ONLY events that change the kHYPE exchange rate
        ValidatorManager: {
            abi: ValidatorManagerAbi,
            chain: "hyperEvm",
            address: "0x4b797A93DfC3D18Cf98B7322a2b142FA8007508f",
            startBlock: 7635400,
        },

        // ============================================================================
        // beHYPE (Hyperlend Liquid Staking) Contracts
        // Track Transfer events for user balances and ExchangeRatioUpdated for yield
        // Exchange rate is stored in StakingCore.exchangeRatio state variable
        // ============================================================================

        // beHYPE Token - Track Transfer events for user balance changes (mint/burn/transfer)
        BEHYPE: {
            abi: BEHYPEAbi,
            chain: "hyperEvm",
            address: "0xd8FC8F0b03eBA61F64D08B0bef69d80916E5DdA9",
            startBlock: 12965069,
        },

        // StakingCore - Track ExchangeRatioUpdated events for yield calculation
        BeHYPEStakingCore: {
            abi: StakingCoreAbi,
            chain: "hyperEvm",
            address: "0xCeaD893b162D38e714D82d06a7fe0b0dc3c38E0b",
            startBlock: 12965190,
        },

        // ============================================================================
        // wstHYPE (Thunderhead Wrapped Staked HYPE) Contracts
        // Track Transfer events for user balances and Rebase events for yield
        // Exchange rate is assetsPerShare (HYPE per wstHYPE)
        // ============================================================================

        // wstHYPE Token - Track Transfer and Rebase events
        WSTHYPE: {
            abi: WSTHYPEAbi,
            chain: "hyperEvm",
            address: "0x94e8396e0869c9F2200760aF63c69F46D4F616F5",
            startBlock: 3467418,
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
            startBlock: 7350443,
        },
    },
});

