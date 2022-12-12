// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "./UniswapV2LPCollateral.sol";

/**
 * @title UniswapV2StableLPCollateral
 */
contract UniswapV2StableLPCollateral is UniswapV2LPCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface internal immutable targetFeed;

    constructor(
        Configuration memory config,
        AggregatorV3Interface _targetFeed
    ) UniswapV2LPCollateral(config) {
        targetFeed = _targetFeed;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external override {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();

        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            if (
                pegNotMaintained(this.token0price) ||
                pegNotMaintained(this.token1price) ||
                pegNotMaintained(this.tokensRatio)
            ) {
                markStatus(CollateralStatus.IFFY);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    function pegNotMaintained(
        function() external view returns (uint192) priceFunc
    ) internal view returns (bool) {
        try priceFunc() returns (uint192 p) {
            // Check for soft default of underlying reference token
            uint192 peg = getPeg();

            // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
            uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            return (p < peg - delta || p > peg + delta);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return true;
        }
    }

    function getPeg() public view returns (uint192) {
        if (address(targetFeed) == address(0)) return targetPerRef();
        return targetFeed.price(oracleTimeout).mul(targetPerRef());
    }

    function tokensRatio() public view returns (uint192) {
        (uint112 reserves0, uint112 reserves1, ) = pair.getReserves();

        uint192 totalReserves0 = shiftl_toFix(token0price().mul(reserves0), -int8(token0decimals));
        uint192 totalReserves1 = shiftl_toFix(token1price().mul(reserves1), -int8(token1decimals));

        return totalReserves0.div(totalReserves1);
    }
}
