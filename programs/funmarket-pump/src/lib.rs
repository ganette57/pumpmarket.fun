use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("FunMktPumpXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

#[program]
pub mod funmarket_pump {
    use super::*;

    /// Initialize user counter (rate limiting)
    pub fn initialize_user_counter(ctx: Context<InitializeUserCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.user_counter;
        counter.authority = ctx.accounts.authority.key();
        counter.active_markets = 0;
        Ok(())
    }

    /// Create a new prediction market with strict filters
    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        description: String,
        resolution_time: i64,
    ) -> Result<()> {
        // Banned words filter - STRICT
        const BANNED_WORDS: [&str; 20] = [
            "pedo", "child", "rape", "suicide", "kill", "porn", "dick", "cock",
            "pussy", "fuck", "nigger", "hitler", "terror", "bomb", "isis",
            "murder", "death", "underage", "minor", "assault"
        ];

        let question_lower = question.to_ascii_lowercase();
        let description_lower = description.to_ascii_lowercase();

        for word in BANNED_WORDS.iter() {
            require!(
                !question_lower.contains(word) && !description_lower.contains(word),
                ErrorCode::BannedContent
            );
        }

        // Length limits
        require!(question.len() > 10 && question.len() <= 200, ErrorCode::InvalidQuestionLength);
        require!(description.len() <= 500, ErrorCode::DescriptionTooLong);

        // Resolution time must be in the future
        let clock = Clock::get()?;
        require!(resolution_time > clock.unix_timestamp, ErrorCode::InvalidResolutionTime);

        // Check user doesn't have too many active markets
        let user_counter = &mut ctx.accounts.user_counter;
        require!(user_counter.active_markets < 5, ErrorCode::TooManyActiveMarkets);

        // Initialize market
        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.question = question;
        market.description = description;
        market.resolution_time = resolution_time;
        market.yes_supply = 0;
        market.no_supply = 0;
        market.total_volume = 0;
        market.fees_collected = 0;
        market.resolved = false;
        market.winning_outcome = None;
        market.bump = ctx.bumps.market;

        // Increment user's active market count
        user_counter.active_markets += 1;

        msg!("Market created: {}", market.question);
        Ok(())
    }

    /// Buy YES or NO shares with bonding curve pricing
    pub fn buy_shares(
        ctx: Context<BuyShares>,
        amount: u64,
        is_yes: bool,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::MarketResolved);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp < market.resolution_time, ErrorCode::MarketExpired);

        // Bonding curve: price = 10 * sqrt(supply)
        // Cost = integral from current_supply to (current_supply + amount)
        let current_supply = if is_yes { market.yes_supply } else { market.no_supply };
        let cost = calculate_bonding_curve_cost(current_supply, amount);

        // 1% fee to creator
        let fee = cost / 100;
        let total_cost = cost + fee;

        // Transfer SOL from buyer
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            cost,
        )?;

        // Transfer fee to creator
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
            ),
            fee,
        )?;

        // Update supply
        if is_yes {
            market.yes_supply += amount;
        } else {
            market.no_supply += amount;
        }
        market.total_volume += total_cost;
        market.fees_collected += fee;

        // Initialize or update user position
        let position = &mut ctx.accounts.user_position;
        if position.market == Pubkey::default() {
            position.market = market.key();
            position.user = ctx.accounts.buyer.key();
            position.yes_shares = 0;
            position.no_shares = 0;
        }

        if is_yes {
            position.yes_shares += amount;
        } else {
            position.no_shares += amount;
        }

        msg!("Bought {} {} shares for {} lamports (fee: {})", amount, if is_yes { "YES" } else { "NO" }, cost, fee);
        Ok(())
    }

    /// Sell shares back to the bonding curve
    pub fn sell_shares(
        ctx: Context<SellShares>,
        amount: u64,
        is_yes: bool,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.user_position;

        require!(!market.resolved, ErrorCode::MarketResolved);

        // Check user has enough shares
        let user_shares = if is_yes { position.yes_shares } else { position.no_shares };
        require!(user_shares >= amount, ErrorCode::InsufficientShares);

        // Calculate refund using bonding curve
        let current_supply = if is_yes { market.yes_supply } else { market.no_supply };
        let refund = calculate_bonding_curve_cost(current_supply - amount, amount);

        // 1% fee on sell too
        let fee = refund / 100;
        let net_refund = refund - fee;

        // Transfer refund to seller
        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= net_refund;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += net_refund;

        // Transfer fee to creator
        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= fee;
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += fee;

        // Update supply
        if is_yes {
            market.yes_supply -= amount;
        } else {
            market.no_supply -= amount;
        }
        market.fees_collected += fee;

        // Update position
        if is_yes {
            position.yes_shares -= amount;
        } else {
            position.no_shares -= amount;
        }

        msg!("Sold {} {} shares for {} lamports (fee: {})", amount, if is_yes { "YES" } else { "NO" }, net_refund, fee);
        Ok(())
    }

    /// Resolve market (admin/creator only for MVP, Chainlink later)
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        yes_wins: bool,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::AlreadyResolved);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= market.resolution_time, ErrorCode::TooEarlyToResolve);

        market.resolved = true;
        market.winning_outcome = Some(yes_wins);

        // Decrement creator's active market count
        let user_counter = &mut ctx.accounts.user_counter;
        user_counter.active_markets = user_counter.active_markets.saturating_sub(1);

        msg!("Market resolved: {} wins", if yes_wins { "YES" } else { "NO" });
        Ok(())
    }

    /// Claim winnings after market resolution
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.user_position;

        require!(market.resolved, ErrorCode::MarketNotResolved);

        let winning_outcome = market.winning_outcome.ok_or(ErrorCode::MarketNotResolved)?;
        let winning_shares = if winning_outcome { position.yes_shares } else { position.no_shares };

        require!(winning_shares > 0, ErrorCode::NoWinningShares);

        // Payout = 1 SOL per winning share (simplified for MVP)
        let payout = winning_shares * 1_000_000_000; // 1 SOL in lamports

        // Transfer payout
        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += payout;

        // Clear position
        if winning_outcome {
            position.yes_shares = 0;
        } else {
            position.no_shares = 0;
        }

        msg!("Claimed {} lamports", payout);
        Ok(())
    }
}

/// Calculate cost for buying shares on bonding curve
/// Formula: cost = integral of (10 * sqrt(x)) from current_supply to (current_supply + amount)
/// Simplified: cost = 10 * (2/3) * [(current_supply + amount)^(3/2) - current_supply^(3/2)]
fn calculate_bonding_curve_cost(current_supply: u64, amount: u64) -> u64 {
    if amount == 0 {
        return 0;
    }

    // For simplicity, use linear approximation: price = base + supply * increment
    // This avoids floating point in production. For MVP, use simple formula:
    // cost = amount * (base_price + current_supply / 100)
    let base_price = 10_000_000; // 0.01 SOL in lamports
    let price_per_unit = base_price + (current_supply * 1000);
    amount * price_per_unit
}

// ACCOUNTS

#[derive(Accounts)]
pub struct InitializeUserCounter<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + UserCounter::INIT_SPACE,
        seeds = [b"user_counter", authority.key().as_ref()],
        bump
    )]
    pub user_counter: Account<'info, UserCounter>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(question: String)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", creator.key().as_ref(), question.as_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"user_counter", creator.key().as_ref()],
        bump
    )]
    pub user_counter: Account<'info, UserCounter>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Creator receives fees
    #[account(mut, address = market.creator)]
    pub creator: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellShares<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: Creator receives fees
    #[account(mut, address = market.creator)]
    pub creator: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(
        mut,
        has_one = creator
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"user_counter", creator.key().as_ref()],
        bump
    )]
    pub user_counter: Account<'info, UserCounter>,

    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub user: Signer<'info>,
}

// STATE

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub creator: Pubkey,
    #[max_len(200)]
    pub question: String,
    #[max_len(500)]
    pub description: String,
    pub resolution_time: i64,
    pub yes_supply: u64,
    pub no_supply: u64,
    pub total_volume: u64,
    pub fees_collected: u64,
    pub resolved: bool,
    pub winning_outcome: Option<bool>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub market: Pubkey,
    pub user: Pubkey,
    pub yes_shares: u64,
    pub no_shares: u64,
}

#[account]
#[derive(InitSpace)]
pub struct UserCounter {
    pub authority: Pubkey,
    pub active_markets: u8,
}

// ERRORS

#[error_code]
pub enum ErrorCode {
    #[msg("Content contains banned words - keep it clean!")]
    BannedContent,
    #[msg("Question must be 10-200 characters")]
    InvalidQuestionLength,
    #[msg("Description too long (max 500 chars)")]
    DescriptionTooLong,
    #[msg("Resolution time must be in the future")]
    InvalidResolutionTime,
    #[msg("Market already resolved")]
    MarketResolved,
    #[msg("Market has expired")]
    MarketExpired,
    #[msg("Insufficient shares to sell")]
    InsufficientShares,
    #[msg("Market not resolved yet")]
    MarketNotResolved,
    #[msg("No winning shares to claim")]
    NoWinningShares,
    #[msg("Already resolved")]
    AlreadyResolved,
    #[msg("Too early to resolve market")]
    TooEarlyToResolve,
    #[msg("You have too many active markets (max 5)")]
    TooManyActiveMarkets,
}
