// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ICollateral.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "reserve/contracts/plugins/assets/OracleLib.sol";
import "reserve/contracts/libraries/Fixed.sol";

/**
 * @title Collateral
 * Parent class for all collateral
 * @dev By default, expects all units to be equal: tok == ref == target == UoA
 * @dev But no user is likely to want that, and that's why this contract is abstract
 */
contract Collateral is ICollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    struct Configuration {
        IERC20Metadata erc20;
        IERC20 rewardERC20;
        AggregatorV3Interface chainlinkFeed;
        bytes32 targetName;
        uint48 oracleTimeout;
        uint192 fallbackPrice;
        uint192 maxTradeVolume;
        uint192 defaultThreshold;
        uint256 delayUntilDefault;
        uint256 reservesThresholdIffy;
        uint256 reservesThresholdDisabled;
    }

    AggregatorV3Interface public immutable chainlinkFeed;
    IERC20Metadata public immutable erc20;
    IERC20 public immutable rewardERC20;

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
        require(address(config.chainlinkFeed) != address(0), "missing chainlink feed");
        require(address(config.erc20) != address(0), "missing erc20");
        require(config.maxTradeVolume > 0, "invalid max trade volume");
        require(config.oracleTimeout > 0, "oracleTimeout zero");
        require(address(config.rewardERC20) != address(0), "rewardERC20 missing");
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(config.targetName != bytes32(0), "targetName missing");
        require(config.delayUntilDefault > 0, "delayUntilDefault zero");
        require(config.reservesThresholdIffy > 0, "reservesThresholdIffy zero");
        require(config.reservesThresholdDisabled > 0, "reservesThresholdDisabled zero");

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;
        fallbackPrice = config.fallbackPrice;
        chainlinkFeed = config.chainlinkFeed;
        erc20 = config.erc20;
        erc20Decimals = erc20.decimals();
        rewardERC20 = config.rewardERC20;
        maxTradeVolume = config.maxTradeVolume;
        oracleTimeout = config.oracleTimeout;
        defaultThreshold = config.defaultThreshold;
        prevReferencePrice = refPerTok();
        reservesThresholdIffy = config.reservesThresholdIffy;
        reservesThresholdDisabled = config.reservesThresholdDisabled;
    }

    // solhint-disable-next-line no-empty-blocks

    /// VERY IMPORTANT: In any valid implemntation, status() MUST become DISABLED in refresh() if
    /// refPerTok() has ever decreased since the last refresh() call!
    /// (In this base class, refPerTok() is constant, so this is trivially satisfied.)
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
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
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
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view returns (uint192) {
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
