export const StakingCoreAbi = [{"inputs": [], "stateMutability": "nonpayable", "type": "constructor"}, {
    "inputs": [{
        "internalType": "address",
        "name": "target",
        "type": "address"
    }], "name": "AddressEmptyCode", "type": "error"
}, {"inputs": [], "name": "AmountExceedsUint64Max", "type": "error"}, {
    "inputs": [{
        "internalType": "address",
        "name": "implementation",
        "type": "address"
    }], "name": "ERC1967InvalidImplementation", "type": "error"
}, {"inputs": [], "name": "ERC1967NonPayable", "type": "error"}, {
    "inputs": [],
    "name": "ElapsedTimeCannotBeZero",
    "type": "error"
}, {"inputs": [], "name": "EnforcedPause", "type": "error"}, {
    "inputs": [],
    "name": "ExceedsLimit",
    "type": "error"
}, {
    "inputs": [{"internalType": "uint16", "name": "yearlyRateInBps", "type": "uint16"}],
    "name": "ExchangeRatioChangeExceedsThreshold",
    "type": "error"
}, {
    "inputs": [{"internalType": "uint256", "name": "blocksRequired", "type": "uint256"}, {
        "internalType": "uint256",
        "name": "blocksPassed",
        "type": "uint256"
    }], "name": "ExchangeRatioUpdateTooSoon", "type": "error"
}, {"inputs": [], "name": "ExpectedPause", "type": "error"}, {
    "inputs": [],
    "name": "FailedCall",
    "type": "error"
}, {"inputs": [], "name": "FailedToDepositToHyperCore", "type": "error"}, {
    "inputs": [],
    "name": "FailedToFetchDelegatorSummary",
    "type": "error"
}, {"inputs": [], "name": "FailedToSendFromWithdrawManager", "type": "error"}, {
    "inputs": [],
    "name": "InvalidInitialization",
    "type": "error"
}, {"inputs": [], "name": "NotAuthorized", "type": "error"}, {
    "inputs": [],
    "name": "NotInitializing",
    "type": "error"
}, {
    "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}, {
        "internalType": "uint256",
        "name": "truncatedAmount",
        "type": "uint256"
    }], "name": "PrecisionLossDetected", "type": "error"
}, {"inputs": [], "name": "StakingPaused", "type": "error"}, {
    "inputs": [],
    "name": "UUPSUnauthorizedCallContext",
    "type": "error"
}, {
    "inputs": [{"internalType": "bytes32", "name": "slot", "type": "bytes32"}],
    "name": "UUPSUnsupportedProxiableUUID",
    "type": "error"
}, {"inputs": [], "name": "WithdrawalCooldownNotMet", "type": "error"}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint16", "name": "newAprInBps", "type": "uint16"}],
    "name": "AcceptableAprUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "address", "name": "user", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }, {"indexed": false, "internalType": "string", "name": "communityCode", "type": "string"}],
    "name": "Deposit",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "bool", "name": "newExchangeRateGuard", "type": "bool"}],
    "name": "ExchangeRateGuardUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "oldRatio", "type": "uint256"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "newRatio",
        "type": "uint256"
    }, {"indexed": false, "internalType": "uint16", "name": "yearlyRateInBps", "type": "uint16"}],
    "name": "ExchangeRatioUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "HyperCoreDeposit",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "HyperCoreStakingDeposit",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "HyperCoreStakingWithdraw",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "HyperCoreWithdraw",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint64", "name": "version", "type": "uint64"}],
    "name": "Initialized",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "address", "name": "account", "type": "address"}],
    "name": "Paused",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }, {"indexed": false, "internalType": "bool", "name": "isUndelegate", "type": "bool"}],
    "name": "TokenDelegated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "address", "name": "account", "type": "address"}],
    "name": "Unpaused",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "implementation", "type": "address"}],
    "name": "Upgraded",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "address", "name": "withdrawManager", "type": "address"}],
    "name": "WithdrawManagerUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "withdrawalCooldownPeriod", "type": "uint256"}],
    "name": "WithdrawalCooldownPeriodUpdated",
    "type": "event"
}, {
    "inputs": [{"internalType": "uint256", "name": "beHYPEAmount", "type": "uint256"}],
    "name": "BeHYPEToHYPE",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "HYPEAmount", "type": "uint256"}],
    "name": "HYPEToBeHYPE",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "HYPE_TOKEN_ID",
    "outputs": [{"internalType": "uint64", "name": "", "type": "uint64"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "L1_HYPE_CONTRACT",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "MIN_BLOCKS_BEFORE_EXCHANGE_RATIO_UPDATE",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "UPGRADE_INTERFACE_VERSION",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "acceptablAprInBps",
    "outputs": [{"internalType": "uint16", "name": "", "type": "uint16"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "beHypeToken",
    "outputs": [{"internalType": "contract IBeHYPEToken", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "coreWriter",
    "outputs": [{"internalType": "contract CoreWriter", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}, {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }, {"internalType": "bool", "name": "isUndelegate", "type": "bool"}],
    "name": "delegateTokens",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "depositToHyperCore",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "depositToStaking",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "emergencyWithdrawFromStaking",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "exchangeRateGuard",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "exchangeRatio",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "getTotalProtocolHype",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "_roleRegistry", "type": "address"}, {
        "internalType": "address",
        "name": "_beHype",
        "type": "address"
    }, {"internalType": "address", "name": "_withdrawManager", "type": "address"}, {
        "internalType": "uint16",
        "name": "_acceptablAprInBps",
        "type": "uint16"
    }, {"internalType": "bool", "name": "_exchangeRateGuard", "type": "bool"}, {
        "internalType": "uint256",
        "name": "_withdrawalCooldownPeriod",
        "type": "uint256"
    }], "name": "initialize", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [],
    "name": "l1Read",
    "outputs": [{"internalType": "contract L1Read", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "lastExchangeRatioUpdate",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "lastHyperCoreOperationBlock",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "lastWithdrawalTimestamp",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "pauseStaking",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "paused",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "proxiableUUID",
    "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "roleRegistry",
    "outputs": [{"internalType": "contract IRoleRegistry", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}, {
        "internalType": "address",
        "name": "to",
        "type": "address"
    }], "name": "sendFromWithdrawManager", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "_withdrawManager", "type": "address"}],
    "name": "setWithdrawManager",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "string", "name": "communityCode", "type": "string"}],
    "name": "stake",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
}, {
    "inputs": [],
    "name": "unpauseStaking",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint16", "name": "_acceptablAprInBps", "type": "uint16"}],
    "name": "updateAcceptableApr",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "bool", "name": "_exchangeRateGuard", "type": "bool"}],
    "name": "updateExchangeRateGuard",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "updateExchangeRatio",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "_withdrawalCooldownPeriod", "type": "uint256"}],
    "name": "updateWithdrawalCooldownPeriod",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "newImplementation", "type": "address"}, {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
    }], "name": "upgradeToAndCall", "outputs": [], "stateMutability": "payable", "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "withdrawFromHyperCore",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}],
    "name": "withdrawFromStaking",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "withdrawManager",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "withdrawalCooldownPeriod",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {"stateMutability": "payable", "type": "receive"}] as const