/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/funmarket_pump.json`.
 */
export type FunmarketPump = {
  "address": "A2EqnLDYW1WAi8mhR12ncGVvt92G3jisJqCe46YoV7SJ",
  "metadata": {
    "name": "funmarketPump",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Funmarket.pump - Prediction markets with bonding curves on Solana"
  },
  "instructions": [
    {
      "name": "adminCancel",
      "discriminator": [
        34,
        225,
        37,
        131,
        38,
        121,
        43,
        237
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "address": "2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y"
        }
      ],
      "args": []
    },
    {
      "name": "adminCancelNoProposal",
      "discriminator": [
        182,
        132,
        189,
        112,
        197,
        249,
        94,
        14
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "address": "2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y"
        }
      ],
      "args": []
    },
    {
      "name": "adminFinalize",
      "discriminator": [
        3,
        58,
        185,
        90,
        3,
        10,
        55,
        224
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "address": "2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y"
        }
      ],
      "args": [
        {
          "name": "winningOutcome",
          "type": "u8"
        }
      ]
    },
    {
      "name": "adminFinalizeNoDisputes",
      "discriminator": [
        45,
        107,
        174,
        133,
        23,
        134,
        229,
        30
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "address": "2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y"
        }
      ],
      "args": []
    },
    {
      "name": "buyShares",
      "discriminator": [
        40,
        239,
        138,
        154,
        8,
        37,
        106,
        108
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "platformWallet",
          "writable": true,
          "address": "6szhvTU23WtiKXqPs8vuX5G7JXu2TcUdVJNByNwVGYMV"
        },
        {
          "name": "creator",
          "writable": true
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        },
        {
          "name": "outcomeIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "claimCreatorFees",
      "discriminator": [
        0,
        23,
        125,
        234,
        156,
        118,
        134,
        89
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "market"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "claimRefund",
      "discriminator": [
        15,
        16,
        30,
        161,
        255,
        228,
        97,
        60
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "claimWinnings",
      "discriminator": [
        161,
        215,
        24,
        59,
        14,
        236,
        242,
        221
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "createMarket",
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "signer": true
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "resolutionTime",
          "type": "i64"
        },
        {
          "name": "outcomeNames",
          "type": {
            "vec": "string"
          }
        },
        {
          "name": "marketType",
          "type": "u8"
        },
        {
          "name": "bLamports",
          "type": "u64"
        },
        {
          "name": "maxPositionBps",
          "type": "u16"
        },
        {
          "name": "maxTradeShares",
          "type": "u64"
        },
        {
          "name": "cooldownSeconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "dispute",
      "discriminator": [
        216,
        92,
        128,
        146,
        202,
        85,
        135,
        73
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "proposeResolution",
      "discriminator": [
        19,
        68,
        181,
        23,
        194,
        146,
        152,
        252
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "market"
          ]
        }
      ],
      "args": [
        {
          "name": "proposedOutcome",
          "type": "u8"
        }
      ]
    },
    {
      "name": "sellShares",
      "discriminator": [
        184,
        164,
        169,
        16,
        231,
        158,
        199,
        196
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "platformWallet",
          "writable": true,
          "address": "6szhvTU23WtiKXqPs8vuX5G7JXu2TcUdVJNByNwVGYMV"
        },
        {
          "name": "creator",
          "writable": true
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        },
        {
          "name": "outcomeIndex",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "userPosition",
      "discriminator": [
        251,
        248,
        209,
        245,
        83,
        234,
        17,
        27
      ]
    }
  ],
  "events": [
    {
      "name": "cancelled",
      "discriminator": [
        136,
        23,
        42,
        65,
        143,
        233,
        234,
        46
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "creatorFeesClaimed",
      "discriminator": [
        189,
        178,
        21,
        181,
        171,
        179,
        131,
        1
      ]
    },
    {
      "name": "disputed",
      "discriminator": [
        186,
        235,
        91,
        209,
        148,
        93,
        152,
        217
      ]
    },
    {
      "name": "finalized",
      "discriminator": [
        4,
        77,
        242,
        80,
        20,
        152,
        247,
        252
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "resolutionProposed",
      "discriminator": [
        209,
        21,
        193,
        193,
        218,
        234,
        131,
        108
      ]
    },
    {
      "name": "tradeExecuted",
      "discriminator": [
        41,
        110,
        64,
        129,
        60,
        79,
        179,
        80
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidOutcomes",
      "msg": "Invalid outcomes"
    },
    {
      "code": 6001,
      "name": "invalidResolutionTime",
      "msg": "Invalid resolution time"
    },
    {
      "code": 6002,
      "name": "invalidB",
      "msg": "Invalid liquidity parameter b"
    },
    {
      "code": 6003,
      "name": "invalidAntiManip",
      "msg": "Invalid anti-manip config"
    },
    {
      "code": 6004,
      "name": "marketClosed",
      "msg": "Market is closed (past end time)"
    },
    {
      "code": 6005,
      "name": "marketResolved",
      "msg": "Market already resolved"
    },
    {
      "code": 6006,
      "name": "marketNotEnded",
      "msg": "Market not ended yet"
    },
    {
      "code": 6007,
      "name": "marketNotResolved",
      "msg": "Market not resolved"
    },
    {
      "code": 6008,
      "name": "invalidState",
      "msg": "Invalid state"
    },
    {
      "code": 6009,
      "name": "tooEarly",
      "msg": "Too early"
    },
    {
      "code": 6010,
      "name": "tooLateToPropose",
      "msg": "Too late to propose"
    },
    {
      "code": 6011,
      "name": "invalidShares",
      "msg": "Invalid shares"
    },
    {
      "code": 6012,
      "name": "invalidOutcomeIndex",
      "msg": "Invalid outcome index"
    },
    {
      "code": 6013,
      "name": "tradeTooLarge",
      "msg": "Trade too large"
    },
    {
      "code": 6014,
      "name": "cooldownActive",
      "msg": "Cooldown active: wait before trading again"
    },
    {
      "code": 6015,
      "name": "positionCapExceeded",
      "msg": "Position cap exceeded for this outcome"
    },
    {
      "code": 6016,
      "name": "notEnoughShares",
      "msg": "Not enough shares to sell"
    },
    {
      "code": 6017,
      "name": "invalidCost",
      "msg": "Invalid cost or refund"
    },
    {
      "code": 6018,
      "name": "insufficientShares",
      "msg": "Insufficient shares"
    },
    {
      "code": 6019,
      "name": "invalidPayout",
      "msg": "Invalid payout"
    },
    {
      "code": 6020,
      "name": "noWinningShares",
      "msg": "No winning shares to claim"
    },
    {
      "code": 6021,
      "name": "invalidSupply",
      "msg": "Invalid supply"
    },
    {
      "code": 6022,
      "name": "alreadyClaimed",
      "msg": "Already claimed"
    },
    {
      "code": 6023,
      "name": "nothingToRefund",
      "msg": "Nothing to refund"
    },
    {
      "code": 6024,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6025,
      "name": "disputeWindowClosed",
      "msg": "Dispute window closed"
    },
    {
      "code": 6026,
      "name": "hasDisputes",
      "msg": "Has disputes; requires admin_finalize"
    },
    {
      "code": 6027,
      "name": "noDispute",
      "msg": "No dispute"
    },
    {
      "code": 6028,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6029,
      "name": "notCancelled",
      "msg": "Market not cancelled"
    },
    {
      "code": 6030,
      "name": "insufficientMarketBalance",
      "msg": "Insufficient market balance"
    },
    {
      "code": 6031,
      "name": "invalidUserPosition",
      "msg": "Invalid user position account"
    },
    {
      "code": 6032,
      "name": "overflow",
      "msg": "overflow"
    }
  ],
  "types": [
    {
      "name": "cancelReason",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "noProposal24h"
          },
          {
            "name": "admin"
          }
        ]
      }
    },
    {
      "name": "cancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": {
              "defined": {
                "name": "cancelReason"
              }
            }
          }
        ]
      }
    },
    {
      "name": "claimKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "winnings"
          },
          {
            "name": "refund"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "claimKind"
              }
            }
          },
          {
            "name": "amountLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeesClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "amountLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "disputed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "disputeCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "finalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "winningOutcome",
            "type": "u8"
          },
          {
            "name": "by",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "resolutionTime",
            "type": "i64"
          },
          {
            "name": "marketType",
            "type": "u8"
          },
          {
            "name": "outcomeCount",
            "type": "u8"
          },
          {
            "name": "bLamports",
            "type": "u64"
          },
          {
            "name": "q",
            "type": {
              "array": [
                "u64",
                10
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "resolved",
            "type": "bool"
          },
          {
            "name": "cancelled",
            "type": "bool"
          },
          {
            "name": "winningOutcome",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "proposedOutcome",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "proposedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "contestDeadline",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "disputeCount",
            "type": "u32"
          },
          {
            "name": "maxPositionBps",
            "type": "u16"
          },
          {
            "name": "maxTradeShares",
            "type": "u64"
          },
          {
            "name": "cooldownSeconds",
            "type": "i64"
          },
          {
            "name": "creatorFeeEscrow",
            "type": "u64"
          },
          {
            "name": "outcomeNames",
            "type": {
              "vec": "string"
            }
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "resolutionTime",
            "type": "i64"
          },
          {
            "name": "marketType",
            "type": "u8"
          },
          {
            "name": "outcomeCount",
            "type": "u8"
          },
          {
            "name": "bLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "proposed"
          },
          {
            "name": "finalized"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "resolutionProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "proposedOutcome",
            "type": "u8"
          },
          {
            "name": "proposedAt",
            "type": "i64"
          },
          {
            "name": "contestDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tradeExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "isBuy",
            "type": "bool"
          },
          {
            "name": "outcomeIndex",
            "type": "u8"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "amountLamports",
            "type": "u64"
          },
          {
            "name": "platformFeeLamports",
            "type": "u64"
          },
          {
            "name": "creatorFeeLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "userPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": {
              "array": [
                "u64",
                10
              ]
            }
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "lastTradeTs",
            "type": "i64"
          },
          {
            "name": "netCostLamports",
            "type": "i128"
          }
        ]
      }
    }
  ]
};
