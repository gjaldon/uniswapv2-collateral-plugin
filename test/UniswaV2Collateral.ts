import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { deployCollateral } from './fixtures'
import {
  USDC_ETH_PAIR,
  USDC_USD_FEED,
  WBTC,
  WETH,
  WBTC_ETH_PAIR,
  WBTC_HOLDER,
  exp,
  UNISWAP_ROUTER,
  WBTC_ETH_HOLDER,
  whileImpersonating,
  allocateERC20,
} from './helpers'

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
    it('returns price per LP Token', async () => {
      const collateralA = await deployCollateral()
      expect(await collateralA.lpTokenPrice()).to.eq(1103289836n)

      const collateralB = await deployCollateral({
        pair: USDC_ETH_PAIR,
        token0priceFeed: USDC_USD_FEED,
      })
      expect(await collateralB.lpTokenPrice()).to.eq(146456739n)
    })
  })

  describe('refPerTok', () => {
    // Swaps and huge swings on liquidity should not decrease refPerTok
    it('is mostly increasing', async () => {
      const collateral = await deployCollateral()
      let prevRefPerTok = await collateral.refPerTok()
      const [swapper] = await ethers.getSigners()
      const wbtcEthLp = await ethers.getContractAt('UniswapV2Pair', WBTC_ETH_PAIR)

      const weth = await ethers.getContractAt('ERC20', WETH)
      await weth.approve(UNISWAP_ROUTER, ethers.constants.MaxUint256)
      const wbtc = await ethers.getContractAt('ERC20', WBTC)

      const uniswapRouter = await ethers.getContractAt('UniswapV2Router02', UNISWAP_ROUTER)
      await expect(
        uniswapRouter.swapExactETHForTokens(
          0,
          [WETH, WBTC],
          swapper.address,
          ethers.constants.MaxUint256,
          { value: ethers.utils.parseUnits('100', 'ether') }
        )
      ).to.changeTokenBalance(wbtc, swapper.address, 709234160)

      let newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      // Remove 21% of Liquidity. WBTC_ETH_HOLDER ~21% of the supply of WBTC-ETH LP token
      await whileImpersonating(WBTC_ETH_HOLDER, async (signer) => {
        const balance = await wbtcEthLp.balanceOf(signer.address)
        await wbtcEthLp.connect(signer).approve(uniswapRouter.address, ethers.constants.MaxUint256)
        await expect(
          uniswapRouter
            .connect(signer)
            .removeLiquidity(
              WBTC,
              WETH,
              balance,
              0,
              0,
              swapper.address,
              ethers.constants.MaxUint256
            )
        ).to.changeTokenBalance(wbtcEthLp, WBTC_ETH_HOLDER, '-1385599119907813')
      })

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      // Add huge liquidity that will make up ~94% of the LP's liquidity
      await hre.network.provider.request({
        method: 'hardhat_setBalance',
        params: [
          swapper.address,
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        ],
      })

      await allocateERC20(WBTC, WBTC_HOLDER, swapper.address, exp(3000, 8))
      await wbtc.approve(uniswapRouter.address, ethers.constants.MaxUint256)

      await expect(
        uniswapRouter.addLiquidityETH(
          WBTC,
          exp(3_000, 8),
          0,
          0,
          swapper.address,
          ethers.constants.MaxUint256,
          {
            value: exp(100_000, 18),
          }
        )
      ).to.changeTokenBalance(wbtc, swapper.address, `-${exp(3_000, 8)}`)

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      // Remove ~94% of liquidity
      const balance = await wbtcEthLp.balanceOf(swapper.address)
      await wbtcEthLp.approve(uniswapRouter.address, ethers.constants.MaxUint256)
      await expect(
        uniswapRouter.removeLiquidity(
          WBTC,
          WETH,
          balance,
          0,
          0,
          swapper.address,
          ethers.constants.MaxUint256
        )
      ).to.changeTokenBalance(wbtcEthLp, swapper.address, '-92509713574577611')

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
    })
  })
})
