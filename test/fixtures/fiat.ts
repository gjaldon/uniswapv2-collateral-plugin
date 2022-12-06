import { ethers } from 'hardhat'
import {
  MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  FIX_ONE,
  DAI_USDC_PAIR,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  DAI_USD_FEED,
  USDC_USD_FEED,
} from '../helpers'
import {
  UniswapV2FiatLPCollateral,
  UniswapV2FiatLPCollateral__factory,
} from '../../typechain-types'
import { makeReserveProtocolWith } from '../fixtures'

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

const defaultOpts: UniswapV2FiatLPCollateral.ConfigurationStruct = {
  pair: DAI_USDC_PAIR,
  token0priceFeeds: [DAI_USD_FEED],
  token1priceFeeds: [USDC_USD_FEED],
  targetName: ethers.utils.formatBytes32String('USD'),
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
): Promise<UniswapV2FiatLPCollateral> => {
  const newOpts = { ...defaultOpts, ...opts }

  const UniswapV2CollateralFactory = <UniswapV2FiatLPCollateral__factory>(
    await ethers.getContractFactory('UniswapV2FiatLPCollateral')
  )
  const collateral = <UniswapV2FiatLPCollateral>await UniswapV2CollateralFactory.deploy(newOpts)

  return collateral
}
