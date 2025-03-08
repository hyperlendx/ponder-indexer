import { createConfig, factory } from "ponder";
import { http, parseAbiItem } from "viem";

import { CorePoolAbi } from "./abis/CorePoolAbi";
import { OracleAbi } from "./abis/OracleAbi";
import { IsolatedAbi } from "./abis/IsolatedAbi";
import { HTokenAbi } from "./abis/HTokenAbi";

export default createConfig({
    networks: {
        hyperEvm: {
            chainId: 999,
            transport: http(process.env.PONDER_RPC_URL_999),
        },
    },
    contracts: {
        CorePool: {
            network: "hyperEvm",
            abi: CorePoolAbi,
            address: [
                "0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b", //main pool
            ],
            startBlock: 787000,
        },
        Oracle: {
            network: "hyperEvm",
            abi: OracleAbi,
            address: "0xC9Fb4fbE842d57EAc1dF3e641a281827493A630e", //main pool oracle
            startBlock: 787000,
        },
        HTokens: {
            abi: HTokenAbi,
            network: "hyperEvm",
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
            network: "hyperEvm",
            address: factory({
              // The address of the factory contract that creates instances of this child contract.
              address: "0x9A32C32D7A0e13892Cd68E143AC890F6308304F5",
              // The event emitted by the factory that announces a new instance of this child contract.
              event: parseAbiItem("event AddPair(address pairAddress)"),
              // The name of the parameter that contains the address of the new child contract.
              parameter: "pairAddress",
            }),
            startBlock: 249000,
        }
    },
});
