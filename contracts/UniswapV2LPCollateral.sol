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
 * @title UniswapV2LPCollateral
 */
contract UniswapV2LPCollateral is ICollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    struct Configuration {
        IUniswapV2Pair pair;
        AggregatorV3Interface token0priceFeed;
        AggregatorV3Interface token1priceFeed;
        bytes32 targetName;
        uint48 oracleTimeout;
        uint192 fallbackPrice;
        uint192 maxTradeVolume;
        uint192 defaultThreshold;
        uint256 delayUntilDefault;
        uint256 reservesThresholdIffy;
        uint256 reservesThresholdDisabled;
    }

    AggregatorV3Interface public immutable token0priceFeed;
    AggregatorV3Interface public immutable token1priceFeed;
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
    uint256 public immutable reservesThresholdIffy;
    uint256 public immutable reservesThresholdDisabled;

    // Default Status:
    // _whenDefault == NEVER: no risk of default (initial value)
    // _whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving _whenDefault == NEVER.
    // _whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    constructor(Configuration memory config) {
        require(config.fallbackPrice > 0, "fallback price zero");
        require(address(config.pair) != address(0), "missing pair address");
        require(address(config.token0priceFeed) != address(0), "missing chainlink feed");
        require(address(config.token1priceFeed) != address(0), "missing chainlink feed");
        require(config.maxTradeVolume > 0, "invalid max trade volume");
        require(config.oracleTimeout > 0, "oracleTimeout zero");
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(config.targetName != bytes32(0), "targetName missing");
        require(config.delayUntilDefault > 0, "delayUntilDefault zero");
        require(config.reservesThresholdIffy > 0, "reservesThresholdIffy zero");
        require(config.reservesThresholdDisabled > 0, "reservesThresholdDisabled zero");

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;
        pair = config.pair;
        fallbackPrice = config.fallbackPrice;
        token0priceFeed = config.token0priceFeed;
        token1priceFeed = config.token1priceFeed;
        erc20 = IERC20Metadata(address(config.pair));
        erc20Decimals = erc20.decimals();
        token0decimals = IERC20Metadata(address(pair.token0())).decimals();
        token1decimals = IERC20Metadata(address(pair.token1())).decimals();
        maxTradeVolume = config.maxTradeVolume;
        oracleTimeout = config.oracleTimeout;
        defaultThreshold = config.defaultThreshold;
        prevReferencePrice = refPerTok();
        reservesThresholdIffy = config.reservesThresholdIffy;
        reservesThresholdDisabled = config.reservesThresholdDisabled;
    }

    function refresh() external {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();
        try this.strictPrice() returns (uint192) {
            markStatus(CollateralStatus.SOUND);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
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
            token0priceFeed.price(oracleTimeout).mul(reserves0),
            -int8(token0decimals)
        );
        uint192 totalReserves1price = shiftl_toFix(
            token1priceFeed.price(oracleTimeout).mul(reserves1),
            -int8(token1decimals)
        );

        return totalReserves0price.plus(totalReserves1price);
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
