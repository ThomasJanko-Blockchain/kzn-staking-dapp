import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect()

async function deployFixture() {
  const [owner, alice, bob] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("KZNToken");
  const initialSupply = ethers.parseUnits("1000000", 18);
  const token = await Token.deploy(initialSupply);
  await token.waitForDeployment();

  const aprBps = 1200n; // 12%
  const Staking = await ethers.getContractFactory("KZNStaking");
  const staking = await Staking.deploy(await token.getAddress(), aprBps, owner.address);
  await staking.waitForDeployment();

  // Give Alice and Bob tokens
  await token.transfer(alice.address, ethers.parseUnits("10000", 18));
  await token.transfer(bob.address, ethers.parseUnits("10000", 18));

  // Fund reward pool from owner
  const rewardFund = ethers.parseUnits("50000", 18);
  await token.approve(await staking.getAddress(), rewardFund);
  await staking.fundRewardPool(rewardFund);

  return { owner, alice, bob, token, staking, aprBps };
}

describe("KZNStaking", function () {

  it("stakes tokens and updates totalStaked/user amount", async function () {
    const { alice, token, staking } = await deployFixture();

    const stakeAmount = ethers.parseUnits("1000", 18);
    await token.connect(alice).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(alice).stake(stakeAmount);

    const user = await staking.users(alice.address);
    expect(user.amount).to.equal(stakeAmount);
    expect(await staking.totalStaked()).to.equal(stakeAmount);
  });

  it("accrues rewards over time", async function () {
    const { alice, token, staking } = await deployFixture();

    const stakeAmount = ethers.parseUnits("1000", 18);
    await token.connect(alice).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(alice).stake(stakeAmount);

    // Move 30 days forward
    await networkHelpers.time.increase(30 * 24 * 60 * 60);

    const pending = await staking.pendingRewards(alice.address);

    // Expected ~= 1000 * 12% * (30/365) = ~9.86 KZN
    const expected = ethers.parseUnits("9.86", 18);

    // Allow tiny tolerance for integer math
    const tolerance = ethers.parseUnits("0.05", 18);
    expect(pending).to.be.gte(expected - tolerance);
    expect(pending).to.be.lte(expected + tolerance);
  });

  it("claims rewards and resets rewardsStored", async function () {
    const { alice, token, staking } = await deployFixture();

    const stakeAmount = ethers.parseUnits("1000", 18);
    await token.connect(alice).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(alice).stake(stakeAmount);

    await networkHelpers.time.increase(15 * 24 * 60 * 60);

    const before = await token.balanceOf(alice.address);
    await staking.connect(alice).claimRewards();
    const after = await token.balanceOf(alice.address);

    expect(after).to.be.gt(before);

    const pendingAfter = await staking.pendingRewards(alice.address);
    // could be tiny >0 if 1 block elapsed; keep robust check:
    expect(pendingAfter).to.be.lte(ethers.parseUnits("0.0001", 18));
  });

  it("withdraws partial amount correctly", async function () {
    const { alice, token, staking } = await deployFixture();

    const stakeAmount = ethers.parseUnits("1000", 18);
    const withdrawAmount = ethers.parseUnits("400", 18);

    await token.connect(alice).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(alice).stake(stakeAmount);

    await staking.connect(alice).withdraw(withdrawAmount);

    const user = await staking.users(alice.address);
    expect(user.amount).to.equal(stakeAmount - withdrawAmount);
    expect(await staking.totalStaked()).to.equal(stakeAmount - withdrawAmount);
  });

  it("reverts on withdraw greater than stake", async function () {
    const { alice, token, staking } = await deployFixture();

    const stakeAmount = ethers.parseUnits("100", 18);
    await token.connect(alice).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(alice).stake(stakeAmount);

    await expect(
      staking.connect(alice).withdraw(ethers.parseUnits("101", 18))
    ).to.be.revertedWithCustomError(staking, "InsufficientStake");
  });

  it("reverts claim when no rewards accrued", async function () {
    const { alice, staking } = await deployFixture();

    await expect(staking.connect(alice).claimRewards()).to.be.revertedWithCustomError(
      staking,
      "ZeroAmount"
    );
  });

  it("reverts claim when reward pool is insufficient", async function () {
    const [owner, alice] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("KZNToken");
    const initialSupply = ethers.parseUnits("1000000", 18);
    const token = await Token.deploy(initialSupply);
    await token.waitForDeployment();

    const Staking = await ethers.getContractFactory("KZNStaking");
    const staking = await Staking.deploy(await token.getAddress(), 10_000n, owner.address); // 100% APR
    await staking.waitForDeployment();

    await token.transfer(alice.address, ethers.parseUnits("10000", 18));

    // Intentionally underfund reward pool.
    const tinyRewardPool = ethers.parseUnits("1", 18);
    await token.approve(await staking.getAddress(), tinyRewardPool);
    await staking.fundRewardPool(tinyRewardPool);

    const stakeAmount = ethers.parseUnits("10000", 18);
    await token.connect(alice).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(alice).stake(stakeAmount);

    await networkHelpers.time.increase(365 * 24 * 60 * 60);

    await expect(staking.connect(alice).claimRewards()).to.be.revertedWithCustomError(
      staking,
      "InsufficientRewardPool"
    );
  });

  it("reverts stake of zero", async function () {
    const { alice, staking } = await deployFixture();

    await expect(staking.connect(alice).stake(0)).to.be.revertedWithCustomError(
      staking,
      "ZeroAmount"
    );
  });

  it("exit withdraws stake and claims rewards", async function () {
    const { alice, token, staking } = await deployFixture();

    const stakeAmount = ethers.parseUnits("500", 18);
    await token.connect(alice).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(alice).stake(stakeAmount);

    await networkHelpers.time.increase(20 * 24 * 60 * 60);

    const balanceBefore = await token.balanceOf(alice.address);
    await staking.connect(alice).exit();
    const balanceAfter = await token.balanceOf(alice.address);

    const user = await staking.users(alice.address);
    expect(user.amount).to.equal(0);
    expect(balanceAfter).to.be.gt(balanceBefore);
  });
});