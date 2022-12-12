// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "./UniswapV2LPCollateral.sol";

/**
 * @title UniswapV2VolatileLPCollateral
 */
contract UniswapV2VolatileLPCollateral is UniswapV2LPCollateral {
    using FixLib for uint192;

    constructor(Configuration memory config) UniswapV2LPCollateral(config) {}

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
            if (feedWorking(this.token0price) && feedWorking(this.token1price)) {
                markStatus(CollateralStatus.SOUND);
            } else {
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

    function feedWorking(
        function() external view returns (uint192) getPrice
    ) internal view returns (bool) {
        try getPrice() returns (uint192) {
            return true;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return false;
        }
    }
}
