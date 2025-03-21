const { ethers } = require("hardhat");

// Import assertion libraries
let chai;
let expect;

describe("FlashLoanArbitrage", function () {
  let flashLoanArbitrage;
  let deployer;

  before(async function() {
    // Dynamic import for Chai
    chai = await import('chai');
    expect = chai.expect;
  });

  beforeEach(async function () {
    // Get signers
    [deployer] = await ethers.getSigners();

    // Deploy the contract
    const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
    flashLoanArbitrage = await FlashLoanArbitrage.deploy();
    await flashLoanArbitrage.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      const address = await flashLoanArbitrage.getAddress();
      expect(address).to.not.equal(ethers.ZeroAddress);
    });

    it("Should set the right owner", async function () {
      expect(await flashLoanArbitrage.owner()).to.equal(deployer.address);
    });
  });

  describe("Basic Functions", function () {
    it("Should allow the owner to withdraw ETH", async function () {
      // Send some ETH to the contract
      await deployer.sendTransaction({
        to: await flashLoanArbitrage.getAddress(),
        value: ethers.parseEther("1.0")
      });

      // Check contract balance
      const contractBalance = await ethers.provider.getBalance(await flashLoanArbitrage.getAddress());
      expect(contractBalance).to.equal(ethers.parseEther("1.0"));

      // Withdraw ETH
      await flashLoanArbitrage.withdrawETH();

      // Check contract balance after withdrawal
      const contractBalanceAfter = await ethers.provider.getBalance(await flashLoanArbitrage.getAddress());
      expect(contractBalanceAfter).to.equal(0n);
    });
  });

  // In a real test environment, we would also test the flash loan functionality
  // but this requires setting up mock contracts for Aave's lending pool, DEXes, etc.
  describe("Flash Loan (mock tests)", function () {
    it("Should only allow owner to execute arbitrage", async function () {
      const [, nonOwner] = await ethers.getSigners();
      
      // Try to execute arbitrage as non-owner
      try {
        await flashLoanArbitrage.connect(nonOwner).executeArbitrage(
          ethers.ZeroAddress, // tokenA
          ethers.ZeroAddress, // tokenB
          0, // amount
          0, // buyDex
          0, // sellDex
          ethers.ZeroAddress, // curvePoolForBuy
          ethers.ZeroAddress  // curvePoolForSell
        );
        // If we reach here, the transaction didn't revert as expected
        expect.fail("Transaction should have reverted");
      } catch (error) {
        expect(error.message).to.include("Ownable: caller is not the owner");
      }
    });
  });
});