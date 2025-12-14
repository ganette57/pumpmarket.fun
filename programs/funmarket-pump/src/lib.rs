use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("FomHPbnvgSp7qLqAJFkDwut3MygPG9cmyK5TwebSNLTg");

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

    /// Create a new prediction market with multi-choice support
    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        description: String,
        resolution_time: i64,
        market_type: u8,              // 0 = Binary, 1 = Multi-choice
        outcome_names: Vec<String>,   // ["YES", "NO"] or ["ZEC", "XMR", "DASH"]
    ) -> Result<()> {
        // Validate market type
        require!(market_type <= 1, ErrorCode::InvalidMarketType);

        // Validate outcome count
        let outcome_count = outcome_names.len() as u8;
        require!(outcome_count >= 2 && outcome_count <= 10, ErrorCode::InvalidOutcomeCount);

        // Binary markets must have exactly 2 outcomes
        if market_type == 0 {
            require!(outcome_count == 2, ErrorCode::BinaryMustHaveTwoOutcomes);
        }

        // Validate outcome names
        for name in outcome_names.iter() {
            require!(name.len() > 0 && name.len() <= 50, ErrorCode::InvalidOutcomeName);
        }

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
        market.market_type = market_type;
        market.outcome_count = outcome_count;
        let mut names_array: [String; 10] = Default::default();
        for (i, name) in outcome_names.iter().enumerate() {
            if i < 10 {
                names_array[i] = name.clone();
            }
        }
        market.outcome_names = names_array;
        market.outcome_supplies = [0; 10];
        market.total_volume = 0;
        market.fees_collected = 0;
        market.resolved = false;
        market.winning_outcome = None;
        market.bump = ctx.bumps.market;

        // Increment user's active market count
        user_counter.active_markets += 1;

        msg!("Market created: {} (type: {}, outcomes: {})", market.question, market_type, outcome_count);
        Ok(())
    }

    /// Buy shares for a specific outcome with bonding curve pricing
    pub fn buy_shares(
        ctx: Context<BuyShares>,
        amount: u64,
        outcome_index: u8,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(outcome_index < market.outcome_count, ErrorCode::InvalidOutcomeIndex);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp < market.resolution_time, ErrorCode::MarketExpired);

        let current_supply = market.outcome_supplies[outcome_index as usize];
        let cost = calculate_bonding_curve_cost(current_supply, amount);

        // 1% fee to creator + 1% fee to platform = 2% total
        let creator_fee = cost / 100;
        let platform_fee = cost / 100;
        let total_fees = creator_fee + platform_fee;
        let total_cost = cost + total_fees;

        // Transfer SOL from buyer to market
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: market.to_account_info().clone(),
                },
            ),
            cost,
        )?;

        // Transfer 1% fee to creator
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
            ),
            creator_fee,
        )?;

        // Transfer 1% fee to platform
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.platform_wallet.to_account_info(),
                },
            ),
            platform_fee,
        )?;

        market.outcome_supplies[outcome_index as usize] += amount;
        market.total_volume += total_cost;
        market.fees_collected += total_fees;

        let position = &mut ctx.accounts.user_position;
        if position.market == Pubkey::default() {
            position.market = market.key();
            position.user = ctx.accounts.buyer.key();
            position.shares = [0; 10];
            position.claimed = false;
        }

        position.shares[outcome_index as usize] += amount;

        msg!("Bought {} shares for outcome {} ({}) - cost: {} lamports",
             amount, outcome_index, market.outcome_names[outcome_index as usize], total_cost);
        Ok(())
    }

    /// Sell shares back to the bonding curve
    pub fn sell_shares(
        ctx: Context<SellShares>,
        amount: u64,
        outcome_index: u8,
    ) -> Result<()> {
        let market_info = ctx.accounts.market.to_account_info();
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.user_position;

        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(outcome_index < market.outcome_count, ErrorCode::InvalidOutcomeIndex);

        let user_shares = position.shares[outcome_index as usize];
        require!(user_shares >= amount, ErrorCode::InsufficientShares);

        let current_supply = market.outcome_supplies[outcome_index as usize];
        let refund = calculate_bonding_curve_cost(current_supply - amount, amount);

        let creator_fee = refund / 100;
        let platform_fee = refund / 100;
        let total_fees = creator_fee + platform_fee;
        let net_refund = refund - total_fees;

        **market_info.try_borrow_mut_lamports()? -= net_refund;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += net_refund;

        **market_info.try_borrow_mut_lamports()? -= creator_fee;
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += creator_fee;

        **market_info.try_borrow_mut_lamports()? -= platform_fee;
        **ctx.accounts.platform_wallet.to_account_info().try_borrow_mut_lamports()? += platform_fee;

        market.outcome_supplies[outcome_index as usize] -= amount;
        market.fees_collected += total_fees;

        position.shares[outcome_index as usize] -= amount;

        msg!("Sold {} shares for outcome {} - refund: {} lamports",
             amount, outcome_index, net_refund);
        Ok(())
    }

    /// Resolve market with winning outcome index
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        winning_outcome_index: u8,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::AlreadyResolved);
        require!(winning_outcome_index < market.outcome_count, ErrorCode::InvalidOutcomeIndex);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= market.resolution_time, ErrorCode::TooEarlyToResolve);

        market.resolved = true;
        market.winning_outcome = Some(winning_outcome_index);

        let user_counter = &mut ctx.accounts.user_counter;
        user_counter.active_markets = user_counter.active_markets.saturating_sub(1);

        msg!("Market resolved: {} wins", market.outcome_names[winning_outcome_index as usize]);
        Ok(())
    }

    /// Claim winnings after market resolution
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.user_position;

        require!(market.resolved, ErrorCode::MarketNotResolved);
        require!(!position.claimed, ErrorCode::AlreadyClaimed);

        let winning_index = market.winning_outcome.ok_or(ErrorCode::MarketNotResolved)? as usize;
        let winning_shares = position.shares[winning_index];

        require!(winning_shares > 0, ErrorCode::NoWinningShares);

        let total_winning_supply = market.outcome_supplies[winning_index];
        let market_balance = ctx.accounts.market.to_account_info().lamports();

        let payout = (winning_shares as u128)
            .checked_mul(market_balance as u128)
            .unwrap()
            .checked_div(total_winning_supply as u128)
            .unwrap() as u64;

        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += payout;

        position.claimed = true;

        msg!("Claimed {} lamports for {} winning shares", payout, winning_shares);
        Ok(())
    }
}

fn calculate_bonding_curve_cost(current_supply: u64, amount: u64) -> u64 {
    if amount == 0 {
        return 0;
    }
    let base_price = 10_000_000;
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

    /// CHECK: Creator receives 1% fee
    #[account(mut, address = market.creator)]
    pub creator: AccountInfo<'info>,

    /// CHECK: Platform wallet receives 1% fee
    #[account(mut)]
    pub platform_wallet: AccountInfo<'info>,

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

    /// CHECK: Creator receives 1% fee
    #[account(mut, address = market.creator)]
    pub creator: AccountInfo<'info>,

    /// CHECK: Platform wallet receives 1% fee
    #[account(mut)]
    pub platform_wallet: AccountInfo<'info>,

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

    pub market_type: u8,
    pub outcome_count: u8,
    #[max_len(10)]
    pub outcome_names: [String; 10],
    pub outcome_supplies: [u64; 10],

    pub total_volume: u64,
    pub fees_collected: u64,
    pub resolved: bool,
    pub winning_outcome: Option<u8>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub market: Pubkey,
    pub user: Pubkey,
    pub shares: [u64; 10],
    pub claimed: bool,
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
    #[msg("Invalid market type (must be 0 or 1)")]
    InvalidMarketType,
    #[msg("Invalid outcome count (must be 2-10)")]
    InvalidOutcomeCount,
    #[msg("Binary markets must have exactly 2 outcomes")]
    BinaryMustHaveTwoOutcomes,
    #[msg("Invalid outcome name (must be 1-50 characters)")]
    InvalidOutcomeName,
    #[msg("Invalid outcome index")]
    InvalidOutcomeIndex,
    #[msg("Already claimed winnings")]
    AlreadyClaimed,
}
