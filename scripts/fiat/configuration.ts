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
      pair: '0xae461ca67b15dc8dc81ce7615e0320da1a9ab8d5', // DAI-USDC Pair address
      token0priceFeeds: ['0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'], // DAI/USD feed
      token1priceFeeds: ['0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'], // USDC/USD feed
      targetName: ethers.utils.formatBytes32String('USD'), // Name of target unit in bytes format
      oracleTimeout: 86400n, // Seconds that an oracle value is considered valid
      fallbackPrice: 1n * 10n ** 18n, // Price given when price computation reverts
      maxTradeVolume: 1000000n, // The max trade volume, in UoA
      defaultThreshold: 5n * 10n ** 16n, // A value like 0.05 that represents a deviation tolerance
      delayUntilDefault: 86400n, // The number of seconds deviation must occur before default
    },
  },
}
