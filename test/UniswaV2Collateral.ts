import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { deployCollateral } from './fixtures'
import { USDC_ETH_PAIR, USDC_USD_FEED } from './helpers'

describe('UniswapV2Collateral', () => {
  describe('totalLiquidity', () => {
    it('returns value of total liquidity of the pair', async () => {
      const collateralA = await deployCollateral()
      // Should equal $7,184,249.72 which is total liquidity of WBTC-ETH pair
      expect(await collateralA.totalLiquidity()).to.eq(7184249723972242054325288n)

      const collateralB = await deployCollateral({
        pair: USDC_ETH_PAIR,
        token0priceFeed: USDC_USD_FEED,
      })
      // Should equal $84,634,138.11 which is total liquidity of WBTC-ETH pair
      expect(await collateralB.totalLiquidity()).to.eq(84634138115718441828431798n)
    })
  })

  describe('lpTokenPrice', () => {
    it('returns price per LP Token', async () => {})
  })
})
