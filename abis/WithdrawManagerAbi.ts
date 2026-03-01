export const WithdrawManagerAbi =  [{"inputs": [], "stateMutability": "nonpayable", "type": "constructor"}, {
    "inputs": [{
        "internalType": "address",
        "name": "target",
        "type": "address"
    }], "name": "AddressEmptyCode", "type": "error"
}, {"inputs": [], "name": "AlreadyClaimed", "type": "error"}, {
    "inputs": [],
    "name": "CanOnlyFinalizeForward",
    "type": "error"
}, {
    "inputs": [{"internalType": "address", "name": "implementation", "type": "address"}],
    "name": "ERC1967InvalidImplementation",
    "type": "error"
}, {"inputs": [], "name": "ERC1967NonPayable", "type": "error"}, {
    "inputs": [],
    "name": "EnforcedPause",
    "type": "error"
}, {"inputs": [], "name": "ExpectedPause", "type": "error"}, {
    "inputs": [],
    "name": "FailedCall",
    "type": "error"
}, {"inputs": [], "name": "IndexOutOfBounds", "type": "error"}, {
    "inputs": [],
    "name": "InstantWithdrawalRateLimitExceeded",
    "type": "error"
}, {"inputs": [], "name": "InsufficientBeHYPEBalance", "type": "error"}, {
    "inputs": [],
    "name": "InsufficientHYPELiquidity",
    "type": "error"
}, {"inputs": [], "name": "InsufficientMinimumAmountOut", "type": "error"}, {
    "inputs": [],
    "name": "InvalidAmount",
    "type": "error"
}, {"inputs": [], "name": "InvalidInitialization", "type": "error"}, {
    "inputs": [],
    "name": "InvalidInstantWithdrawalFee",
    "type": "error"
}, {"inputs": [], "name": "InvalidWithdrawalID", "type": "error"}, {
    "inputs": [],
    "name": "NotAuthorized",
    "type": "error"
}, {"inputs": [], "name": "NotInitializing", "type": "error"}, {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
}, {
    "inputs": [{"internalType": "uint8", "name": "bits", "type": "uint8"}, {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
    }], "name": "SafeCastOverflowedUintDowncast", "type": "error"
}, {"inputs": [], "name": "TransferFailed", "type": "error"}, {
    "inputs": [],
    "name": "UUPSUnauthorizedCallContext",
    "type": "error"
}, {
    "inputs": [{"internalType": "bytes32", "name": "slot", "type": "bytes32"}],
    "name": "UUPSUnsupportedProxiableUUID",
    "type": "error"
}, {"inputs": [], "name": "WithdrawalNotClaimable", "type": "error"}, {
    "inputs": [],
    "name": "WithdrawalsNotPaused",
    "type": "error"
}, {"inputs": [], "name": "WithdrawalsPaused", "type": "error"}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint64", "name": "version", "type": "uint64"}],
    "name": "Initialized",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "beHypeAmountWithdrawn",
        "type": "uint256"
    }, {
        "indexed": false,
        "internalType": "uint256",
        "name": "hypeAmountReceived",
        "type": "uint256"
    }, {"indexed": false, "internalType": "uint256", "name": "beHypeInstantWithdrawalFee", "type": "uint256"}],
    "name": "InstantWithdrawal",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "capacity", "type": "uint256"}],
    "name": "InstantWithdrawalCapacityUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "instantWithdrawalFeeInBps", "type": "uint256"}],
    "name": "InstantWithdrawalFeeInBpsUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "refillRate", "type": "uint256"}],
    "name": "InstantWithdrawalRefillRateUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "address", "name": "account", "type": "address"}],
    "name": "Paused",
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
    "inputs": [{"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {
        "indexed": true,
        "internalType": "uint256",
        "name": "withdrawalId",
        "type": "uint256"
    }, {"indexed": false, "internalType": "uint256", "name": "hypeAmount", "type": "uint256"}],
    "name": "WithdrawalClaimed",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {
        "indexed": true,
        "internalType": "uint256",
        "name": "withdrawalId",
        "type": "uint256"
    }, {"indexed": false, "internalType": "uint256", "name": "beHypeAmount", "type": "uint256"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "hypeAmount",
        "type": "uint256"
    }, {"indexed": false, "internalType": "uint256", "name": "queueIndex", "type": "uint256"}],
    "name": "WithdrawalQueued",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "upToIndex", "type": "uint256"}],
    "name": "WithdrawalsBatchFinalized",
    "type": "event"
}, {
    "inputs": [],
    "name": "BASIS_POINT_SCALE",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "BUCKET_UNIT_SCALE",
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
    "name": "beHypeToken",
    "outputs": [{"internalType": "contract IBeHYPEToken", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "withdrawalId", "type": "uint256"}],
    "name": "canClaimWithdrawal",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "beHypeAmount", "type": "uint256"}],
    "name": "canInstantWithdraw",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "withdrawalId", "type": "uint256"}],
    "name": "claimWithdrawal",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "index", "type": "uint256"}],
    "name": "finalizeWithdrawals",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "getLiquidHypeAmount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "getPendingWithdrawalsCount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "getTotalInstantWithdrawableBeHYPE",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
    "name": "getUserUnclaimedWithdrawals",
    "outputs": [{"internalType": "uint256[]", "name": "", "type": "uint256[]"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "index", "type": "uint256"}],
    "name": "getWithdrawalQueue",
    "outputs": [{
        "components": [{
            "internalType": "address",
            "name": "user",
            "type": "address"
        }, {"internalType": "uint256", "name": "beHypeAmount", "type": "uint256"}, {
            "internalType": "uint256",
            "name": "hypeAmount",
            "type": "uint256"
        }, {"internalType": "bool", "name": "claimed", "type": "bool"}],
        "internalType": "struct IWithdrawManager.WithdrawalEntry",
        "name": "",
        "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "hypeRequestedForWithdraw",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "_minWithdrawAmount", "type": "uint256"}, {
        "internalType": "uint256",
        "name": "_maxWithdrawAmount",
        "type": "uint256"
    }, {"internalType": "uint16", "name": "_lowWatermarkInBpsOfTvl", "type": "uint16"}, {
        "internalType": "uint16",
        "name": "_instantWithdrawalFeeInBps",
        "type": "uint16"
    }, {"internalType": "address", "name": "_roleRegistry", "type": "address"}, {
        "internalType": "address",
        "name": "_beHypeToken",
        "type": "address"
    }, {"internalType": "address", "name": "_stakingCore", "type": "address"}, {
        "internalType": "uint256",
        "name": "_bucketCapacity",
        "type": "uint256"
    }, {"internalType": "uint256", "name": "_bucketRefillRate", "type": "uint256"}],
    "name": "initialize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "instantWithdrawalFeeInBps",
    "outputs": [{"internalType": "uint16", "name": "", "type": "uint16"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "instantWithdrawalLimit",
    "outputs": [{"internalType": "uint64", "name": "capacity", "type": "uint64"}, {
        "internalType": "uint64",
        "name": "remaining",
        "type": "uint64"
    }, {"internalType": "uint64", "name": "lastRefill", "type": "uint64"}, {
        "internalType": "uint64",
        "name": "refillRate",
        "type": "uint64"
    }],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "lastFinalizedIndex",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "lowWatermarkInBpsOfTvl",
    "outputs": [{"internalType": "uint16", "name": "", "type": "uint16"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "lowWatermarkInHYPE",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "maxWithdrawalAmount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "minWithdrawalAmount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "pauseWithdrawals",
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
    "inputs": [{"internalType": "uint256", "name": "capacity", "type": "uint256"}],
    "name": "setInstantWithdrawalCapacity",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint16", "name": "_instantWithdrawalFeeInBps", "type": "uint16"}],
    "name": "setInstantWithdrawalFeeInBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "refillRate", "type": "uint256"}],
    "name": "setInstantWithdrawalRefillRatePerSecond",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "stakingCore",
    "outputs": [{"internalType": "contract IStakingCore", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "unpauseWithdrawals",
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
    "inputs": [{"internalType": "address", "name": "", "type": "address"}, {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
    }],
    "name": "userWithdrawals",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "beHypeAmount", "type": "uint256"}, {
        "internalType": "bool",
        "name": "instant",
        "type": "bool"
    }, {"internalType": "uint256", "name": "minAmountOut", "type": "uint256"}],
    "name": "withdraw",
    "outputs": [{"internalType": "uint256", "name": "withdrawalId", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "name": "withdrawalQueue",
    "outputs": [{"internalType": "address", "name": "user", "type": "address"}, {
        "internalType": "uint256",
        "name": "beHypeAmount",
        "type": "uint256"
    }, {"internalType": "uint256", "name": "hypeAmount", "type": "uint256"}, {
        "internalType": "bool",
        "name": "claimed",
        "type": "bool"
    }],
    "stateMutability": "view",
    "type": "function"
}, {"stateMutability": "payable", "type": "receive"}]