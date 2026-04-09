import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "sepolia",
  chainType: "l1",
})

async function main() {
  const kznTokenAddress = "0x37b74A99503C17c62a64854E770978119192D6E3";
  const aprBps = 1200;
  const [deployer] = await ethers.getSigners();

  const Staking = await ethers.getContractFactory("KZNStaking");
  const staking = await Staking.deploy(kznTokenAddress, aprBps, deployer.address);
  await staking.waitForDeployment();

  console.log("KZNStaking deployed to:", await staking.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});