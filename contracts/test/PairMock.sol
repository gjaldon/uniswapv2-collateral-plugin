// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "../IUniswapV2Pair.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PairMock is IUniswapV2Pair, ERC20 {
    address public immutable token0;
    address public immutable token1;

    uint112 public reserve0;
    uint112 public reserve1;

    uint internal totalSupply_;

    constructor(
        address _token0,
        address _token1,
        uint112 _reserve0,
        uint112 _reserve1,
        uint _totalSupply
    ) ERC20("Uniswap V2", "UNI-V2") {
        require(_token0 != address(0), "token0 must not be address zero");
        require(_token1 != address(0), "token1 must not be address zero");

        token0 = _token0;
        token1 = _token1;
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        totalSupply_ = _totalSupply;
    }

    function getReserves()
        external
        view
        returns (uint112 _reserve0, uint112 _reserve1, uint32 blockTimestampLast)
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        blockTimestampLast = uint32(block.timestamp);
    }

    function setTotalSupply(uint amount) external {
        totalSupply_ = amount;
    }

    function totalSupply() public view override(ERC20, IUniswapV2Pair) returns (uint256) {
        return totalSupply_;
    }

    function setReserves(uint112 _reserve0, uint112 _reserve1) external {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }
}
