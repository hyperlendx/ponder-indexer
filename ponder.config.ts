import { createConfig } from "@ponder/core";
import { http } from "viem";

import { CorePoolAbi } from "./abis/CorePoolAbi";
import { OracleAbi } from "./abis/OracleAbi";

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
            startBlock: 16650240,
        },
        Oracle: {
            network: "hyperEvmTestnet",
            abi: OracleAbi,
            address: "0xecbD8482C698B7b2706807A32d7FDf4E9a55C6A1", //main pool oracle
            startBlock: 16650240,
        }
    },
});
