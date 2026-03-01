export const ValidatorManagerAbi = [{
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
}, {"inputs": [], "name": "AccessControlBadConfirmation", "type": "error"}, {
    "inputs": [{
        "internalType": "address",
        "name": "account",
        "type": "address"
    }, {"internalType": "bytes32", "name": "neededRole", "type": "bytes32"}],
    "name": "AccessControlUnauthorizedAccount",
    "type": "error"
}, {
    "inputs": [{"internalType": "bytes32", "name": "key", "type": "bytes32"}],
    "name": "EnumerableMapNonexistentKey",
    "type": "error"
}, {"inputs": [], "name": "InvalidInitialization", "type": "error"}, {
    "inputs": [],
    "name": "NotInitializing",
    "type": "error"
}, {"inputs": [], "name": "ReentrancyGuardReentrantCall", "type": "error"}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "count", "type": "uint256"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
    }],
    "name": "AllRebalanceRequestsClosed",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{
        "indexed": true,
        "internalType": "address",
        "name": "stakingManager",
        "type": "address"
    }, {"indexed": true, "internalType": "address", "name": "oldDelegation", "type": "address"}, {
        "indexed": true,
        "internalType": "address",
        "name": "newDelegation",
        "type": "address"
    }],
    "name": "DelegationUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "cooldown", "type": "uint256"}],
    "name": "EmergencyCooldownUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "newLimit", "type": "uint256"}],
    "name": "EmergencyWithdrawalLimitUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }],
    "name": "EmergencyWithdrawalProcessed",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }],
    "name": "EmergencyWithdrawalRequested",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint64", "name": "version", "type": "uint64"}],
    "name": "Initialized",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
    }],
    "name": "PerformanceReportGenerated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{
        "indexed": false,
        "internalType": "uint256",
        "name": "startIndex",
        "type": "uint256"
    }, {"indexed": false, "internalType": "uint256", "name": "endIndex", "type": "uint256"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
    }],
    "name": "RebalanceBatchProcessed",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "cooldown", "type": "uint256"}],
    "name": "RebalanceCooldownUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }],
    "name": "RebalanceRequestAdded",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }],
    "name": "RebalanceRequestClosed",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }],
    "name": "RewardEventReported",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "indexed": true,
        "internalType": "bytes32",
        "name": "previousAdminRole",
        "type": "bytes32"
    }, {"indexed": true, "internalType": "bytes32", "name": "newAdminRole", "type": "bytes32"}],
    "name": "RoleAdminChanged",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
    }, {"indexed": true, "internalType": "address", "name": "sender", "type": "address"}],
    "name": "RoleGranted",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
    }, {"indexed": true, "internalType": "address", "name": "sender", "type": "address"}],
    "name": "RoleRevoked",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }],
    "name": "SlashingEventReported",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": false, "internalType": "uint256", "name": "minLimit", "type": "uint256"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxLimit",
        "type": "uint256"
    }],
    "name": "StakeLimitsUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "newStake",
        "type": "uint256"
    }],
    "name": "StakeRebalanced",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}],
    "name": "ValidatorActivated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}],
    "name": "ValidatorAdded",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}],
    "name": "ValidatorDeactivated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
    }, {"indexed": false, "internalType": "uint256", "name": "blockNumber", "type": "uint256"}],
    "name": "ValidatorPerformanceUpdated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}],
    "name": "ValidatorReactivated",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}],
    "name": "ValidatorRemoved",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "validator", "type": "address"}, {
        "indexed": false,
        "internalType": "uint256",
        "name": "performanceScore",
        "type": "uint256"
    }],
    "name": "ValidatorScoreUpdated",
    "type": "event"
}, {
    "inputs": [],
    "name": "BASIS_POINTS",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "DEFAULT_ADMIN_ROLE",
    "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "MANAGER_ROLE",
    "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "ORACLE_MANAGER_ROLE",
    "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "activateValidator",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [],
    "name": "activeValidatorsCount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "stakingManager", "type": "address"}, {
        "internalType": "address[]",
        "name": "validators",
        "type": "address[]"
    }], "name": "closeRebalanceRequests", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "deactivateValidator",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "delegations",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "stakingManager", "type": "address"}],
    "name": "getDelegation",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}],
    "name": "getRoleAdmin",
    "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
    }],
    "name": "getRoleMember",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}],
    "name": "getRoleMemberCount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}],
    "name": "getRoleMembers",
    "outputs": [{"internalType": "address[]", "name": "", "type": "address[]"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "internalType": "address",
        "name": "account",
        "type": "address"
    }], "name": "grantRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "hasPendingRebalance",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "internalType": "address",
        "name": "account",
        "type": "address"
    }],
    "name": "hasRole",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "admin", "type": "address"}, {
        "internalType": "address",
        "name": "manager",
        "type": "address"
    }, {"internalType": "address", "name": "_oracle", "type": "address"}, {
        "internalType": "address",
        "name": "_pauserRegistry",
        "type": "address"
    }], "name": "initialize", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [],
    "name": "pauserRegistry",
    "outputs": [{"internalType": "contract IPauserRegistry", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "reactivateValidator",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "stakingManager", "type": "address"}, {
        "internalType": "address[]",
        "name": "validators",
        "type": "address[]"
    }, {"internalType": "uint256[]", "name": "withdrawalAmounts", "type": "uint256[]"}],
    "name": "rebalanceWithdrawal",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "internalType": "address",
        "name": "callerConfirmation",
        "type": "address"
    }], "name": "renounceRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}, {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }], "name": "reportRewardEvent", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}, {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
    }], "name": "reportSlashingEvent", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {
        "internalType": "address",
        "name": "account",
        "type": "address"
    }], "name": "revokeRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "stakingManager", "type": "address"}, {
        "internalType": "address",
        "name": "validator",
        "type": "address"
    }], "name": "setDelegation", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}, {
    "inputs": [{"internalType": "bytes4", "name": "interfaceId", "type": "bytes4"}],
    "name": "supportsInterface",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "totalRewards",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "totalSlashing",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}, {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
    }, {"internalType": "uint256", "name": "performanceScore", "type": "uint256"}],
    "name": "updateValidatorPerformance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "validatorActiveState",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "uint256", "name": "index", "type": "uint256"}],
    "name": "validatorAt",
    "outputs": [{
        "internalType": "address",
        "name": "validator",
        "type": "address"
    }, {
        "components": [{"internalType": "uint256", "name": "balance", "type": "uint256"}, {
            "internalType": "uint256",
            "name": "performanceScore",
            "type": "uint256"
        }, {"internalType": "uint256", "name": "lastUpdateTime", "type": "uint256"}, {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
        }], "internalType": "struct IValidatorManager.Validator", "name": "data", "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "validatorBalance",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "validatorCount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "validatorInfo",
    "outputs": [{
        "components": [{
            "internalType": "uint256",
            "name": "balance",
            "type": "uint256"
        }, {"internalType": "uint256", "name": "performanceScore", "type": "uint256"}, {
            "internalType": "uint256",
            "name": "lastUpdateTime",
            "type": "uint256"
        }, {"internalType": "bool", "name": "active", "type": "bool"}],
        "internalType": "struct IValidatorManager.Validator",
        "name": "",
        "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "validatorLastUpdateTime",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "validatorPerformance",
    "outputs": [{"internalType": "uint256", "name": "balance", "type": "uint256"}, {
        "internalType": "uint256",
        "name": "performanceScore",
        "type": "uint256"
    }, {"internalType": "uint256", "name": "timestamp", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "validatorRebalanceRequests",
    "outputs": [{"internalType": "address", "name": "staking", "type": "address"}, {
        "internalType": "address",
        "name": "validator",
        "type": "address"
    }, {"internalType": "uint256", "name": "amount", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "validatorRewards",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "validator", "type": "address"}],
    "name": "validatorScores",
    "outputs": [{"internalType": "uint256", "name": "performanceScore", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "validatorSlashing",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
}] as const