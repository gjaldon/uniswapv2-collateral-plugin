import { expect } from 'chai'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { ethers } from 'hardhat'
import { makeReserveProtocol, deployCollateral } from './fixtures/fiat'
import {
  UNI,
  COMP,
  RSR,
  MAX_TRADE_VOL,
  WBTC,
  WETH,
  FIX_ONE,
  exp,
  UNISWAP_ROUTER,
  whileImpersonating,
  WBTC_BTC_FEED,
  CollateralStatus,
  resetFork,
  DAI_USDT_PAIR,
  USDT_USD_FEED,
  DAI,
  USDC,
  DAI_HOLDER,
  DAI_USDC_PAIR,
  DAI_USDC_HOLDER,
  ETH_USD_FEED,
} from './helpers'
import { MockV3Aggregator, MockV3Aggregator__factory } from '../typechain-types'

describe('UniswapV2FiatLPCollateral', () => {
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

  describe('getPeg', () => {
    it('returns 1 when target peg is fiat', async () => {
      // We pass Zero Address as target feed if we want to target fiat as peg
      const collateral = await deployCollateral({ targetFeed: ethers.constants.AddressZero })

      expect(await collateral.getPeg()).to.eq(FIX_ONE)
    })

    it('returns price of ether when target peg is ether', async () => {
      // We pass the Price Feed if we want to target any non-fiat as peg
      const collateral = await deployCollateral({ targetFeed: ETH_USD_FEED })

      expect(await collateral.getPeg()).to.eq(1209809600000000000000n)
    })
  })

  describe('totalReservesPrice', () => {
    it('returns value of total liquidity of the pair', async () => {
      const collateralA = await deployCollateral()
      // Should equal $34,575,106.26 which is total liquidity of DAI-USDC pair
      expect(await collateralA.totalLiquidity()).to.eq(34575106261841690084139295n)

      const collateralB = await deployCollateral({
        pair: DAI_USDT_PAIR,
        token1priceFeeds: [USDT_USD_FEED],
      })

      // Should equal $6,812,202.93 which is total liquidity of WBTC-ETH pair
      expect(await collateralB.totalLiquidity()).to.eq(6812202930942865233307666n)
    })
  })

  describe('prices', () => {
    it('returns price per LP Token', async () => {
      const collateralA = await deployCollateral()
      // Price per LP Token in USD is roughly at $2,251,158.89 Can be verified by
      // dividing Value by Quantity of holdings here https://etherscan.io/token/0xae461ca67b15dc8dc81ce7615e0320da1a9ab8d5#balances.
      expect(await collateralA.strictPrice()).to.eq(2252839994825176096892924n)

      const collateralB = await deployCollateral({
        pair: DAI_USDT_PAIR,
        token0priceFeeds: [USDT_USD_FEED],
      })

      // Price per LP Token in USD is roughly at $2,299,257.49 Can be verified by
      // dividing Value by Quantity of holdings here https://etherscan.io/token/0xb20bd5d04be54f870d5c0d3ca85d82b34b836405#balances.
      expect(await collateralB.strictPrice()).to.eq(2299257495041926311893479n)
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

      const dai = await ethers.getContractAt('ERC20', DAI)
      const uniswapRouter = await ethers.getContractAt('UniswapV2Router02', UNISWAP_ROUTER)
      await dai.approve(uniswapRouter.address, ethers.constants.MaxUint256)

      await whileImpersonating(DAI_HOLDER, async (signer) => {
        const balance = await dai.balanceOf(signer.address)
        await dai.connect(signer).transfer(swapper.address, balance)
      })

      await expect(
        uniswapRouter.swapExactTokensForTokens(
          exp(100_000, 18),
          exp(99_000, 6),
          [DAI, USDC],
          swapper.address,
          ethers.constants.MaxUint256
        )
      ).to.changeTokenBalance(dai, swapper.address, `-${exp(100_000, 18)}`)

      let newPrice = await collateral.strictPrice()
      expect(prevPrice).to.be.lt(newPrice)
      prevPrice = newPrice

      const usdc = await ethers.getContractAt('ERC20', USDC)
      await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256)
      const usdcBalance = await usdc.balanceOf(swapper.address)
      await expect(
        uniswapRouter.swapExactTokensForTokens(
          usdcBalance,
          exp(99_000, 18),
          [USDC, DAI],
          swapper.address,
          ethers.constants.MaxUint256
        )
      ).to.changeTokenBalance(usdc, swapper.address, `-${usdcBalance}`)

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

    it('recovers from soft-default', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const daiMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        token0priceFeeds: [daiMockFeed.address],
      })

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await daiMockFeed.updateAnswer(exp(8, 17))

      await expect(collateral.refresh())
        .to.emit(collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

      // DAI:USD peg recovers back to 1:1
      await daiMockFeed.updateAnswer(exp(1, 18))

      // Collateral becomes sound again because peg has recovered
      await expect(collateral.refresh())
        .to.emit(collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('soft-defaults when token0 depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const daiMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        token0priceFeeds: [daiMockFeed.address],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await daiMockFeed.updateAnswer(exp(8, 17))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when token1 depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const usdcMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        token1priceFeeds: [usdcMockFeed.address],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await usdcMockFeed.updateAnswer(exp(8, 5))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when token1 depegs from token0 beyond threshold', async () => {
      const PairMockFactory = await ethers.getContractFactory('PairMock')
      const pairMock = await PairMockFactory.deploy(
        DAI,
        USDC,
        exp(10_000, 18),
        exp(10_000, 6),
        exp(1_000, 18)
      )
      const collateral = await deployCollateral({
        pair: pairMock.address,
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USDC - Set ratio of DAI reserves to USDC reserves 1:0.8
      await pairMock.setReserves(exp(20_000, 18), exp(16_000, 6))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })
  })

  describe('refPerTok', () => {
    // Swaps and huge swings on liquidity should not decrease refPerTok
    it('is mostly increasing', async () => {
      const collateral = await deployCollateral()
      let prevRefPerTok = await collateral.refPerTok()
      const [swapper] = await ethers.getSigners()
      const daiUsdcLp = await ethers.getContractAt('UniswapV2Pair', DAI_USDC_PAIR)

      const dai = await ethers.getContractAt('ERC20', DAI)
      await dai.approve(UNISWAP_ROUTER, ethers.constants.MaxUint256)
      await whileImpersonating(DAI_HOLDER, async (signer) => {
        const balance = await dai.balanceOf(signer.address)
        await dai.connect(signer).transfer(swapper.address, balance)
      })

      const uniswapRouter = await ethers.getContractAt('UniswapV2Router02', UNISWAP_ROUTER)
      await expect(
        uniswapRouter.swapExactTokensForTokens(
          exp(100_000, 18),
          exp(99_000, 6),
          [DAI, USDC],
          swapper.address,
          ethers.constants.MaxUint256
        )
      ).to.changeTokenBalance(dai, swapper.address, `-${exp(100_000, 18)}`)

      let newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      // Remove 95% of Liquidity. DAI_USDC_HOLDER ~95% of the supply of WBTC-ETH LP token
      await whileImpersonating(DAI_USDC_HOLDER, async (signer) => {
        const balance = await daiUsdcLp.balanceOf(signer.address)
        await daiUsdcLp.connect(signer).approve(uniswapRouter.address, ethers.constants.MaxUint256)
        await expect(
          uniswapRouter
            .connect(signer)
            .removeLiquidity(DAI, USDC, balance, 0, 0, swapper.address, ethers.constants.MaxUint256)
        ).to.changeTokenBalance(daiUsdcLp, DAI_USDC_HOLDER, `-${balance}`)
      })

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      const usdc = await ethers.getContractAt('ERC20', USDC)
      await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256)

      await expect(
        uniswapRouter.addLiquidity(
          DAI,
          USDC,
          exp(15_000_000, 18),
          exp(15_000_000, 6),
          0,
          0,
          swapper.address,
          ethers.constants.MaxUint256
        )
      ).to.changeTokenBalance(dai, swapper.address, `-${exp(15_000_000, 18)}`)

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
    })
  })

  describe('claim rewards', () => {
    it('does not revert', async () => {
      const collateral = await deployCollateral()

      await expect(collateral.claimRewards()).to.not.be.reverted
    })

    it('is a noop and does not claim any rewards', async () => {
      const collateral = await deployCollateral()
      const [bob] = await ethers.getSigners()
      const uni = await ethers.getContractAt('ERC20', UNI)

      await expect(collateral.claimRewards()).to.changeTokenBalance(uni, bob, 0)
    })
  })
})

describe('UniswapV2FiatLPCollateral integration with reserve protocol', () => {
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
    expect(await collateral.isCollateral()).to.equal(true)
    expect(await collateral.erc20()).to.equal(ethers.utils.getAddress(DAI_USDC_PAIR))
    expect(await collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
    expect(await collateral.targetPerRef()).to.eq(FIX_ONE)
    expect(await collateral.strictPrice()).to.eq(2252839994825176096892924n)
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
    expect(backing[0]).to.equal(ethers.utils.getAddress(DAI_USDC_PAIR))
    expect(backing.length).to.equal(1)

    // Check other values
    expect(await basketHandler.nonce()).to.be.gt(0n)
    expect(await basketHandler.timestamp()).to.be.gt(0n)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    const [isFallback, price] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    // $1.99 is price of target unit
    expect(price).to.eq(1999729779296468928n)
    expect(await rTokenAsset.strictPrice()).eq(price)
  })

  it('issues/reedems with simple basket', async function () {
    const { rToken, collateral, facadeTest, backingManager, basketHandler } =
      await makeReserveProtocol()
    const [bob] = await ethers.getSigners()

    const daiUsdcLp = await ethers.getContractAt('UniswapV2Pair', DAI_USDC_PAIR)

    await whileImpersonating(DAI_USDC_HOLDER, async (signer) => {
      const balance = await daiUsdcLp.balanceOf(signer.address)
      await daiUsdcLp.connect(signer).transfer(bob.address, balance)
    })
    await daiUsdcLp.approve(rToken.address, ethers.constants.MaxUint256)

    const lpTokenTransferred = (await basketHandler.quantity(daiUsdcLp.address)).toBigInt() * 2n // Issued 2 units of RToken
    const oldLpBalance = (await daiUsdcLp.balanceOf(bob.address)).toBigInt()

    // Check rToken is issued
    const issueAmount = exp(2, 18)
    await expect(await rToken.issue(issueAmount)).to.changeTokenBalance(rToken, bob, issueAmount)
    // Check LP tokens transferred for RToken issuance
    expect(await daiUsdcLp.balanceOf(bob.address)).to.eq(oldLpBalance - lpTokenTransferred)

    // Check asset value
    // Approx $3.99 in value. The backing manager only has collateral tokens.
    const expectedValue = (await collateral.bal(backingManager.address))
      .mul(await collateral.strictPrice())
      .div(FIX_ONE)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      expectedValue,
      1
    )

    // Redeem Rtokens
    // We are within the limits of redemption battery (500 RTokens)
    await expect(rToken.connect(bob).redeem(issueAmount)).changeTokenBalance(
      rToken,
      bob,
      `-${issueAmount}`
    )

    // Check balances after - Backing Manager is empty
    expect(await daiUsdcLp.balanceOf(backingManager.address)).to.eq(0)

    // Check funds returned to user
    expect(await daiUsdcLp.balanceOf(bob.address)).to.eq(oldLpBalance)

    // Check asset value left
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.eq(0)
  })
})
