import { ethers } from 'hardhat'

interface NetworkConfig {
  collateralOpts: CollateralOptsConfig
  oracleLib?: string // Address of OracleLib. Set this if you want to use an existing deployment of OracleLib.
}

interface CollateralOptsConfig {
  pair: string
  token0priceFeeds: string[]
  token1priceFeeds: string[]
  targetName: string
  oracleTimeout: bigint
  fallbackPrice: bigint
  maxTradeVolume: bigint
  defaultThreshold: bigint
  delayUntilDefault: bigint
}

export const networkConfig: { [key: string]: NetworkConfig } = {
  mainnet: {
    // mainnet settings
    collateralOpts: {
      pair: '0xbb2b8038a1640196fbe3e38816f3e67cba72d940', // WBTC-ETH Pair address
      token0priceFeeds: [
        '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23',
        '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      ], // WBTC/BTC and BTC/USD feeds
      token1priceFeeds: ['0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'], // ETH/USD feed
      targetName: ethers.utils.formatBytes32String('UNIV2SQRTWBTCETH'), // Name of target unit in bytes format
      oracleTimeout: 86400n, // Seconds that an oracle value is considered valid
      fallbackPrice: 1n * 10n ** 18n, // Price given when price computation reverts
      maxTradeVolume: 1000000n, // The max trade volume, in UoA
      defaultThreshold: 5n * 10n ** 16n, // A value like 0.05 that represents a deviation tolerance
      delayUntilDefault: 86400n, // The number of seconds deviation must occur before default
    },
  },
}
