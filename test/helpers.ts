import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

// Mainnet Addresses
export const COMP = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
export const WBTC_ETH_PAIR = '0xbb2b8038a1640196fbe3e38816f3e67cba72d940'
export const USDC_ETH_PAIR = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'
export const WBTC_BTC_FEED = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23'
export const BTC_USD_FEED = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'
export const ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
export const USDC_USD_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
export const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

export const WBTC_ETH_HOLDER = '0xe8e5f5c4eb430c517c5f266ef9d18994321f1521'
export const WBTC_HOLDER = '0xbf72da2bd84c5170618fbe5914b0eca9638d5eb5'

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
