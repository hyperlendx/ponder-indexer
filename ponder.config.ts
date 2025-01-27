import { createConfig, factory } from "ponder";
import { http, parseAbiItem } from "viem";

import { CorePoolAbi } from "./abis/CorePoolAbi";
import { OracleAbi } from "./abis/OracleAbi";
import { IsolatedAbi } from "./abis/IsolatedAbi";

export default createConfig({
    networks: {
        hyperEvmTestnet: {
            chainId: 998,
            transport: http(process.env.PONDER_RPC_URL_998),
        },
    },
    contracts: {
        CorePool: {
            network: "hyperEvmTestnet",
            abi: CorePoolAbi,
            address: [
                "0x1e85CCDf0D098a9f55b82F3E35013Eda235C8BD8", //main pool
            ],
            startBlock: 16956624,
        },
        Oracle: {
            network: "hyperEvmTestnet",
            abi: OracleAbi,
            address: "0xecbD8482C698B7b2706807A32d7FDf4E9a55C6A1", //main pool oracle
            startBlock: 16956624,
        },
        IsolatedPair: {
            abi: IsolatedAbi,
            network: "hyperEvmTestnet",
            address: factory({
              // The address of the factory contract that creates instances of this child contract.
              address: "0x274396Ec36D17dAbC018d9437D5a4C0D0fD503D0",
              // The event emitted by the factory that announces a new instance of this child contract.
              event: parseAbiItem("event AddPair(address pairAddress)"),
              // The name of the parameter that contains the address of the new child contract.
              parameter: "pairAddress",
            }),
            startBlock: 16956624,
        }
    },
});
