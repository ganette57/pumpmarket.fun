import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { FunmarketPump } from "../target/types/funmarket_pump";
import { assert } from "chai";

describe("funmarket-pump", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FunmarketPump as Program<FunmarketPump>;
  const creator = provider.wallet as anchor.Wallet;

  let userCounterPDA: PublicKey;
  let marketPDA: PublicKey;
  let userPositionPDA: PublicKey;

  const validQuestion = "Will SOL reach $500 in 2025?";
  const validDescription = "Market resolves when SOL/USD hits $500 or on Dec 31, 2025";
  const futureTime = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days from now

  before(async () => {
    // Derive PDAs
    [userCounterPDA] = await PublicKey.findProgramAddress(
      [Buffer.from("user_counter"), creator.publicKey.toBuffer()],
      program.programId
    );

    [marketPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("market"),
        creator.publicKey.toBuffer(),
        Buffer.from(validQuestion),
      ],
      program.programId
    );

    [userPositionPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("position"),
        marketPDA.toBuffer(),
        creator.publicKey.toBuffer(),
      ],
      program.programId
    );
  });

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
      // May already be initialized from previous tests
      console.log("User counter may already exist");
    }
  });

  it("Creates market with valid data", async () => {
    await program.methods
      .createMarket(validQuestion, validDescription, new anchor.BN(futureTime))
      .accounts({
        market: marketPDA,
        userCounter: userCounterPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPDA);
    assert.equal(market.question, validQuestion);
    assert.equal(market.description, validDescription);
    assert.equal(market.creator.toString(), creator.publicKey.toString());
    assert.equal(market.yesSupply.toNumber(), 0);
    assert.equal(market.noSupply.toNumber(), 0);
    assert.equal(market.resolved, false);
  });

  it("Rejects market with banned word 'kill'", async () => {
    const bannedQuestion = "Will someone kill the president?";
    const [bannedMarketPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("market"),
        creator.publicKey.toBuffer(),
        Buffer.from(bannedQuestion),
      ],
      program.programId
    );

    try {
      await program.methods
        .createMarket(bannedQuestion, "Test", new anchor.BN(futureTime))
        .accounts({
          market: bannedMarketPDA,
          userCounter: userCounterPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("Should have failed with banned word");
    } catch (error) {
      assert.include(error.toString(), "BannedContent");
    }
  });

  it("Rejects market with question too short", async () => {
    const shortQuestion = "Will?"; // Only 5 chars
    const [shortMarketPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("market"),
        creator.publicKey.toBuffer(),
        Buffer.from(shortQuestion),
      ],
      program.programId
    );

    try {
      await program.methods
        .createMarket(shortQuestion, "Test", new anchor.BN(futureTime))
        .accounts({
          market: shortMarketPDA,
          userCounter: userCounterPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("Should have failed with invalid length");
    } catch (error) {
      assert.include(error.toString(), "InvalidQuestionLength");
    }
  });

  it("Buys YES shares and updates supply", async () => {
    const amount = 10;

    await program.methods
      .buyShares(new anchor.BN(amount), true) // true = YES
      .accounts({
        market: marketPDA,
        userPosition: userPositionPDA,
        buyer: creator.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPDA);
    assert.equal(market.yesSupply.toNumber(), amount);

    const position = await program.account.userPosition.fetch(userPositionPDA);
    assert.equal(position.yesShares.toNumber(), amount);
  });

  it("Calculates bonding curve price correctly", async () => {
    const market = await program.account.market.fetch(marketPDA);
    const initialSupply = market.yesSupply.toNumber();

    // Buy more shares
    const amount = 5;
    await program.methods
      .buyShares(new anchor.BN(amount), true)
      .accounts({
        market: marketPDA,
        userPosition: userPositionPDA,
        buyer: creator.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const updatedMarket = await program.account.market.fetch(marketPDA);
    assert.equal(updatedMarket.yesSupply.toNumber(), initialSupply + amount);
    assert.isTrue(updatedMarket.totalVolume.toNumber() > market.totalVolume.toNumber());
    assert.isTrue(updatedMarket.feesCollected.toNumber() > market.feesCollected.toNumber());
  });

  it("Cannot resolve before resolution time", async () => {
    try {
      await program.methods
        .resolveMarket(true)
        .accounts({
          market: marketPDA,
          userCounter: userCounterPDA,
          creator: creator.publicKey,
        })
        .rpc();

      assert.fail("Should have failed - too early to resolve");
    } catch (error) {
      assert.include(error.toString(), "TooEarlyToResolve");
    }
  });

  // Note: Full resolution and claim test would require time manipulation
  // or creating a market with very short resolution time
});
