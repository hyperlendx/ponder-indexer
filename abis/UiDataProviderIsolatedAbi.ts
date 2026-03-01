export const UiDataProviderIsolatedAbi = [
    {
        "inputs": [],
        "name": "UTIL_PREC",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_pair",
                "type": "address"
            }
        ],
        "name": "getPairData",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "pair",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "asset",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "collateral",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "ltv",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "totalAsset",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "totalBorrow",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "totalCollateral",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "decimals",
                        "type": "uint256"
                    },
                    {
                        "internalType": "string",
                        "name": "name",
                        "type": "string"
                    },
                    {
                        "internalType": "string",
                        "name": "symbol",
                        "type": "string"
                    },
                    {
                        "components": [
                            {
                                "internalType": "uint32",
                                "name": "lastBlock",
                                "type": "uint32"
                            },
                            {
                                "internalType": "uint32",
                                "name": "feeToProtocolRate",
                                "type": "uint32"
                            },
                            {
                                "internalType": "uint64",
                                "name": "lastTimestamp",
                                "type": "uint64"
                            },
                            {
                                "internalType": "uint64",
                                "name": "ratePerSec",
                                "type": "uint64"
                            },
                            {
                                "internalType": "uint64",
                                "name": "fullUtilizationRate",
                                "type": "uint64"
                            }
                        ],
                        "internalType": "struct UiDataProviderIsolated.InterestRateInfo",
                        "name": "interestRate",
                        "type": "tuple"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "oracle",
                                "type": "address"
                            },
                            {
                                "internalType": "uint32",
                                "name": "maxOracleDeviation",
                                "type": "uint32"
                            },
                            {
                                "internalType": "uint184",
                                "name": "lastTimestamp",
                                "type": "uint184"
                            },
                            {
                                "internalType": "uint256",
                                "name": "lowExchangeRate",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "highExchangeRate",
                                "type": "uint256"
                            },
                            {
                                "internalType": "address",
                                "name": "chainlinkAssetAddress",
                                "type": "address"
                            },
                            {
                                "internalType": "address",
                                "name": "chainlinkCollateralAddress",
                                "type": "address"
                            }
                        ],
                        "internalType": "struct UiDataProviderIsolated.ExchangeRateInfo",
                        "name": "exchangeRate",
                        "type": "tuple"
                    },
                    {
                        "internalType": "uint256",
                        "name": "availableLiquidity",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "depositLimit",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "borrowLimit",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct UiDataProviderIsolated.PairData",
                "name": "pairData",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_user",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_pair",
                "type": "address"
            }
        ],
        "name": "getUserData",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "pair",
                        "type": "address"
                    },
                    {
                        "internalType": "uint8",
                        "name": "decimals",
                        "type": "uint8"
                    },
                    {
                        "internalType": "uint256",
                        "name": "userAssets",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "userCollateral",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "userBorrow",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maxWithdraw",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "userAssetsShares",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "userBorrowShares",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct UiDataProviderIsolated.UserData",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_user",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_registry",
                "type": "address"
            }
        ],
        "name": "getUserPairs",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "pair",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "asset",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "collateral",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "assetDecimals",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "collateralDecimals",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "suppliedAssets",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "borrowedAssets",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "suppliedShares",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "borrowedShares",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "suppliedCollateral",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "ratePerSec",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "utilization",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "feeToProtocolRate",
                        "type": "uint256"
                    },
                    {
                        "internalType": "int256",
                        "name": "assetPrice",
                        "type": "int256"
                    },
                    {
                        "internalType": "int256",
                        "name": "collateralPrice",
                        "type": "int256"
                    }
                ],
                "internalType": "struct UiDataProviderIsolated.UserPosition[]",
                "name": "",
                "type": "tuple[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
] as const
