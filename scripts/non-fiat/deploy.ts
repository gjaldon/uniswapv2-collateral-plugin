import { ethers, network } from 'hardhat'
import {
  OracleLib,
  OracleLib__factory,
  UniswapV2NonFiatLPCollateral,
  UniswapV2NonFiatLPCollateral__factory,
} from '../../typechain-types'
import { networkConfig } from './configuration'

async function main() {
  const [deployer] = await ethers.getSigners()

  console.log(`Starting full deployment on network ${network.name}`)
  console.log(`Deployer account: ${deployer.address}\n`)

  const config = networkConfig[network.name]

  let oracleLib: OracleLib
  if (config.oracleLib === undefined) {
    const OracleLibFactory: OracleLib__factory = await ethers.getContractFactory('OracleLib')
    oracleLib = <OracleLib>await OracleLibFactory.deploy()
    await oracleLib.deployed()
    console.log(`Wrapped oracleLib deployed to ${oracleLib.address}`)
  } else {
    oracleLib = <OracleLib>await ethers.getContractAt('OracleLib', config.oracleLib)
    console.log(`Existing OracleLib at ${oracleLib.address} being used`)
  }

  const UniswapV2NonFiatLPCollateralFactory: UniswapV2NonFiatLPCollateral__factory =
    await ethers.getContractFactory('UniswapV2NonFiatLPCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

  const collateral = <UniswapV2NonFiatLPCollateral>(
    await UniswapV2NonFiatLPCollateralFactory.deploy(config.collateralOpts)
  )
  console.log(
    `Deploying UniswapV2NonFiatLPCollateral with transaction ${collateral.deployTransaction.hash}`
  )
  await collateral.deployed()

  console.log(
    `UniswapV2NonFiatLPCollateral deployed to ${collateral.address} as collateral to ${config.collateralOpts.pair}`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
