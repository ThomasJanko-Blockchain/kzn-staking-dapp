import { network } from "hardhat";

const { ethers } = await network.connect({
  network: "sepolia",
  chainType: "l1",
})

async function sendWithNonceRetry<T>(
  label: string,
  sendTx: (nonce: number) => Promise<T>,
  getHash: (tx: T) => string,
  wait: (tx: T) => Promise<void>,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const [owner] = await ethers.getSigners();
      const nonce = await ethers.provider.getTransactionCount(owner.address, "pending");
      const tx = await sendTx(nonce);
      await wait(tx);
      console.log(`${label} tx:`, getHash(tx));
      return tx;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const nonceConflict = message.includes("nonce too low") || message.includes("already known");
      if (!nonceConflict || attempt === maxRetries) throw error;
      console.log(`${label}: nonce conflict, retrying (${attempt}/${maxRetries})...`);
    }
  }
  throw new Error(`${label}: failed after nonce retries.`);
}

async function main() {
  const stakingAddress = "0xd9a450c402B90C1A400779d5aE28904d9bD0f3e6";
  const tokenAddress = "0x22Dec6187dA597fFbF6aa28087b66DbbE27dEb16";
  const amount = ethers.parseUnits("5000", 18); // fund 5000 KZN

  const [owner] = await ethers.getSigners();

  const token = await ethers.getContractAt(
    [
      "function approve(address spender, uint256 value) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)"
    ],
    tokenAddress
  );

  const staking = await ethers.getContractAt(
    ["function fundRewardPool(uint256 amount) external"],
    stakingAddress
  );

  console.log("Owner:", owner.address);
  console.log("Funding amount:", ethers.formatUnits(amount, 18), "KZN");

  const currentAllowance = await token.allowance(owner.address, stakingAddress);
  if (currentAllowance < amount) {
    await sendWithNonceRetry(
      "Approve",
      (nonce) => token.approve(stakingAddress, amount, { nonce }),
      (tx) => tx.hash,
      (tx) => tx.wait(1)
    );
  } else {
    console.log("Approve skipped: allowance already sufficient.");
  }

  await sendWithNonceRetry(
    "fundRewardPool",
    (nonce) => staking.fundRewardPool(amount, { nonce }),
    (tx) => tx.hash,
    (tx) => tx.wait(1)
  );

  const allowance = await token.allowance(owner.address, stakingAddress);
  console.log("Remaining allowance:", ethers.formatUnits(allowance, 18), "KZN");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});