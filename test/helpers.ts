import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

// Mainnet Addresses
export const COMP = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
export const WBTC_ETH_PAIR = '0xbb2b8038a1640196fbe3e38816f3e67cba72d940'
export const USDC_ETH_PAIR = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'
export const STETH_ETH_PAIR = '0x4028daac072e492d34a3afdbef0ba7e35d8b55c4'
export const WBTC_BTC_FEED = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23'
export const BTC_USD_FEED = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'
export const ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
export const USDC_USD_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
export const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
export const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
export const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
export const STETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84'
export const DAI_USDC_PAIR = '0xae461ca67b15dc8dc81ce7615e0320da1a9ab8d5'
export const DAI_USDT_PAIR = '0xb20bd5d04be54f870d5c0d3ca85d82b34b836405'
export const DAI_USD_FEED = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
export const USDT_USD_FEED = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
export const STETH_ETH_FEED = '0x86392dC19c0b719886221c78AB11eb8Cf5c52812'
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

export const WBTC_ETH_HOLDER = '0xe8e5f5c4eb430c517c5f266ef9d18994321f1521'
export const WBTC_HOLDER = '0xbf72da2bd84c5170618fbe5914b0eca9638d5eb5'
export const DAI_HOLDER = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
export const DAI_USDC_HOLDER = '0xa81598667ac561986b70ae11bbe2dd5348ed4327'

export const ORACLE_TIMEOUT = 86400n // 24 hours in seconds
export const DEFAULT_THRESHOLD = 5n * 10n ** 16n // 0.05
export const DELAY_UNTIL_DEFAULT = 86400n
export const MAX_TRADE_VOL = 1000000n

export const FIX_ONE = 1n * 10n ** 18n

export enum CollateralStatus {
  SOUND,
  IFFY,
  DISABLED,
}

export type Numeric = number | bigint

export const exp = (i: Numeric, d: Numeric = 0): bigint => {
  return BigInt(i) * 10n ** BigInt(d)
}

type ImpersonationFunction<T> = (signer: SignerWithAddress) => Promise<T>

/* whileImpersonating(address, f):

   Set up `signer` to be an ethers transaction signer that impersonates the account address
   `address`. In that context, call f(signer). `address` can be either a contract address or an
   external account, so you can use often this instead of building entire mock contracts.

   Example usage:

   await whileImpersonating(basketHandler.address, async (signer) => {
     await expect(rToken.connect(signer).setBasketsNeeded(fp('1'))
     .to.emit(rToken, 'BasketsNeededChanged')
   })

   This does the following:
   - Sets the basketHandler Eth balance to 2^256-1 (so it has plenty of gas)
   - Calls rToken.setBasketsNeeded _as_ the basketHandler contract,
   - Checks that that call emits the event 'BasketNeededChanged'
*/
export const whileImpersonating = async (address: string, f: ImpersonationFunction<void>) => {
  // Set maximum ether balance at address
  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [address, '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
  })
  const signer = await ethers.getImpersonatedSigner(address)

  await f(signer)
}

export const allocateERC20 = async (
  tokenAddr: string,
  from: string,
  to: string,
  balance: Numeric
) => {
  if (typeof balance === 'number') {
    balance = BigInt(balance)
  }

  const token = await ethers.getContractAt('ERC20Mock', tokenAddr)
  await whileImpersonating(from, async (signer) => {
    await token.connect(signer).transfer(to, balance)
  })
}

export const resetFork = async () => {
  // Need to reset state since running the whole test suites to all
  // test cases in this file to fail. Strangely, all test cases
  // pass when running just this file alone.
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: 16074053,
        },
      },
    ],
  })
}
