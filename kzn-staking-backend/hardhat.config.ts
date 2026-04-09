import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import dotenv from "dotenv";
dotenv.config();

const privateKey = process.env.PRIVATE_KEY!;
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL!;

if (!privateKey || !sepoliaRpcUrl) {
  throw new Error("Missing environment variables");
}

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    
    sepolia: {
      type: "http",
      chainType: "l1", //11155111
      url: sepoliaRpcUrl,
      accounts: [privateKey],
    },
  },
  
});
