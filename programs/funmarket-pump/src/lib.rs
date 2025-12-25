use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

declare_id!("FomHPbnvgSp7qLqAJFkDwut3MygPG9cmyK5TwebSNLTg");

pub mod math;

/* ------------------------------ constants ------------------------------ */

pub const MAX_OUTCOMES: usize = 10;
pub const MAX_NAME_LEN: usize = 40; // keep this <= what you budget in Market::SPACE

// Fees (bps)
pub const PLATFORM_FEE_BPS: u64 = 100; // 1%
pub const CREATOR_FEE_BPS: u64 = 200;  // 2%
pub const TOTAL_FEE_BPS: u64 = 300;    // 3% (informational)

/* ------------------------------ program ------------------------------ */

#[program]
pub mod funmarket_pump {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        resolution_time: i64,
        outcome_names: Vec<String>,
        market_type: u8, // 0=binary, 1=multi
        b_lamports: u64,
        // anti-manip config
        max_position_bps: u16, // 500..9000 (5%..90%), 10_000 disables
        max_trade_shares: u64, // 1..5_000_000
        cooldown_seconds: i64, // 0..120
    ) -> Result<()> {
        // outcomes
        require!(
            outcome_names.len() >= 2 && outcome_names.len() <= MAX_OUTCOMES,
            ErrorCode::InvalidOutcomes
        );

        // binary must have exactly 2
        if market_type == 0 {
            require!(outcome_names.len() == 2, ErrorCode::InvalidOutcomes);
        }
        require!(market_type == 0 || market_type == 1, ErrorCode::InvalidOutcomes);

        // validate names length (important: account space is fixed)
        for n in outcome_names.iter() {
            let s = n.trim();
            require!(!s.is_empty(), ErrorCode::InvalidOutcomes);
            require!(s.as_bytes().len() <= MAX_NAME_LEN, ErrorCode::InvalidOutcomes);
        }

        // time
        let now = Clock::get()?.unix_timestamp;
        require!(resolution_time > now, ErrorCode::InvalidResolutionTime);

        // b
        require!(b_lamports > 0, ErrorCode::InvalidB);

        // anti-manip guard rails
        // allow 10_000 as "disabled"
        require!(
            (max_position_bps >= 500 && max_position_bps <= 9000) || max_position_bps == 10_000,
            ErrorCode::InvalidAntiManip
        );
        require!(
            max_trade_shares >= 1 && max_trade_shares <= 5_000_000,
            ErrorCode::InvalidAntiManip
        );
        require!(
            cooldown_seconds >= 0 && cooldown_seconds <= 120,
            ErrorCode::InvalidAntiManip
        );

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.resolution_time = resolution_time;
        market.resolved = false;
        market.winning_outcome = None;

        market.market_type = market_type;
        market.outcome_count = outcome_names.len() as u8;

        market.b_lamports = b_lamports;
        market.q = [0u64; MAX_OUTCOMES];

        market.max_position_bps = max_position_bps;
        market.max_trade_shares = max_trade_shares;
        market.cooldown_seconds = cooldown_seconds;

        market.outcome_names = outcome_names;

        Ok(())
    }

    pub fn buy_shares(ctx: Context<Trade>, shares: u64, outcome_index: u8) -> Result<()> {
        // immutable first
        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.market.key();

        let trader_ai = ctx.accounts.trader.to_account_info();
        let market_ai = ctx.accounts.market.to_account_info();
        let system_ai = ctx.accounts.system_program.to_account_info();
        let platform_ai = ctx.accounts.platform_wallet.to_account_info();
        let creator_ai = ctx.accounts.creator.to_account_info();

        // mut borrows
        let market = &mut ctx.accounts.market;
        let pos = &mut ctx.accounts.user_position;

        require!(!market.resolved, ErrorCode::MarketResolved);
        let now = Clock::get()?.unix_timestamp;
        require!(now < market.resolution_time, ErrorCode::MarketClosed);

        require!(shares > 0, ErrorCode::InvalidShares);
        require!(shares <= market.max_trade_shares, ErrorCode::TradeTooLarge);

        // init_if_needed
        if pos.market == Pubkey::default() {
            pos.market = market_key;
            pos.user = trader_key;
            pos.shares = [0u64; MAX_OUTCOMES];
            pos.claimed = false;
            pos.last_trade_ts = 0;
        } else {
            require!(pos.market == market_key, ErrorCode::InvalidUserPosition);
            require!(pos.user == trader_key, ErrorCode::InvalidUserPosition);
        }

        if market.cooldown_seconds > 0 && pos.last_trade_ts > 0 {
            require!(
                now - pos.last_trade_ts >= market.cooldown_seconds,
                ErrorCode::CooldownActive
            );
        }

        let idx = outcome_index as usize;
        require!(idx < market.outcome_count as usize, ErrorCode::InvalidOutcomeIndex);

        // LMSR cost excluding fees
        let cost = lmsr_buy_cost_lamports(
            &market.q,
            idx,
            shares,
            market.b_lamports,
            market.outcome_count,
        )?;
        require!(cost > 0, ErrorCode::InvalidCost);

        let platform_fee = cost.saturating_mul(PLATFORM_FEE_BPS) / 10_000;
        let creator_fee = cost.saturating_mul(CREATOR_FEE_BPS) / 10_000;

        let total_pay = cost
            .checked_add(platform_fee)
            .ok_or(ErrorCode::Overflow)?
            .checked_add(creator_fee)
            .ok_or(ErrorCode::Overflow)?;

        // transfer trader -> market (gross)
        invoke(
            &system_instruction::transfer(&trader_key, &market_key, total_pay),
            &[trader_ai.clone(), market_ai.clone(), system_ai],
        )?;

        // distribute fees from market -> recipients
        if platform_fee > 0 {
            **market_ai.try_borrow_mut_lamports()? = market_ai.lamports().saturating_sub(platform_fee);
            **platform_ai.try_borrow_mut_lamports()? = platform_ai.lamports().saturating_add(platform_fee);
        }
        if creator_fee > 0 {
            **market_ai.try_borrow_mut_lamports()? = market_ai.lamports().saturating_sub(creator_fee);
            **creator_ai.try_borrow_mut_lamports()? = creator_ai.lamports().saturating_add(creator_fee);
        }

        // update state
        market.q[idx] = market.q[idx].checked_add(shares).ok_or(ErrorCode::Overflow)?;
        pos.shares[idx] = pos.shares[idx].checked_add(shares).ok_or(ErrorCode::Overflow)?;
        pos.last_trade_ts = now;

        // anti-manip cap (total market supply based)
        enforce_position_cap(market, pos, idx)?;

        Ok(())
    }

    pub fn sell_shares(ctx: Context<Trade>, shares: u64, outcome_index: u8) -> Result<()> {
        // immutable first
        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.market.key();

        let trader_ai = ctx.accounts.trader.to_account_info();
        let market_ai = ctx.accounts.market.to_account_info();
        let platform_ai = ctx.accounts.platform_wallet.to_account_info();
        let creator_ai = ctx.accounts.creator.to_account_info();

        // mut borrows
        let market = &mut ctx.accounts.market;
        let pos = &mut ctx.accounts.user_position;

        require!(!market.resolved, ErrorCode::MarketResolved);
        let now = Clock::get()?.unix_timestamp;
        require!(now < market.resolution_time, ErrorCode::MarketClosed);

        require!(shares > 0, ErrorCode::InvalidShares);
        require!(shares <= market.max_trade_shares, ErrorCode::TradeTooLarge);

        // init_if_needed
        if pos.market == Pubkey::default() {
            pos.market = market_key;
            pos.user = trader_key;
            pos.shares = [0u64; MAX_OUTCOMES];
            pos.claimed = false;
            pos.last_trade_ts = 0;
        } else {
            require!(pos.market == market_key, ErrorCode::InvalidUserPosition);
            require!(pos.user == trader_key, ErrorCode::InvalidUserPosition);
        }

        if market.cooldown_seconds > 0 && pos.last_trade_ts > 0 {
            require!(
                now - pos.last_trade_ts >= market.cooldown_seconds,
                ErrorCode::CooldownActive
            );
        }

        let idx = outcome_index as usize;
        require!(idx < market.outcome_count as usize, ErrorCode::InvalidOutcomeIndex);
        require!(pos.shares[idx] >= shares, ErrorCode::NotEnoughShares);

        // LMSR refund excluding fees
        let refund = lmsr_sell_refund_lamports(
            &market.q,
            idx,
            shares,
            market.b_lamports,
            market.outcome_count,
        )?;
        require!(refund > 0, ErrorCode::InvalidCost);

        let platform_fee = refund.saturating_mul(PLATFORM_FEE_BPS) / 10_000;
        let creator_fee = refund.saturating_mul(CREATOR_FEE_BPS) / 10_000;

        let net_receive = refund
            .checked_sub(platform_fee)
            .ok_or(ErrorCode::Overflow)?
            .checked_sub(creator_fee)
            .ok_or(ErrorCode::Overflow)?;

        // market must have enough to cover gross refund
        require!(market_ai.lamports() >= refund, ErrorCode::InsufficientMarketBalance);

        // pay trader net
        **market_ai.try_borrow_mut_lamports()? = market_ai.lamports().saturating_sub(net_receive);
        **trader_ai.try_borrow_mut_lamports()? = trader_ai.lamports().saturating_add(net_receive);

        // distribute fees
        if platform_fee > 0 {
            **market_ai.try_borrow_mut_lamports()? = market_ai.lamports().saturating_sub(platform_fee);
            **platform_ai.try_borrow_mut_lamports()? = platform_ai.lamports().saturating_add(platform_fee);
        }
        if creator_fee > 0 {
            **market_ai.try_borrow_mut_lamports()? = market_ai.lamports().saturating_sub(creator_fee);
            **creator_ai.try_borrow_mut_lamports()? = creator_ai.lamports().saturating_add(creator_fee);
        }

        // update state
        market.q[idx] = market.q[idx].checked_sub(shares).ok_or(ErrorCode::Overflow)?;
        pos.shares[idx] = pos.shares[idx].checked_sub(shares).ok_or(ErrorCode::Overflow)?;
        pos.last_trade_ts = now;

        Ok(())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, winning_outcome: u8) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::MarketResolved);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= market.resolution_time, ErrorCode::MarketNotEnded);

        let idx = winning_outcome as usize;
        require!(idx < market.outcome_count as usize, ErrorCode::InvalidOutcomeIndex);

        market.resolved = true;
        market.winning_outcome = Some(winning_outcome);
        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market_ai = ctx.accounts.market.to_account_info();
        let user_ai = ctx.accounts.user.to_account_info();

        let market = &mut ctx.accounts.market;
        let pos = &mut ctx.accounts.user_position;

        require!(market.resolved, ErrorCode::MarketNotResolved);
        require!(!pos.claimed, ErrorCode::AlreadyClaimed);

        let winning = market.winning_outcome.ok_or(ErrorCode::MarketNotResolved)? as usize;

        let user_shares = pos.shares[winning];
        require!(user_shares > 0, ErrorCode::NoWinningShares);

        let total_winning_supply = market.q[winning];
        require!(total_winning_supply > 0, ErrorCode::InvalidSupply);

        let pool = market_ai.lamports();

        let payout = (user_shares as u128)
            .checked_mul(pool as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(total_winning_supply as u128)
            .ok_or(ErrorCode::Overflow)? as u64;

        require!(payout > 0, ErrorCode::InvalidPayout);
        require!(pool >= payout, ErrorCode::InsufficientMarketBalance);

        **market_ai.try_borrow_mut_lamports()? = market_ai.lamports().saturating_sub(payout);
        **user_ai.try_borrow_mut_lamports()? = user_ai.lamports().saturating_add(payout);

        pos.claimed = true;
        Ok(())
    }
}

/* ------------------------------ anti-manip ------------------------------ */
/**
Cap per wallet on an outcome, but computed from TOTAL market supply (sum(q)),
not from the outcome supply itself (otherwise bootstrap is impossible).
We also skip enforcement until market has some depth.
*/
fn enforce_position_cap(market: &Market, pos: &UserPosition, idx: usize) -> Result<()> {
    let max_bps = market.max_position_bps as u64;

    // disabled
    if max_bps >= 10_000 {
        return Ok(());
    }

    // total market supply across outcomes
    let mut total: u128 = 0;
    for i in 0..(market.outcome_count as usize) {
        total = total
            .checked_add(market.q[i] as u128)
            .ok_or(ErrorCode::Overflow)?;
    }

    // bootstrap: don't enforce until there's at least "one trade worth" of depth
    if total < market.max_trade_shares as u128 {
        return Ok(());
    }

    let user: u128 = pos.shares[idx] as u128;

    let max_allowed: u128 = total
        .checked_mul(max_bps as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_div(10_000u128)
        .ok_or(ErrorCode::Overflow)?;

        require!(user <= max_allowed, ErrorCode::PositionCapExceeded);
    Ok(())
}

/* ------------------------------ LMSR wrappers ------------------------------ */

fn lmsr_buy_cost_lamports(
    q: &[u64; MAX_OUTCOMES],
    outcome_index: usize,
    amount: u64,
    b_lamports: u64,
    outcome_count: u8,
) -> Result<u64> {
    require!(outcome_index < outcome_count as usize, ErrorCode::InvalidOutcomeIndex);
    math::lmsr_buy_cost(q, b_lamports, outcome_index as u8, amount, outcome_count)
        .map_err(|_| error!(ErrorCode::MathOverflow))
}

fn lmsr_sell_refund_lamports(
    q: &[u64; MAX_OUTCOMES],
    outcome_index: usize,
    amount: u64,
    b_lamports: u64,
    outcome_count: u8,
) -> Result<u64> {
    require!(outcome_index < outcome_count as usize, ErrorCode::InvalidOutcomeIndex);
    math::lmsr_sell_refund(q, b_lamports, outcome_index as u8, amount, outcome_count)
        .map_err(|_| error!(ErrorCode::MathOverflow))
}

/* -------------------------------- accounts -------------------------------- */

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = Market::SPACE,
    )]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = trader,
        space = UserPosition::SPACE,
        seeds = [b"user_position", market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    /// CHECK: platform wallet (fee receiver)
    #[account(mut)]
    pub platform_wallet: UncheckedAccount<'info>,

    /// CHECK: creator wallet (fee receiver)
    #[account(mut, address = market.creator)]
    pub creator: UncheckedAccount<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut, has_one = creator)]
    pub market: Account<'info, Market>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"user_position", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub user: Signer<'info>,
}

/* --------------------------------- state --------------------------------- */

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub resolution_time: i64,
    pub resolved: bool,
    pub winning_outcome: Option<u8>,

    pub market_type: u8,    // 0=binary, 1=multi
    pub outcome_count: u8,  // 2..10

    // LMSR
    pub b_lamports: u64,
    pub q: [u64; MAX_OUTCOMES],

    // anti-manip config
    pub max_position_bps: u16,
    pub max_trade_shares: u64,
    pub cooldown_seconds: i64,

    pub outcome_names: Vec<String>,
}

impl Market {
    // Allocate enough space for MAX_OUTCOMES names of MAX_NAME_LEN each.
    pub const SPACE: usize =
        8 +                    // discriminator
        32 +                   // creator
        8 +                    // resolution_time
        1 +                    // resolved
        1 + 1 +                // Option<u8>
        1 +                    // market_type
        1 +                    // outcome_count
        8 +                    // b_lamports
        (8 * MAX_OUTCOMES) +   // q
        2 +                    // max_position_bps
        8 +                    // max_trade_shares
        8 +                    // cooldown_seconds (i64)
        4 +                    // vec len
        (MAX_OUTCOMES * (4 + MAX_NAME_LEN)); // each string: 4 + bytes
}

#[account]
pub struct UserPosition {
    pub market: Pubkey,
    pub user: Pubkey,
    pub shares: [u64; MAX_OUTCOMES],
    pub claimed: bool,
    pub last_trade_ts: i64,
}

impl UserPosition {
    pub const SPACE: usize = 8 + 32 + 32 + (8 * MAX_OUTCOMES) + 1 + 8;
}

/* --------------------------------- errors -------------------------------- */

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid outcomes")]
    InvalidOutcomes,
    #[msg("Invalid resolution time")]
    InvalidResolutionTime,
    #[msg("Invalid liquidity parameter b")]
    InvalidB,

    #[msg("Market is closed (past end time)")]
    MarketClosed,
    #[msg("Market already resolved")]
    MarketResolved,
    #[msg("Market not ended yet")]
    MarketNotEnded,
    #[msg("Market not resolved")]
    MarketNotResolved,

    #[msg("Invalid shares")]
    InvalidShares,
    #[msg("Invalid outcome index")]
    InvalidOutcomeIndex,

    #[msg("Trade too large")]
    TradeTooLarge,
    #[msg("Cooldown active: wait before trading again")]
    CooldownActive,
    #[msg("Position cap exceeded for this outcome")]
    PositionCapExceeded,
    #[msg("Invalid anti-manip config")]
    InvalidAntiManip,

    #[msg("Not enough shares to sell")]
    NotEnoughShares,

    #[msg("Invalid cost/refund")]
    InvalidCost,
    #[msg("Invalid payout")]
    InvalidPayout,
    #[msg("No winning shares to claim")]
    NoWinningShares,
    #[msg("Invalid supply")]
    InvalidSupply,
    #[msg("Already claimed")]
    AlreadyClaimed,

    #[msg("Insufficient market balance")]
    InsufficientMarketBalance,

    #[msg("Invalid user position account")]
    InvalidUserPosition,

    #[msg("Overflow")]
    Overflow,

    // used by math.rs
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid liquidity parameter")]
    InvalidLiquidityParameter,
    #[msg("Invalid outcome count")]
    InvalidOutcomeCount,
    #[msg("Insufficient shares")]
    InsufficientShares,
}