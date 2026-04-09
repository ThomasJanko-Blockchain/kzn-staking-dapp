// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract KZNStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public aprBps; // 1200 = 12%

   struct UserInfo {
        uint256 amount;         // currently staked
        uint256 rewardsStored;  // accumulated but not claimed
        uint256 lastUpdate;     // last reward update timestamp
    }

    mapping(address => UserInfo) public users;
    uint256 public totalStaked;
    uint256 public rewardPool; // accounting of funded rewards

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 reward);
    event RewardPoolFunded(uint256 amount);
    event AprUpdated(uint256 oldAprBps, uint256 newAprBps);

    error ZeroAmount();
    error NoRewards();
    error InsufficientStake();
    error InsufficientRewardPool();

    constructor(address _stakingToken, uint256 _aprBps, address _owner) Ownable(_owner) {
        require(_stakingToken != address(0), "token zero");
        require(_aprBps <= BPS_DENOMINATOR, "apr too high");
        stakingToken = IERC20(_stakingToken);
        aprBps = _aprBps;
    }

    function fundRewardPool(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardPool += amount;
        emit RewardPoolFunded(amount);
    }

    function setAprBps(uint256 newAprBps) external onlyOwner {
        require(newAprBps <= BPS_DENOMINATOR, "apr too high");
        uint256 oldAprBps = aprBps;
        aprBps = newAprBps;
        emit AprUpdated(oldAprBps, newAprBps);
    }

    function stake(uint256 amount) external nonReentrant {
        if(amount == 0) revert ZeroAmount();

        UserInfo storage user = users[msg.sender];
        _updateRewards(msg.sender);
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        user.amount += amount;
        totalStaked += amount;

        emit Staked(msg.sender, amount);

    }

    function withdraw(uint256 amount) public nonReentrant {
        if(amount == 0) revert ZeroAmount();

        UserInfo storage user = users[msg.sender];
        if(user.amount < amount) revert InsufficientStake();
        _updateRewards(msg.sender);
        user.amount -= amount;
        totalStaked -= amount;
        stakingToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);

    }

    function claimRewards() public nonReentrant {
        UserInfo storage user = users[msg.sender];
        _updateRewards(msg.sender);

        uint256 rewards = user.rewardsStored;
        if(rewards == 0) revert ZeroAmount();
        if(rewards > rewardPool) revert InsufficientRewardPool();

        user.rewardsStored = 0;
        rewardPool -= rewards;
        
        stakingToken.safeTransfer(msg.sender, rewards);

        emit RewardsClaimed(msg.sender, rewards);

    }

    function exit() external nonReentrant {
        UserInfo storage user = users[msg.sender];
        _updateRewards(msg.sender);

        uint256 stakedAmount = user.amount;
        uint256 rewards = user.rewardsStored;

        if(stakedAmount > 0) {
            user.amount = 0;
            totalStaked -= stakedAmount;
            stakingToken.safeTransfer(msg.sender, stakedAmount);
            emit Withdrawn(msg.sender, stakedAmount);
        }

        if(rewards > 0) {
            if(rewards > rewardPool) revert InsufficientRewardPool();
            user.rewardsStored = 0;
            rewardPool -= rewards;
            stakingToken.safeTransfer(msg.sender, rewards);
            emit RewardsClaimed(msg.sender, rewards);
        }
    } 

    function pendingRewards(address account) public view returns (uint256) {
        UserInfo storage user = users[account];
        if(user.amount == 0 || user.lastUpdate == 0) return user.rewardsStored;

        uint256 elapsed = block.timestamp - user.lastUpdate;
        uint256 newlyAccrued = (user.amount * aprBps * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        return user.rewardsStored + newlyAccrued;
    }

    function _updateRewards(address account) internal {
        UserInfo storage user = users[account];
        if(user.lastUpdate == 0) {
            user.lastUpdate = block.timestamp;
            return;
        }

        if(user.amount > 0) {
            uint256 elapsed = block.timestamp - user.lastUpdate;
            uint256 newlyAccrued = (user.amount * aprBps * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
            user.rewardsStored += newlyAccrued;
        }

        user.lastUpdate = block.timestamp;
    }



}