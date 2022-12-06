// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "reserve/contracts/plugins/assets/OracleLib.sol";
import "reserve/contracts/libraries/Fixed.sol";
import "./ICollateral.sol";
import "./IUniswapV2Pair.sol";
import "hardhat/console.sol";

/**
 * @title UniswapV2NonFiatLPCollateral
 */
contract UniswapV2NonFiatLPCollateral is ICollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    struct Configuration {
        IUniswapV2Pair pair;
        AggregatorV3Interface[] token0priceFeeds;
        AggregatorV3Interface[] token1priceFeeds;
        bytes32 targetName;
        uint48 oracleTimeout;
        uint192 fallbackPrice;
        uint192 maxTradeVolume;
        uint192 defaultThreshold;
        uint256 delayUntilDefault;
    }

    AggregatorV3Interface internal immutable _t0feed0;
    AggregatorV3Interface internal immutable _t0feed1;
    AggregatorV3Interface internal immutable _t0feed2;
    AggregatorV3Interface internal immutable _t1feed0;
    AggregatorV3Interface internal immutable _t1feed1;
    AggregatorV3Interface internal immutable _t1feed2;

    uint8 internal immutable _t0feedsLength;
    uint8 internal immutable _t1feedsLength;

    IERC20Metadata public immutable erc20;
    IUniswapV2Pair public immutable pair;

    uint8 public immutable token0decimals;
    uint8 public immutable token1decimals;
    uint8 public immutable erc20Decimals;
    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    uint192 public immutable maxTradeVolume; // {UoA}
    uint192 public immutable fallbackPrice; // {UoA}
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    uint256 public immutable delayUntilDefault; // {s} e.g 86400

    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;

    bytes32 public immutable targetName;

    constructor(Configuration memory config) {
        require(config.fallbackPrice > 0, "fallback price zero");
        require(address(config.pair) != address(0), "missing pair address");
        require(config.token0priceFeeds.length > 0, "missing token0 price feed");
        require(config.token1priceFeeds.length > 0, "missing token1 price feed");
        require(config.token0priceFeeds.length <= 3, "token0 price feeds limited to 3");
        require(config.token1priceFeeds.length <= 3, "token1 price feeds limited to 3");
        require(config.maxTradeVolume > 0, "invalid max trade volume");
        require(config.oracleTimeout > 0, "oracleTimeout zero");
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(config.targetName != bytes32(0), "targetName missing");
        require(config.delayUntilDefault > 0, "delayUntilDefault zero");

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;
        pair = config.pair;
        fallbackPrice = config.fallbackPrice;
        erc20 = IERC20Metadata(address(pair));
        erc20Decimals = erc20.decimals();
        token0decimals = IERC20Metadata(address(pair.token0())).decimals();
        token1decimals = IERC20Metadata(address(pair.token1())).decimals();
        maxTradeVolume = config.maxTradeVolume;
        oracleTimeout = config.oracleTimeout;
        defaultThreshold = config.defaultThreshold;

        // Solidity does not support immutable arrays. This is a hack to get the equivalent of
        // an immutable array so we do not have store the token feeds in the blockchain. This is
        // a gas optimization since it is significantly more expensive to read and write on the
        // blockchain than it is to use embedded values in the bytecode.
        _t0feedsLength = uint8(config.token0priceFeeds.length);
        _t0feed0 = _t0feedsLength > 0
            ? config.token0priceFeeds[0]
            : AggregatorV3Interface(address(0));
        _t0feed1 = _t0feedsLength > 1
            ? config.token0priceFeeds[1]
            : AggregatorV3Interface(address(0));
        _t0feed2 = _t0feedsLength > 2
            ? config.token0priceFeeds[2]
            : AggregatorV3Interface(address(0));

        require(
            address(_t0feed0) != address(0),
            "at least 1 token0 price feed must not be zero address"
        );

        _t1feedsLength = uint8(config.token1priceFeeds.length);
        _t1feed0 = _t1feedsLength > 0
            ? config.token1priceFeeds[0]
            : AggregatorV3Interface(address(0));
        _t1feed1 = _t1feedsLength > 1
            ? config.token1priceFeeds[1]
            : AggregatorV3Interface(address(0));
        _t1feed2 = _t1feedsLength > 2
            ? config.token1priceFeeds[2]
            : AggregatorV3Interface(address(0));

        require(
            address(_t1feed0) != address(0),
            "at least 1 token1 price feeds can not be zero address"
        );

        prevReferencePrice = refPerTok();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();

        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try this.token0price() returns (uint192) {
                // noop
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }

            try this.token1price() returns (uint192) {
                // noop
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    function strictPrice() public view returns (uint192) {
        return totalLiquidity().div(_safeWrap(pair.totalSupply()));
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, fallbackPrice);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view returns (uint192) {
        (uint112 reserves0, uint112 reserves1, ) = pair.getReserves();
        uint192 invariant = shiftl_toFix(reserves0, -int8(token0decimals)) *
            shiftl_toFix(reserves1, -int8(token1decimals));
        uint192 sqrt = _safeWrap(Math.sqrt(invariant));
        return sqrt.div(_safeWrap(pair.totalSupply()));
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public pure returns (uint192) {
        return FIX_ONE;
    }

    /// @return The collateral's status
    function status() public view override returns (CollateralStatus) {
        if (_whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (_whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    function claimRewards() external {}

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure returns (bool) {
        return true;
    }

    // === Helpers ===
    function totalLiquidity() public view returns (uint192) {
        (uint112 reserves0, uint112 reserves1, ) = pair.getReserves();

        uint192 totalReserves0price = shiftl_toFix(
            token0price().mul(reserves0),
            -int8(token0decimals)
        );
        uint192 totalReserves1price = shiftl_toFix(
            token1price().mul(reserves1),
            -int8(token1decimals)
        );

        return totalReserves0price.plus(totalReserves1price);
    }

    function token0price() public view returns (uint192) {
        uint192 _price = FIX_ONE;
        for (uint8 i = 0; i < _t0feedsLength; i++) {
            _price = getToken0feed(i).price(oracleTimeout).mul(_price);
        }
        return _price;
    }

    function getToken0feed(uint8 index) public view returns (AggregatorV3Interface) {
        require(index <= 2, "index must be 2 or less");
        if (index == 0) return _t0feed0;
        if (index == 1) return _t0feed1;
        return _t0feed2;
    }

    function token1price() public view returns (uint192) {
        uint192 _price = FIX_ONE;
        for (uint8 i = 0; i < _t1feedsLength; i++) {
            _price = getToken1feed(i).price(oracleTimeout).mul(_price);
        }
        return _price;
    }

    function getToken1feed(uint8 index) public view returns (AggregatorV3Interface) {
        require(index <= 2, "index must be 2 or less");
        if (index == 0) return _t1feed0;
        if (index == 1) return _t1feed1;
        return _t1feed2;
    }

    function markStatus(CollateralStatus status_) internal {
        if (_whenDefault <= block.timestamp) return; // prevent DISABLED -> SOUND/IFFY

        if (status_ == CollateralStatus.SOUND) {
            _whenDefault = NEVER;
        } else if (status_ == CollateralStatus.IFFY) {
            _whenDefault = Math.min(block.timestamp + delayUntilDefault, _whenDefault);
        } else if (status_ == CollateralStatus.DISABLED) {
            _whenDefault = block.timestamp;
        }
    }

    function alreadyDefaulted() internal view returns (bool) {
        return _whenDefault <= block.timestamp;
    }

    function whenDefault() public view returns (uint256) {
        return _whenDefault;
    }
}
