import { expect } from 'chai'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import hre, { ethers } from 'hardhat'
import { makeReserveProtocol, deployCollateral } from './fixtures'
import {
  COMP,
  RSR,
  MAX_TRADE_VOL,
  USDC_ETH_PAIR,
  USDC_USD_FEED,
  WBTC,
  WETH,
  WBTC_ETH_PAIR,
  WBTC_HOLDER,
  FIX_ONE,
  exp,
  UNISWAP_ROUTER,
  WBTC_ETH_HOLDER,
  whileImpersonating,
  allocateERC20,
  WBTC_BTC_FEED,
  CollateralStatus,
  resetFork,
} from './helpers'

describe('UniswapV2NonFiatLPCollateral', () => {
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
      // Price per LP Token in USD is roughly at $1,101,270,336.11 Can be verified by
      // dividing Value by Quantity of holdings here https://etherscan.io/token/0xbb2b8038a1640196fbe3e38816f3e67cba72d940#balances.
      expect(await collateralA.strictPrice()).to.eq(1101270336107664418226494539n)

      const collateralB = await deployCollateral({
        pair: USDC_ETH_PAIR,
        token0priceFeeds: [USDC_USD_FEED],
      })
      expect(await collateralB.strictPrice()).to.eq(146456739000923443614846591n)
    })

    it('price changes as token0 and token1 prices change', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed1 = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const chainlinkFeed2 = await MockV3AggregatorFactory.deploy(6, exp(1, 6))

      const collateral = await deployCollateral({
        token0priceFeeds: [chainlinkFeed1.address],
        token1priceFeeds: [chainlinkFeed2.address],
      })
      let prevPrice = await collateral.strictPrice()

      await chainlinkFeed1.updateAnswer(exp(2, 6))
      let newPrice = await collateral.strictPrice()
      expect(newPrice).to.be.gt(prevPrice)
      prevPrice = newPrice

      await chainlinkFeed2.updateAnswer(exp(2, 6))
      newPrice = await collateral.strictPrice()
      expect(newPrice).to.be.gt(prevPrice)
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

    it('reverts if token0 price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        token0priceFeeds: [chainlinkFeed.address],
      })

      // Set price of USDC to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts if token1 price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        token1priceFeeds: [chainlinkFeed.address],
      })

      // Set price of USDC to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts in case of invalid timestamp', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        token0priceFeeds: [chainlinkFeed.address],
      })
      await chainlinkFeed.setInvalidTimestamp()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  describe('status', () => {
    it('maintains status in normal situations', async () => {
      const collateral = await deployCollateral()
      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Force updates (with no changes)
      await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')

      // State remains the same
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)
    })

    it('hard-defaults when refPerTok() decreases', async () => {
      const PairMockFactory = await ethers.getContractFactory('PairMock')
      const pairMock = await PairMockFactory.deploy(
        WBTC,
        WETH,
        exp(10_000, 8),
        exp(10_000, 18),
        exp(1_000, 18)
      )
      const collateral = await deployCollateral({ pair: pairMock.address })

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
      // State remains the same
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Set reserves to 0
      await pairMock.setReserves(0, 0)

      // Collateral defaults due to refPerTok() going down
      await expect(collateral.refresh()).to.emit(collateral, 'DefaultStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(await time.latest())
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
      ).to.changeEtherBalance(swapper.address, `-${exp(100, 18)}`)

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
        ).to.changeTokenBalance(wbtcEthLp, WBTC_ETH_HOLDER, `-${balance}`)
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
      ).to.changeTokenBalance(wbtcEthLp, swapper.address, `-${balance}`)

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
    })
  })
})

describe('integration with reserve protocol', () => {
  beforeEach(resetFork)

  it('sets up assets', async () => {
    const { compAsset, compToken, rsrAsset, rsr } = await makeReserveProtocol()
    // COMP Token
    expect(await compAsset.isCollateral()).to.equal(false)
    expect(await compAsset.erc20()).to.equal(COMP)
    expect(compToken.address).to.equal(COMP)
    expect(await compToken.decimals()).to.equal(18)
    expect(await compAsset.strictPrice()).to.be.closeTo(exp(38, 18), exp(1, 17)) // Close to $38 USD - Nov 2022
    expect(await compAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOL)

    // RSR Token
    expect(await rsrAsset.isCollateral()).to.equal(false)
    expect(await rsrAsset.erc20()).to.equal(ethers.utils.getAddress(RSR))
    expect(rsr.address).to.equal(RSR)
    expect(await rsr.decimals()).to.equal(18)
    expect(await rsrAsset.strictPrice()).to.be.closeTo(exp(418, 13), exp(1, 13)) // Close to $0.0041
    expect(await rsrAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOL)
  })

  it('sets up collateral', async () => {
    const { collateral } = await makeReserveProtocol()
    const [bob] = await ethers.getSigners()

    expect(await collateral.isCollateral()).to.equal(true)
    expect(await collateral.erc20()).to.equal(ethers.utils.getAddress(WBTC_ETH_PAIR))
    expect(await collateral.targetName()).to.equal(
      ethers.utils.formatBytes32String('UNIV2SQRTBTCETH')
    )
    expect(await collateral.targetPerRef()).to.eq(FIX_ONE)
    expect(await collateral.strictPrice()).to.eq(1101270336107664418226494539n)
    expect(await collateral.maxTradeVolume()).to.eq(MAX_TRADE_VOL)
  })

  it('registers ERC20s and Assets/Collateral', async () => {
    const { collateral, assetRegistry, rTokenAsset, rsrAsset, compAsset } =
      await makeReserveProtocol()
    // Check assets/collateral
    const ERC20s = await assetRegistry.erc20s()

    expect(ERC20s[0]).to.equal(await rTokenAsset.erc20())
    expect(ERC20s[1]).to.equal(await rsrAsset.erc20())
    expect(ERC20s[2]).to.equal(await compAsset.erc20())
    expect(ERC20s[3]).to.equal(await collateral.erc20())

    // Assets
    expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(collateral.address)
    // Collaterals
    expect(await assetRegistry.toColl(ERC20s[3])).to.equal(collateral.address)
  })

  it('registers simple basket', async () => {
    const { rToken, rTokenAsset, basketHandler, facade, facadeTest } = await makeReserveProtocol()
    const [bob] = await ethers.getSigners()

    // Basket
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    const backing = await facade.basketTokens(rToken.address)
    expect(backing[0]).to.equal(ethers.utils.getAddress(WBTC_ETH_PAIR))
    expect(backing.length).to.equal(1)

    // Check other values
    expect(await basketHandler.nonce()).to.be.gt(0n)
    expect(await basketHandler.timestamp()).to.be.gt(0n)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    const [isFallback, price] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    // $8,909.10 is price of target unit
    expect(price).to.eq(8909100654425313158131n)

    const wbtcEthLp = await ethers.getContractAt('UniswapV2Pair', WBTC_ETH_PAIR)
    await whileImpersonating(WBTC_ETH_HOLDER, async (signer) => {
      const balance = await wbtcEthLp.balanceOf(signer.address)
      await wbtcEthLp.connect(signer).transfer(bob.address, balance)
    })
    const issueAmount = exp(1, 18)
    await wbtcEthLp.approve(rToken.address, ethers.constants.MaxUint256)
    expect(await rToken.issue(issueAmount)).to.emit(rToken, 'Issuance')
    expect(await rToken.balanceOf(bob.address)).to.equal(issueAmount)

    expect(await rTokenAsset.strictPrice()).eq(price)
  })

  it('issues/reedems with simple basket', async function () {
    const { rToken, collateral, facadeTest, backingManager, basketHandler } =
      await makeReserveProtocol()
    const [bob] = await ethers.getSigners()

    const wbtcEthLp = await ethers.getContractAt('UniswapV2Pair', WBTC_ETH_PAIR)

    await whileImpersonating(WBTC_ETH_HOLDER, async (signer) => {
      const balance = await wbtcEthLp.balanceOf(signer.address)
      await wbtcEthLp.connect(signer).transfer(bob.address, balance)
    })
    await wbtcEthLp.approve(rToken.address, ethers.constants.MaxUint256)

    const lpTokenTransferred = (await basketHandler.quantity(wbtcEthLp.address)).toBigInt() * 2n // Issued 2 units of RToken
    const oldLpBalance = (await wbtcEthLp.balanceOf(bob.address)).toBigInt()

    // Check rToken is issued
    const issueAmount = exp(2, 18)
    await expect(await rToken.issue(issueAmount)).to.changeTokenBalance(rToken, bob, issueAmount)
    // Check LP tokens transferred for RToken issuance
    expect(await wbtcEthLp.balanceOf(bob.address)).to.eq(oldLpBalance - lpTokenTransferred)

    // Check asset value
    // Approx $17,818 in value. The backing manager only has collateral tokens.
    const expectedValue = (await collateral.bal(backingManager.address))
      .mul(await collateral.strictPrice())
      .div(FIX_ONE)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.eq(expectedValue)

    // Redeem Rtokens
    // We are within the limits of redemption battery (500 RTokens)
    await expect(rToken.connect(bob).redeem(issueAmount)).changeTokenBalance(
      rToken,
      bob,
      `-${issueAmount}`
    )

    // Check balances after - Backing Manager is empty
    expect(await wbtcEthLp.balanceOf(backingManager.address)).to.eq(0)

    // Check funds returned to user
    expect(await wbtcEthLp.balanceOf(bob.address)).to.eq(oldLpBalance)

    // Check asset value left
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.eq(0)
  })

  // it('claims rewards - COMP', async () => {
  //   const { cusdcV3, usdc, rToken, backingManager, wcusdcV3, compToken } =
  //     await makeReserveProtocol()
  //   const [_, bob] = await ethers.getSigners()

  //   // Try to claim rewards at this point - Nothing for Backing Manager
  //   expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
  //   await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

  //   // No rewards so far
  //   expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

  //   await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
  //   const wcusdcV3AsB = wcusdcV3.connect(bob)
  //   await wcusdcV3AsB.approve(rToken.address, ethers.constants.MaxUint256)

  //   // Issue RTokens
  //   const issueAmount = exp(10_000, 18)
  //   await expect(rToken.connect(bob).issue(issueAmount)).to.emit(rToken, 'Issuance')
  //   expect(await wcusdcV3.balanceOf(backingManager.address)).to.be.gt(0)

  //   // Check RTokens issued to user
  //   expect(await rToken.balanceOf(bob.address)).to.equal(issueAmount)

  //   // Now we can claim rewards - check initial balance still 0
  //   expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
  //   await time.increase(1000)
  //   await enableRewardsAccrual(cusdcV3)

  //   // Claim rewards
  //   await expect(await backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

  //   // Check rewards both in COMP
  //   const rewardsCOMP1 = await compToken.balanceOf(backingManager.address)
  //   expect(rewardsCOMP1).to.be.gt(0)

  //   await time.increase(3600)
  //   // Get additional rewards
  //   await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

  //   const rewardsCOMP2 = await compToken.balanceOf(backingManager.address)
  //   expect(rewardsCOMP2).to.be.gt(rewardsCOMP1)
  // })
})
