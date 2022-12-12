import { ethers } from 'hardhat'
import {
  MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  FIX_ONE,
  WBTC_ETH_PAIR,
  WBTC_BTC_FEED,
  BTC_USD_FEED,
  ETH_USD_FEED,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
} from '../helpers'
import {
  UniswapV2VolatileLPCollateral,
  UniswapV2VolatileLPCollateral__factory,
} from '../../typechain-types'
import { makeReserveProtocolWith } from '../fixtures'
import { UniswapV2LPCollateral } from '../../typechain-types/contracts/UniswapV2VolatileLPCollateral'

interface CollateralOpts {
  pair?: string
  token0priceFeeds?: string[]
  token1priceFeeds?: string[]
  targetName?: string
  oracleTimeout?: bigint
  fallbackPrice?: bigint
  maxTradeVolume?: bigint
  defaultThreshold?: bigint
  delayUntilDefault?: bigint
}

const defaultOpts: UniswapV2LPCollateral.ConfigurationStruct = {
  pair: WBTC_ETH_PAIR,
  token0priceFeeds: [WBTC_BTC_FEED, BTC_USD_FEED],
  token1priceFeeds: [ETH_USD_FEED],
  targetName: ethers.utils.formatBytes32String('UNIV2SQRTWBTCETH'),
  oracleTimeout: ORACLE_TIMEOUT,
  fallbackPrice: FIX_ONE,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
}

export const makeReserveProtocol = async () => {
  const collateral = await deployCollateral()
  return await makeReserveProtocolWith(collateral)
}

export const deployCollateral = async (
  opts: CollateralOpts = {}
): Promise<UniswapV2VolatileLPCollateral> => {
  const newOpts = { ...defaultOpts, ...opts }

  const UniswapV2CollateralFactory = <UniswapV2VolatileLPCollateral__factory>(
    await ethers.getContractFactory('UniswapV2VolatileLPCollateral')
  )
  const collateral = <UniswapV2VolatileLPCollateral>await UniswapV2CollateralFactory.deploy(newOpts)

  return collateral
}
