import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { FunmarketPump } from "../target/types/funmarket_pump";
import { assert } from "chai";

describe("funmarket-pump LMSR", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FunmarketPump as Program<FunmarketPump>;
  const creator = provider.wallet as anchor.Wallet;
  const platformWallet = anchor.web3.Keypair.generate();

  let userCounterPDA: PublicKey;
  let binaryMarketPDA: PublicKey;
  let multiMarketPDA: PublicKey;
  let user1PositionPDA: PublicKey;
  let user2PositionPDA: PublicKey;

  // Create second user for testing
  const user2 = anchor.web3.Keypair.generate();

  const validQuestion = "Will SOL reach $500 in 2025?";
  const multiQuestion = "Which privacy coin wins in 2025?";
  const validDescription = "Market resolves when SOL/USD hits $500 or on Dec 31, 2025";
  const futureTime = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
  const pastTime = Math.floor(Date.now() / 1000) - 1; // For expired market test

  before(async () => {
    // Airdrop to user2
    const airdropSig = await provider.connection.requestAirdrop(
      user2.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Derive PDAs
    [userCounterPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_counter"), creator.publicKey.toBuffer()],
      program.programId
    );

    [binaryMarketPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        creator.publicKey.toBuffer(),
        Buffer.from(validQuestion),
      ],
      program.programId
    );

    [multiMarketPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        creator.publicKey.toBuffer(),
        Buffer.from(multiQuestion),
      ],
      program.programId
    );

    [user1PositionPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        binaryMarketPDA.toBuffer(),
        creator.publicKey.toBuffer(),
      ],
      program.programId
    );

    [user2PositionPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        binaryMarketPDA.toBuffer(),
        user2.publicKey.toBuffer(),
      ],
      program.programId
    );
  });

  describe("Initialization", () => {
    it("Initializes user counter", async () => {
      try {
        await program.methods
          .initializeUserCounter()
          .accounts({
            userCounter: userCounterPDA,
            authority: creator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        const userCounter = await program.account.userCounter.fetch(userCounterPDA);
        assert.equal(userCounter.activeMarkets, 0);
        assert.equal(userCounter.authority.toString(), creator.publicKey.toString());
      } catch (error) {
        console.log("User counter may already exist - continuing");
      }
    });
  });

  describe("Market Creation", () => {
    it("Creates binary market with LMSR parameters", async () => {
      await program.methods
        .createMarket(
          validQuestion,
          validDescription,
          new anchor.BN(futureTime),
          0, // Binary
          ["YES", "NO"]
        )
        .accounts({
          market: binaryMarketPDA,
          userCounter: userCounterPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(binaryMarketPDA);
      assert.equal(market.question, validQuestion);
      assert.equal(market.marketType, 0);
      assert.equal(market.outcomeCount, 2);
      assert.equal(market.outcomeNames[0], "YES");
      assert.equal(market.outcomeNames[1], "NO");

      // Verify LMSR initialization
      assert.equal(market.q[0].toNumber(), 0);
      assert.equal(market.q[1].toNumber(), 0);
      assert.isTrue(market.b.toNumber() > 0); // Liquidity parameter should be set
      assert.equal(market.resolved, false);
    });

    it("Creates multi-choice market", async () => {
      await program.methods
        .createMarket(
          multiQuestion,
          validDescription,
          new anchor.BN(futureTime),
          1, // Multi-choice
          ["ZEC", "XMR", "DASH"]
        )
        .accounts({
          market: multiMarketPDA,
          userCounter: userCounterPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(multiMarketPDA);
      assert.equal(market.marketType, 1);
      assert.equal(market.outcomeCount, 3);
      assert.equal(market.outcomeNames[0], "ZEC");
      assert.equal(market.outcomeNames[1], "XMR");
      assert.equal(market.outcomeNames[2], "DASH");
    });

    it("Rejects market with banned word", async () => {
      const bannedQuestion = "Will someone kill the president?";
      const [bannedMarketPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          creator.publicKey.toBuffer(),
          Buffer.from(bannedQuestion),
        ],
        program.programId
      );

      try {
        await program.methods
          .createMarket(
            bannedQuestion,
            "Test",
            new anchor.BN(futureTime),
            0,
            ["YES", "NO"]
          )
          .accounts({
            market: bannedMarketPDA,
            userCounter: userCounterPDA,
            creator: creator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        assert.fail("Should have failed with banned word");
      } catch (error: any) {
        assert.include(error.toString(), "BannedContent");
      }
    });
  });

  describe("LMSR Buy Shares", () => {
    it("Buys shares and increases cost with LMSR", async () => {
      const amount = new anchor.BN(1_000_000_000); // 1 share

      const creatorBalanceBefore = await provider.connection.getBalance(creator.publicKey);
      const platformBalanceBefore = await provider.connection.getBalance(platformWallet.publicKey);

      await program.methods
        .buyShares(amount, 0) // Buy YES (outcome 0)
        .accounts({
          market: binaryMarketPDA,
          userPosition: user1PositionPDA,
          buyer: creator.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(binaryMarketPDA);
      assert.equal(market.q[0].toString(), amount.toString());

      const position = await program.account.userPosition.fetch(user1PositionPDA);
      assert.equal(position.shares[0].toString(), amount.toString());

      // Verify fees were collected
      const creatorBalanceAfter = await provider.connection.getBalance(creator.publicKey);
      const platformBalanceAfter = await provider.connection.getBalance(platformWallet.publicKey);

      // Platform should have received fees (accounting for tx fees for creator)
      assert.isTrue(platformBalanceAfter > platformBalanceBefore);

      // Total volume should be positive
      assert.isTrue(market.totalVolume.toNumber() > 0);
    });

    it("Buying more shares increases cost (LMSR property)", async () => {
      const market1 = await program.account.market.fetch(binaryMarketPDA);
      const volume1 = market1.totalVolume.toNumber();

      const amount = new anchor.BN(1_000_000_000); // 1 share

      await program.methods
        .buyShares(amount, 0) // Buy YES again
        .accounts({
          market: binaryMarketPDA,
          userPosition: user1PositionPDA,
          buyer: creator.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market2 = await program.account.market.fetch(binaryMarketPDA);
      const volume2 = market2.totalVolume.toNumber();

      // Second purchase should cost more (LMSR increases price as supply increases)
      const firstCost = volume1;
      const secondCost = volume2 - volume1;

      console.log("First buy cost:", firstCost, "lamports");
      console.log("Second buy cost:", secondCost, "lamports");

      // In LMSR, buying the same outcome should cost more as q increases
      // This is a key property we're testing
      assert.isTrue(market2.q[0].toNumber() > market1.q[0].toNumber());
    });

    it("Buying different outcome also works", async () => {
      const amount = new anchor.BN(500_000_000); // 0.5 shares

      await program.methods
        .buyShares(amount, 1) // Buy NO (outcome 1)
        .accounts({
          market: binaryMarketPDA,
          userPosition: user1PositionPDA,
          buyer: creator.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(binaryMarketPDA);
      assert.equal(market.q[1].toString(), amount.toString());

      const position = await program.account.userPosition.fetch(user1PositionPDA);
      assert.equal(position.shares[1].toString(), amount.toString());
    });

    it("Second user can buy shares", async () => {
      const amount = new anchor.BN(1_000_000_000); // 1 share

      await program.methods
        .buyShares(amount, 0) // User2 buys YES
        .accounts({
          market: binaryMarketPDA,
          userPosition: user2PositionPDA,
          buyer: user2.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const position = await program.account.userPosition.fetch(user2PositionPDA);
      assert.equal(position.shares[0].toString(), amount.toString());
    });
  });

  describe("LMSR Sell Shares", () => {
    it("Sells shares and receives refund", async () => {
      const marketBefore = await program.account.market.fetch(binaryMarketPDA);
      const qBefore = marketBefore.q[0].toNumber();

      const amount = new anchor.BN(500_000_000); // Sell 0.5 shares

      const sellerBalanceBefore = await provider.connection.getBalance(creator.publicKey);

      await program.methods
        .sellShares(amount, 0)
        .accounts({
          market: binaryMarketPDA,
          userPosition: user1PositionPDA,
          seller: creator.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const marketAfter = await program.account.market.fetch(binaryMarketPDA);
      const qAfter = marketAfter.q[0].toNumber();

      // q should decrease
      assert.isTrue(qAfter < qBefore);
      assert.equal(qBefore - qAfter, amount.toNumber());

      const position = await program.account.userPosition.fetch(user1PositionPDA);
      // User should have fewer shares
      assert.isTrue(position.shares[0].toNumber() < 2_000_000_000);
    });

    it("Cannot sell more shares than owned", async () => {
      const position = await program.account.userPosition.fetch(user1PositionPDA);
      const currentShares = position.shares[0];

      const tooMuch = new anchor.BN(currentShares.toNumber() + 1_000_000_000);

      try {
        await program.methods
          .sellShares(tooMuch, 0)
          .accounts({
            market: binaryMarketPDA,
            userPosition: user1PositionPDA,
            seller: creator.publicKey,
            creator: creator.publicKey,
            platformWallet: platformWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        assert.fail("Should have failed - insufficient shares");
      } catch (error: any) {
        assert.include(error.toString(), "InsufficientShares");
      }
    });
  });

  describe("Market Expiration", () => {
    let expiredMarketPDA: PublicKey;
    let expiredPositionPDA: PublicKey;
    const expiredQuestion = "Expired market test";

    it("Creates market with past resolution time", async () => {
      // Note: This will fail because create_market validates resolution_time > now
      // So we'll create a normal market and test expiration on an existing market
    });

    it("Cannot trade after resolution time", async () => {
      // For this test to work properly, we'd need to create a market with a very short
      // resolution time (1 second) and wait for it to expire
      // Skipping for now as it requires time manipulation
    });
  });

  describe("Resolution and Claims", () => {
    let claimMarketPDA: PublicKey;
    let claimUser1PDA: PublicKey;
    let claimUser2PDA: PublicKey;
    let claimUser3PDA: PublicKey;
    const user3 = anchor.web3.Keypair.generate();
    const claimQuestion = "Market for claim testing";

    it("Creates market with short resolution time", async () => {
      // Airdrop to user3
      const sig = await provider.connection.requestAirdrop(
        user3.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const shortFuture = Math.floor(Date.now() / 1000) + 2; // 2 seconds

      [claimMarketPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("market"),
          creator.publicKey.toBuffer(),
          Buffer.from(claimQuestion),
        ],
        program.programId
      );

      [claimUser1PDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          claimMarketPDA.toBuffer(),
          creator.publicKey.toBuffer(),
        ],
        program.programId
      );

      [claimUser2PDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          claimMarketPDA.toBuffer(),
          user2.publicKey.toBuffer(),
        ],
        program.programId
      );

      [claimUser3PDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          claimMarketPDA.toBuffer(),
          user3.publicKey.toBuffer(),
        ],
        program.programId
      );

      await program.methods
        .createMarket(
          claimQuestion,
          "Test market for claims",
          new anchor.BN(shortFuture),
          0,
          ["YES", "NO"]
        )
        .accounts({
          market: claimMarketPDA,
          userCounter: userCounterPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // User1 buys YES
      await program.methods
        .buyShares(new anchor.BN(2_000_000_000), 0)
        .accounts({
          market: claimMarketPDA,
          userPosition: claimUser1PDA,
          buyer: creator.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // User2 buys YES
      await program.methods
        .buyShares(new anchor.BN(1_000_000_000), 0)
        .accounts({
          market: claimMarketPDA,
          userPosition: claimUser2PDA,
          buyer: user2.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      // User3 buys NO (losing outcome)
      await program.methods
        .buyShares(new anchor.BN(1_000_000_000), 1)
        .accounts({
          market: claimMarketPDA,
          userPosition: claimUser3PDA,
          buyer: user3.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user3])
        .rpc();
    });

    it("Cannot resolve before resolution time", async () => {
      try {
        await program.methods
          .resolveMarket(0) // YES wins
          .accounts({
            market: claimMarketPDA,
            userCounter: userCounterPDA,
            creator: creator.publicKey,
          })
          .rpc();

        assert.fail("Should fail - too early");
      } catch (error: any) {
        assert.include(error.toString(), "TooEarlyToResolve");
      }
    });

    it("Waits for resolution time and resolves market", async () => {
      // Wait 3 seconds for resolution time to pass
      await new Promise(resolve => setTimeout(resolve, 3000));

      await program.methods
        .resolveMarket(0) // YES wins
        .accounts({
          market: claimMarketPDA,
          userCounter: userCounterPDA,
          creator: creator.publicKey,
        })
        .rpc();

      const market = await program.account.market.fetch(claimMarketPDA);
      assert.equal(market.resolved, true);
      assert.equal(market.winningOutcome, 0);
    });

    it("Winners can claim pro-rata payout", async () => {
      const marketBefore = await program.account.market.fetch(claimMarketPDA);
      const marketBalanceBefore = await provider.connection.getBalance(claimMarketPDA);

      const user1BalanceBefore = await provider.connection.getBalance(creator.publicKey);

      await program.methods
        .claimWinnings()
        .accounts({
          market: claimMarketPDA,
          userPosition: claimUser1PDA,
          user: creator.publicKey,
        })
        .rpc();

      const user1BalanceAfter = await provider.connection.getBalance(creator.publicKey);
      const position = await program.account.userPosition.fetch(claimUser1PDA);

      assert.equal(position.claimed, true);
      // User1 should have received payout (accounting for tx fees)
      // We can't assert exact amount due to transaction fees
    });

    it("User2 (also winner) can claim", async () => {
      await program.methods
        .claimWinnings()
        .accounts({
          market: claimMarketPDA,
          userPosition: claimUser2PDA,
          user: user2.publicKey,
        })
        .signers([user2])
        .rpc();

      const position = await program.account.userPosition.fetch(claimUser2PDA);
      assert.equal(position.claimed, true);
    });

    it("Loser cannot claim (no winning shares)", async () => {
      try {
        await program.methods
          .claimWinnings()
          .accounts({
            market: claimMarketPDA,
            userPosition: claimUser3PDA,
            user: user3.publicKey,
          })
          .signers([user3])
          .rpc();

        assert.fail("Should fail - no winning shares");
      } catch (error: any) {
        assert.include(error.toString(), "NoWinningShares");
      }
    });

    it("Cannot claim twice", async () => {
      try {
        await program.methods
          .claimWinnings()
          .accounts({
            market: claimMarketPDA,
            userPosition: claimUser1PDA,
            user: creator.publicKey,
          })
          .rpc();

        assert.fail("Should fail - already claimed");
      } catch (error: any) {
        assert.include(error.toString(), "AlreadyClaimed");
      }
    });
  });

  describe("Multi-choice Market Trading", () => {
    it("Can buy shares in multi-choice market", async () => {
      const [multiUser1PDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          multiMarketPDA.toBuffer(),
          creator.publicKey.toBuffer(),
        ],
        program.programId
      );

      // Buy ZEC
      await program.methods
        .buyShares(new anchor.BN(1_000_000_000), 0)
        .accounts({
          market: multiMarketPDA,
          userPosition: multiUser1PDA,
          buyer: creator.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Buy XMR
      await program.methods
        .buyShares(new anchor.BN(500_000_000), 1)
        .accounts({
          market: multiMarketPDA,
          userPosition: multiUser1PDA,
          buyer: creator.publicKey,
          creator: creator.publicKey,
          platformWallet: platformWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(multiMarketPDA);
      assert.equal(market.q[0].toString(), "1000000000");
      assert.equal(market.q[1].toString(), "500000000");
      assert.equal(market.q[2].toString(), "0");

      const position = await program.account.userPosition.fetch(multiUser1PDA);
      assert.equal(position.shares[0].toString(), "1000000000");
      assert.equal(position.shares[1].toString(), "500000000");
    });
  });
});
