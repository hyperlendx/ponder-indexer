import { createConfig, factory } from "ponder";
import { http, parseAbiItem } from "viem";

import { CorePoolAbi } from "./abis/CorePoolAbi";
import { OracleAbi } from "./abis/OracleAbi";
import { IsolatedAbi } from "./abis/IsolatedAbi";

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
                "0x036Ad31A37b747e39322878eD851711507f13b1b", //main pool
            ],
            startBlock: 249000,
        },
        Oracle: {
            network: "hyperEvm",
            abi: OracleAbi,
            address: "0x6C6188e608809E328274f1B57C0112A41e83Cd55", //main pool oracle
            startBlock: 249000,
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
