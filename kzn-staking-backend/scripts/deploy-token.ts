import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "sepolia",
  chainType: "l1",
})

async function main() {
  const initialSupply = ethers.parseUnits("1000000", 18); // 1,000,000 KZN
  const Token = await ethers.getContractFactory("KZNToken");
  const token = await Token.deploy(initialSupply);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log("KZNToken deployed to:", tokenAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});