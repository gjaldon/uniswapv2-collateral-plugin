// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "./UniswapV2LPCollateral.sol";

/**
 * @title UniswapV2StableLPCollateral
 */
contract UniswapV2StableLPCollateral is UniswapV2LPCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface internal immutable targetPegFeed0;
    AggregatorV3Interface internal immutable targetPegFeed1;
    bool internal immutable assetPegged0;
    bool internal immutable assetPegged1;
    bool immutable pairPegged;

    constructor(
        Configuration memory config,
        AggregatorV3Interface[] memory targetPegFeeds,
        bool[] memory assetsPegged,
        bool _pairPegged
    ) UniswapV2LPCollateral(config) {
        require(targetPegFeeds.length == 2, "must set target peg feed for each token");
        targetPegFeed0 = targetPegFeeds[0];
        targetPegFeed1 = targetPegFeeds[1];
        assetPegged0 = assetsPegged[0];
        assetPegged1 = assetsPegged[1];
        pairPegged = _pairPegged;
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
            if (pegNotMaintained()) {
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

    function pegNotMaintained() internal view returns (bool) {
        if (assetPegged0) {
            try this.token0price() returns (uint192 p) {
                // Check for soft default of underlying reference token
                uint192 peg = getPeg0();

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) return true;
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        }

        if (assetPegged1) {
            try this.token1price() returns (uint192 p) {
                // Check for soft default of underlying reference token
                uint192 peg = getPeg1();

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) return true;
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        }

        if (pairPegged) {
            try this.tokensRatio() returns (uint192 p) {
                // Check for soft default of underlying reference token
                uint192 peg = getPeg1();

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) return true;
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        }

        return false;
    }

    function getPeg0() public view returns (uint192) {
        if (address(targetPegFeed0) == address(0)) return targetPerRef();
        return targetPegFeed0.price(oracleTimeout).mul(targetPerRef());
    }

    function getPeg1() public view returns (uint192) {
        if (address(targetPegFeed1) == address(0)) return targetPerRef();
        return targetPegFeed1.price(oracleTimeout).mul(targetPerRef());
    }

    function tokensRatio() public view returns (uint192) {
        (uint112 reserves0, uint112 reserves1, ) = pair.getReserves();

        uint192 totalReserves0 = shiftl_toFix(reserves0, -int8(token0decimals));
        uint192 totalReserves1 = shiftl_toFix(reserves1, -int8(token1decimals));

        return totalReserves0.div(totalReserves1);
    }
}
