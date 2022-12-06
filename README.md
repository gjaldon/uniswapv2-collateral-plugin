# UniswapV2 Collateral Plugin

This is a [UniswapV2](https://docs.uniswap.org/contracts/v2/overview) Collateral Plugin for the [Reserve](https://reserve.org/en/) Protocol.

This plugin enables the use of any UniswapV2 Liquidity Token as collateral within the Reserve Protocol. Some important notes about this collateral plugin:

- There are Collateral Plugins which are `UniswapV2NonFiatLPCollateral` and `UniswapV2FiatLPCollateral`. `UniswapV2FiatLPCollateral` is to be used for Liquidity Tokens of Liquidity Pairs that are **both** stablecoins such as the DAI-USDC pair. For every other Liquidity Pair, we will need to use the `UniswapV2NonFiatLPCollateral`.
- Target name for `UniswapV2NonFiatLPCollateral` should follow the format of `UNIV2SQRTWBTCETH`, where `WBTCETH` is the name of the tokens of the liquidity pair being collateralized.
- Multiple price feeds can be passed via `token0priceFeeds` and `token1priceFeeds` when deploying the collateral plugin. This is for cases when one price feed is not enough to get the price of a token. For example, there is no Chainlink feed for WBTC/USD on Ethereum Mainnet. To get USD price of WBTC in Mainnet, we will need 2 price feeds - WBTC/BTC and BTC/USD.
- Internally, `token0priceFeeds` and `token1priceFeeds` are stored as multiple separate immutable variables instead of just one array-type state variable for each. This is a gas-optimization to avoid using SSTORE/SLOAD opcodes which are necessary but expensive operations when using state variables. Immutable variables, on the other hand, are embedded in the bytecode and are much cheaper to use.

## Implementation for Non-Fiat LP Collateral

|       `tok`        |      `ref`       |     `target`     | `UoA` |
| :----------------: | :--------------: | :--------------: | :---: |
| UniswapV2 LP Token | UNIV2SQRTWBTCETH | UNIV2SQRTWBTCETH |  USD  |

The table above is an example of accounting units for a Non-Fiat LP like WBTC-ETH. The reference and target units are the square root of the invariant.

### refPerTok

`refPerTok() = sqrt(x * y)/L` where `x` and `y` are token0 and token1 reserves and L is the total supply of the liquidity token. This value monotonically increases as swaps happen and as liquidity is added or removed from the liquidity pair.

### refresh

The collateral becomes disabled in the following scenarios:

1. refPerTok() decreases. This happens when the total supply of the liquidity token is 0.
2. Collateral has stayed IFFY beyond delayUntilDefault period.

The collateral becomes iffy in the following scenarios:

1. The price feed for token0 or token1 is failing.

### Deployment

This comes with a [deploy script](scripts/non-fiat/deploy.ts) and [configuration](scripts/non-fiat/configuration.ts). It is already fully configured for deployment to Mainnet for WBTC-ETH pair. You may optionally set `oracleLib` if you want to use existing deployments for OracleLib.

## Implementation for Fiat LP Collateral

|       `tok`        |      `ref`       | `target` | `UoA` |
| :----------------: | :--------------: | :------: | :---: |
| UniswapV2 LP Token | UNIV2SQRTDAIUSDC |   USD    |  USD  |

The table above is an example of accounting units for a Fiat LP like DAI-USDC. The reference unit is the square root of the invariant.

### refPerTok

`refPerTok() = sqrt(x * y)/L` where `x` and `y` are token0 and token1 reserves and L is the total supply of the liquidity token. This value monotonically increases as swaps happen and as liquidity is added or removed from the liquidity pair.

### refresh

The collateral becomes disabled in the following scenarios:

1. refPerTok() decreases. This happens when the total supply of the liquidity token is 0.
2. Collateral has stayed IFFY beyond delayUntilDefault period.

The collateral becomes iffy in the following scenarios:

1. The price feed for token0 or token1 is failing.
2. Token0 depegs from USD beyond the default threshold.
3. Token1 depegs from USD beyond the default threshold.
4. Token0 depegs from Token1 beyond the default threshold.

### Deployment

This comes with a [deploy script](scripts/fiat/deploy.ts) and [configuration](scripts/fiat/configuration.ts). It is already fully configured for deployment to Mainnet for DAI-USDC pair. You may optionally set `oracleLib` if you want to use existing deployments for OracleLib.

### Social Media

- Twitter - https://twitter.com/gjaldon
- Discord - gjaldon#9165
