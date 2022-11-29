import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { UniswapV2LPCollateral, UniswapV2LPCollateral__factory } from '../typechain-types'

const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
const UNISWAP_V2_WBTC_PAIR = '0xbb2b8038a1640196fbe3e38816f3e67cba72d940'
const ORACLE_TIMEOUT = 86400n // 24 hours in seconds
const DEFAULT_THRESHOLD = 5n * 10n ** 16n // 0.05
const DELAY_UNTIL_DEFAULT = 86400n
const MAX_TRADE_VOL = 1000000n
const FIX_ONE = 1n * 10n ** 18n

const BTC_USD = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'
const ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'

const opts = {
  pair: UNISWAP_V2_WBTC_PAIR,
  token0priceFeed: BTC_USD,
  token1priceFeed: ETH_USD,
  targetName: ethers.utils.formatBytes32String('USD'),
  oracleTimeout: ORACLE_TIMEOUT,
  fallbackPrice: FIX_ONE,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  reservesThresholdIffy: 10000n,
  reservesThresholdDisabled: 5000n,
}

describe('UniswapV2Collateral', () => {
  describe('totalLiquidity', () => {
    it('returns value of total liquidity of the pair', async () => {
      const UniswapV2CollateralFactory = <UniswapV2LPCollateral__factory>(
        await ethers.getContractFactory('UniswapV2LPCollateral')
      )
      const collateral = <UniswapV2LPCollateral>await UniswapV2CollateralFactory.deploy(opts)

      // Should equal $7,184,249.72
      expect(await collateral.totalLiquidity()).to.eq(7184249723972242054325288n)
    })
  })
})
