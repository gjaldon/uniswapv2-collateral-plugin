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
  WBTC_BTC_FEED,
} from './helpers'

describe('UniswapV2Collateral', () => {
  describe('constructor validation', () => {
    it('validates targetName', async () => {
      await expect(deployCollateral({ targetName: ethers.constants.HashZero })).to.be.revertedWith(
        'targetName missing'
      )
    })

    it('does not allow missing pair address', async () => {
      await expect(deployCollateral({ pair: ethers.constants.AddressZero })).to.be.revertedWith(
        'missing pair address'
      )
    })

    it('does not allow missing token0priceFeeds', async () => {
      await expect(deployCollateral({ token0priceFeeds: [] })).to.be.revertedWith(
        'missing token0 price feed'
      )
    })

    it('does not allow more than 3 token0priceFeeds', async () => {
      await expect(
        deployCollateral({
          token0priceFeeds: [WBTC_BTC_FEED, WBTC_BTC_FEED, WBTC_BTC_FEED, WBTC_BTC_FEED],
        })
      ).to.be.revertedWith('token0 price feeds limited to 3')
    })

    it('does not allow missing token1priceFeed', async () => {
      await expect(deployCollateral({ token1priceFeeds: [] })).to.be.revertedWith(
        'missing token1 price feed'
      )
    })

    it('does not allow more than 3 token1priceFeeds', async () => {
      await expect(
        deployCollateral({
          token1priceFeeds: [WBTC_BTC_FEED, WBTC_BTC_FEED, WBTC_BTC_FEED, WBTC_BTC_FEED],
        })
      ).to.be.revertedWith('token1 price feeds limited to 3')
    })

    it('max trade volume must be greater than zero', async () => {
      await expect(deployCollateral({ maxTradeVolume: 0n })).to.be.revertedWith(
        'invalid max trade volume'
      )
    })

    it('does not allow oracle timeout at 0', async () => {
      await expect(deployCollateral({ oracleTimeout: 0n })).to.be.revertedWith('oracleTimeout zero')
    })

    it('does not allow missing defaultThreshold', async () => {
      await expect(deployCollateral({ defaultThreshold: 0n })).to.be.revertedWith(
        'defaultThreshold zero'
      )
    })

    it('does not allow missing delayUntilDefault', async () => {
      await expect(deployCollateral({ delayUntilDefault: 0n })).to.be.revertedWith(
        'delayUntilDefault zero'
      )
    })
  })

  describe('totalLiquidity', () => {
    it('returns value of total liquidity of the pair', async () => {
      const collateralA = await deployCollateral()
      // Should equal $7,184,249.72 which is total liquidity of WBTC-ETH pair
      expect(await collateralA.totalLiquidity()).to.eq(7171099424319952054325288n)

      const collateralB = await deployCollateral({
        pair: USDC_ETH_PAIR,
        token0priceFeeds: [USDC_USD_FEED],
      })

      // Should equal $84,634,138.11 which is total liquidity of WBTC-ETH pair
      expect(await collateralB.totalLiquidity()).to.eq(84634138115718441828431798n)
    })
  })

  describe('prices', () => {
    it('returns price per LP Token', async () => {
      const collateralA = await deployCollateral()
      // Price per LP Token in USD is roughly at $1,103,289.84. Can be verified by
      // dividing Value by Quantity of holdings here https://etherscan.io/token/0xbb2b8038a1640196fbe3e38816f3e67cba72d940#balances.
      expect(await collateralA.strictPrice()).to.eq(1101270336107664418226494539n)

      const collateralB = await deployCollateral({
        pair: USDC_ETH_PAIR,
        token0priceFeeds: [USDC_USD_FEED],
      })
      expect(await collateralB.strictPrice()).to.eq(146456739000923443614846591n)
    })

    it('price changes as ETH and BTC prices change', async () => {
      const collateral = await deployCollateral()
      const [swapper] = await ethers.getSigners()
      let prevPrice = await collateral.strictPrice()

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
      ).to.changeEtherBalance(swapper.address, `-${exp(100, 18)}`)

      expect(prevPrice).to.be.lt(await collateral.strictPrice())
    })

    it('price changes as swaps occur', async () => {
      const collateral = await deployCollateral()
      const [swapper] = await ethers.getSigners()
      let prevPrice = await collateral.strictPrice()

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
      ).to.changeEtherBalance(swapper.address, `-${exp(100, 18)}`)

      let newPrice = await collateral.strictPrice()
      expect(prevPrice).to.be.lt(newPrice)
      prevPrice = newPrice

      await wbtc.approve(uniswapRouter.address, ethers.constants.MaxUint256)
      const wbtcBalance = await wbtc.balanceOf(swapper.address)
      await expect(
        uniswapRouter.swapExactTokensForETH(
          wbtcBalance,
          0,
          [WBTC, WETH],
          swapper.address,
          ethers.constants.MaxUint256
        )
      ).to.changeTokenBalance(wbtc, swapper.address, `-${wbtcBalance}`)

      newPrice = await collateral.strictPrice()
      expect(prevPrice).to.be.gt(newPrice)
    })

    it('reverts if price is zero', async () => {
      //   const { collateral, chainlinkFeed } = await loadFixture(makeCollateral())
      //   // Set price of USDC to 0
      //   const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      //   await updateAnswerTx.wait()
      //   // Check price of token
      //   await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
      //     collateral,
      //     'PriceOutsideRange'
      //   )
      //   // Fallback price is returned
      //   const [isFallback, price] = await collateral.price(true)
      //   expect(isFallback).to.equal(true)
      //   expect(price).to.equal(await collateral.fallbackPrice())
      //   // When refreshed, sets status to Unpriced
      //   await collateral.refresh()
      //   expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      // })
      // it('reverts in case of invalid timestamp', async () => {
      //   const { collateral, chainlinkFeed } = await loadFixture(makeCollateral())
      //   await chainlinkFeed.setInvalidTimestamp()
      //   // Check price of token
      //   await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')
      //   // When refreshed, sets status to Unpriced
      //   await collateral.refresh()
      //   expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
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
