# UniswapV2 Collateral Plugins

This repo contains [Reserve Protocol](https://reserve.org/en/) collateral plugins for [UniswapV2](https://docs.uniswap.org/contracts/v2/overview).

This plugin enables the use of any UniswapV2 Liquidity Token as collateral within the Reserve Protocol. When using these liquidity tokens as collateral, we need to take into account the pair of assets in the liquidity pool. When assets in the pool are pegged, we will need to ensure assets maintain peg within a given threshold. Given this, we can categorize Liquidity Pairs in UniswapV2 as the following:

1. Fiat pairs - pairs of assets pegged to fiat such as DAI-USDC and USDC-USDT
2. Non-fiat stable pairs - pairs of assets pegged to a non-fiat asset such as stETH-ETH and wBTC-BTC
3. Pegged and Volatile pair - one of the pair is a pegged asset while the other is a volatile one. Examples are imBTC-ETH and USDC-ETH
4. Volatile pairs - both assets in the pair are volatile and not pegged to any asset such as UNI-ETH and MKR-ETH

Due to these differences across Liquidity Pairs, there are 2 UniswapV2 Collateral Plugins in this repo which are:

1. `UniswapV2VolatileLPCollateral` - this is the plugin to use for Volatile Pairs like UNI-ETH and MKR-ETH.
2. `UniswapV2StableLPCollateral` - this is the plugin to use for any Liquidity Pair that has at least one pegged asset.

## Usage

### Multiple Price Feeds

Some tokens require multiple price feeds since they do not have a direct price feed to USD. One example of this is WBTC. In ethereum mainnet, there is no WBTC-USD price feed (at time of writing.) To get the USD price of WBTC, we need the chainlink feeds WBTC-BTC and BTC-USD. To support this, both collateral plugins have `token0priceFeeds` and `token1priceFeeds` deployment parameters where you can pass multiple price feeds.

### Target Pegs

Each token in a Liquidity Pair may have different target pegs. For example, WBTC-USDC has WBTC pegged to BTC while USDC pegged to fiat USD. To account for this, `UniswapV2StableLPCollateral` has a `targetPegFeeds` deployment parameter, which is an array of 2 price feeds. The first price feed is for token0, and the second is for token1. For tokens that are pegged to fiat, you will need to pass the zero address since no price feed is needed for those. Stablecoins are always pegged to 1 fiat currency whether that be USD, EUR, PHP, etc...

### Pegged Assets

Since `UniswapV2StableLPCollateral` can accept Liquidity Pairs that have one non-pegged token and a pegged token, an `assetsPegged` deployment parameter exists to flag tokens as pegged assets or not. `assetsPegged` is an array of 2 booleans. For USDC-ETH pair, we would need to specify USDC as a pegged asset and ETH as a non-pegged asset. To do that, we pass `[true, false]` as the `assetsPegged` deployment parameter where USDC(token0) has true while ETH(token1) has false.

### Pegged Pair

Some Liquidity Pairs have tokens that are pegged to each other. Examples of these are DAI-USDC, STETH-ETH and WBTC-BTC. To make the Collateral Plugin aware that a pair is pegged, `UniswapV2StableLPCollateral` has a `pairPegged` deployment parameter which accepts a boolean. For pegged pairs like DAI-USDC, `pairPegged` should be true.

## Implementation Notes

### Immutable Arrays for Price Feeds

Internally, `token0priceFeeds` and `token1priceFeeds` are stored as multiple separate immutable variables instead of just one array-type state variable for each. This is a gas-optimization done to avoid using SSTORE/SLOAD opcodes which are necessary but expensive operations when using state variables. Immutable variables, on the other hand, are embedded in the bytecode and are much cheaper to use which leads to more gas-efficient `price`, `strictPrice` and `refresh` functions.

### refPerTok

`refPerTok() = sqrt(x * y)/L` where `x` and `y` are token0 and token1 reserves and L is the total supply of the liquidity token. This value monotonically increases as swaps happen and as liquidity is added or removed from the liquidity pair.

## Implementation for Volatile LP Collateral

|       `tok`        |      `ref`      |    `target`     | `UoA` |
| :----------------: | :-------------: | :-------------: | :---: |
| UniswapV2 LP Token | UNIV2SQRTMKRETH | UNIV2SQRTMKRETH |  USD  |

The table above is an example of accounting units for a Volatile LP like MKR-ETH. The reference and target units are the square root of the invariant.

### refresh

The collateral becomes disabled in the following scenarios:

1. refPerTok() decreases. This happens when the total supply of the liquidity token is 0.
2. Collateral has stayed IFFY beyond delayUntilDefault period.

The collateral becomes iffy in the following scenarios:

1. The price feed for token0 or token1 is failing.

### Deployment

This comes with a [deploy script](scripts/volatile/deploy.ts) and [configuration](scripts/volatile/configuration.ts). It is already fully configured for deployment to Mainnet for WBTC-ETH pair. You may optionally set `oracleLib` if you want to use existing deployments for OracleLib.

## Implementation for Fiat LP Collateral

|       `tok`        |      `ref`       | `target` | `UoA` |
| :----------------: | :--------------: | :------: | :---: |
| UniswapV2 LP Token | UNIV2SQRTDAIUSDC |   USD    |  USD  |

The table above is an example of accounting units for a Fiat LP like DAI-USDC. The reference unit is the square root of the invariant.

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

This comes with a [deploy script](scripts/stable/deploy.ts) and [configuration](scripts/stable/configuration.ts). It is already fully configured for deployment to Mainnet for DAI-USDC pair. You may optionally set `oracleLib` if you want to use existing deployments for OracleLib.

## Implementation for Non-Fiat Stable LP Collateral

|       `tok`        |       `ref`       | `target` | `UoA` |
| :----------------: | :---------------: | :------: | :---: |
| UniswapV2 LP Token | UNIV2SQRTSTETHETH |   ETH    |  USD  |

The table above is an example of accounting units for a Non-Fiat Stable LP like STETH-ETH. The reference unit is the square root of the invariant.

### refresh

The collateral becomes disabled in the following scenarios:

1. refPerTok() decreases. This happens when the total supply of the liquidity token is 0.
2. Collateral has stayed IFFY beyond delayUntilDefault period.

The collateral becomes iffy in the following scenarios:

1. The price feed for token0 or token1 is failing.
2. Token0 depegs from ETH beyond the default threshold.
3. Token0 depegs from Token1 beyond the default threshold.

## Implementation for Pegged and Volatile LP Collateral

|       `tok`        |      `ref`       |     `target`     | `UoA` |
| :----------------: | :--------------: | :--------------: | :---: |
| UniswapV2 LP Token | UNIV2SQRTUSDCETH | UNIV2SQRTUSDCETH |  USD  |

The table above is an example of accounting units for a Pegged and Volatile LP like USDC-ETH. The reference unit is the square root of the invariant. Both tokens in the pool are not pegged to each other.

### refresh

The collateral becomes disabled in the following scenarios:

1. refPerTok() decreases. This happens when the total supply of the liquidity token is 0.
2. Collateral has stayed IFFY beyond delayUntilDefault period.

The collateral becomes iffy in the following scenarios:

1. The price feed for token0 or token1 is failing.
2. Token0 depegs from USD beyond the default threshold.

### Slither

Below are Slither warnings that were hidden since they were found to be non-issues.

- Hid all issues that were found in dependencies

`PairMock.constructor(address,address,uint112,uint112,uint256)._totalSupply (contracts/test/PairMock.sol#21) shadows _totalSupply`

- This was intentional and done only in the constructor. We do not also `_totalSupply` that comes with OpenZeppelin's ERC20.

`UniswapV2FiatLPCollateral.status() (contracts/UniswapV2FiatLPCollateral.sol#211-219) uses timestamp for comparisons`

- We use `block.timestamp` for comparisons in the defaulting logic of our collaterals. Since timestamp can not be manipulated to be too far into the future, this can only potentially default the collateral a little sooner.

### Social Media

- Twitter - https://twitter.com/gjaldon
- Discord - gjaldon#9165
