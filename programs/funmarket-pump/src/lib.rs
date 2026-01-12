// programs/funmarket-pump/src/lib.rs
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

declare_id!("A2EqnLDYW1WAi8mhR12ncGVvt92G3jisJqCe46YoV7SJ");

pub mod math;

/* ============================== CONSTANTS ============================== */

pub const MAX_OUTCOMES: usize = 10;
pub const MAX_NAME_LEN: usize = 40;

// Fees (bps)
pub const PLATFORM_FEE_BPS: u64 = 100; // 1%
pub const CREATOR_FEE_BPS: u64 = 200;  // 2%
pub const TOTAL_FEE_BPS: u64 = 300;    // 3% informational

// Windows
pub const CREATOR_PROPOSE_WINDOW: i64 = 48 * 3600; // 48h
pub const DISPUTE_WINDOW: i64 = 24 * 3600;         // 24h

// Anti-manip limits
pub const MAX_TRADE_SHARES_HARD: u64 = 5_000_000;

// ✅ Put your real values here (mainnet later).
// For now you can keep them as defaults and pass in as accounts, but having constants reduces footguns.
use anchor_lang::prelude::pubkey;

pub const PLATFORM_WALLET: Pubkey =
    pubkey!("6szhvTU23WtiKXqPs8vuX5G7JXu2TcUdVJNByNwVGYMV");

// ✅ Admin key (your wallet) for dispute resolution (ONLY used if disputes > 0)
pub const ADMIN_AUTHORITY: Pubkey =
    pubkey!("2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y");

/* ============================== PROGRAM ============================== */

#[program]
pub mod funmarket_pump {
    use super::*;

    /* ---------- CREATE ---------- */

    pub fn create_market(
        ctx: Context<CreateMarket>,
        resolution_time: i64,
        outcome_names: Vec<String>,
        market_type: u8, // 0=binary, 1=multi
        b_lamports: u64,

        // anti-manip config
        max_position_bps: u16, // 500..9000, 10_000 disables
        max_trade_shares: u64, // 1..MAX_TRADE_SHARES_HARD
        cooldown_seconds: i64, // 0..120
    ) -> Result<()> {
        // outcomes
        require!(
            outcome_names.len() >= 2 && outcome_names.len() <= MAX_OUTCOMES,
            ErrorCode::InvalidOutcomes
        );
        require!(market_type == 0 || market_type == 1, ErrorCode::InvalidOutcomes);
        if market_type == 0 {
            require!(outcome_names.len() == 2, ErrorCode::InvalidOutcomes);
        }

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

        // anti-manip config
        require!(
            (max_position_bps >= 500 && max_position_bps <= 9000) || max_position_bps == 10_000,
            ErrorCode::InvalidAntiManip
        );
        require!(
            max_trade_shares >= 1 && max_trade_shares <= MAX_TRADE_SHARES_HARD,
            ErrorCode::InvalidAntiManip
        );
        require!(
            cooldown_seconds >= 0 && cooldown_seconds <= 120,
            ErrorCode::InvalidAntiManip
        );

        let market = &mut ctx.accounts.market;

        market.creator = ctx.accounts.creator.key();
        market.resolution_time = resolution_time;

        market.market_type = market_type;
        market.outcome_count = outcome_names.len() as u8;
        market.outcome_names = outcome_names;

        market.b_lamports = b_lamports;
        market.q = [0u64; MAX_OUTCOMES];

        // lifecycle
        market.status = MarketStatus::Open;
        market.resolved = false;
        market.winning_outcome = None;

        // propose/dispute flow
        market.proposed_outcome = None;
        market.proposed_at = None;
        market.contest_deadline = None;
        market.dispute_count = 0;
        market.cancelled = false;

        // anti-manip
        market.max_position_bps = max_position_bps;
        market.max_trade_shares = max_trade_shares;
        market.cooldown_seconds = cooldown_seconds;

        emit!(MarketCreated {
            market: market.key(),
            creator: market.creator,
            resolution_time,
            market_type,
            outcome_count: market.outcome_count,
            b_lamports,
        });

        Ok(())
    }

    /* ---------- TRADE ---------- */

    pub fn buy_shares(ctx: Context<Trade>, shares: u64, outcome_index: u8) -> Result<()> {
        trade_inner(ctx, shares, outcome_index, true)
    }

    pub fn sell_shares(ctx: Context<Trade>, shares: u64, outcome_index: u8) -> Result<()> {
        trade_inner(ctx, shares, outcome_index, false)
    }

/* ---------- PROPOSE (creator) ---------- */

pub fn propose_resolution(
    ctx: Context<ProposeResolution>,
    proposed_outcome: u8,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let now = Clock::get()?.unix_timestamp;

    require!(market.status == MarketStatus::Open, ErrorCode::InvalidState);
    require!(!market.cancelled, ErrorCode::InvalidState);
    require!(!market.resolved, ErrorCode::MarketResolved);

    require!(now >= market.resolution_time, ErrorCode::MarketNotEnded);

    // 48h window to propose after end
    let cutoff = market
        .resolution_time
        .checked_add(CREATOR_PROPOSE_WINDOW)
        .ok_or(ErrorCode::Overflow)?;
    require!(now <= cutoff, ErrorCode::TooLateToPropose);

    let idx = proposed_outcome as usize;
    require!(idx < market.outcome_count as usize, ErrorCode::InvalidOutcomeIndex);

    market.status = MarketStatus::Proposed;
    market.proposed_outcome = Some(proposed_outcome);
    market.proposed_at = Some(now);
    market.contest_deadline = Some(now.checked_add(DISPUTE_WINDOW).ok_or(ErrorCode::Overflow)?);
    market.dispute_count = 0;

    emit!(ResolutionProposed {
        market: market.key(),
        proposed_outcome,
        proposed_at: now,
        contest_deadline: market.contest_deadline.unwrap(),
    });

    Ok(())
}

/* ---------- DISPUTE (any user during contest window) ---------- */

pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let now = Clock::get()?.unix_timestamp;

    // Must be proposed
    require!(market.status == MarketStatus::Proposed, ErrorCode::InvalidState);
    require!(!market.cancelled, ErrorCode::InvalidState);
    require!(!market.resolved, ErrorCode::MarketResolved);

    // Must be within contest window
    let deadline = market.contest_deadline.ok_or(ErrorCode::InvalidState)?;
    require!(now < deadline, ErrorCode::DisputeWindowClosed);

    // Increment counter
    market.dispute_count = market.dispute_count.saturating_add(1);

    emit!(Disputed {
        market: market.key(),
        by: ctx.accounts.user.key(),
        dispute_count: market.dispute_count,
    });

    Ok(())
}

    /* ---------- FINALIZE (permissionless if 0 disputes) ---------- */

    pub fn finalize_if_no_disputes(ctx: Context<FinalizeNoDisputes>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let now = Clock::get()?.unix_timestamp;

        require!(market.status == MarketStatus::Proposed, ErrorCode::InvalidState);
        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(!market.cancelled, ErrorCode::InvalidState);

        let deadline = market.contest_deadline.ok_or(ErrorCode::InvalidState)?;
        require!(now >= deadline, ErrorCode::TooEarly);

        require!(market.dispute_count == 0, ErrorCode::HasDisputes);

        let out = market.proposed_outcome.ok_or(ErrorCode::InvalidState)?;

        market.status = MarketStatus::Finalized;
        market.resolved = true;
        market.winning_outcome = Some(out);

        emit!(Finalized {
            market: market.key(),
            winning_outcome: out,
            by: ctx.accounts.user.key(),
        });

        Ok(())
    }

    /* ---------- ADMIN FINALIZE / CANCEL (ONLY if disputes > 0) ---------- */

    pub fn admin_finalize(ctx: Context<AdminResolve>, winning_outcome: u8) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let now = Clock::get()?.unix_timestamp;

        require_keys_eq!(ctx.accounts.admin.key(), ADMIN_AUTHORITY, ErrorCode::Unauthorized);

        require!(market.status == MarketStatus::Proposed, ErrorCode::InvalidState);
        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(!market.cancelled, ErrorCode::InvalidState);

        let deadline = market.contest_deadline.ok_or(ErrorCode::InvalidState)?;
        require!(now >= deadline, ErrorCode::TooEarly);

        require!(market.dispute_count > 0, ErrorCode::NoDispute);

        let idx = winning_outcome as usize;
        require!(idx < market.outcome_count as usize, ErrorCode::InvalidOutcomeIndex);

        market.status = MarketStatus::Finalized;
        market.resolved = true;
        market.winning_outcome = Some(winning_outcome);

        emit!(Finalized {
            market: market.key(),
            winning_outcome,
            by: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    pub fn admin_cancel(ctx: Context<AdminResolve>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let now = Clock::get()?.unix_timestamp;

        require_keys_eq!(ctx.accounts.admin.key(), ADMIN_AUTHORITY, ErrorCode::Unauthorized);

        require!(market.status == MarketStatus::Proposed, ErrorCode::InvalidState);
        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(!market.cancelled, ErrorCode::InvalidState);

        let deadline = market.contest_deadline.ok_or(ErrorCode::InvalidState)?;
        require!(now >= deadline, ErrorCode::TooEarly);

        require!(market.dispute_count > 0, ErrorCode::NoDispute);

        market.status = MarketStatus::Cancelled;
        market.cancelled = true;

        emit!(Cancelled {
            market: market.key(),
            by: ctx.accounts.admin.key(),
            reason: CancelReason::Admin,
        });

        Ok(())
    }

    /* ---------- AUTO CANCEL (48h after end, permissionless) ---------- */

    pub fn cancel_if_no_proposal(ctx: Context<CancelNoProposal>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let now = Clock::get()?.unix_timestamp;

        require!(market.status == MarketStatus::Open, ErrorCode::InvalidState);
        require!(!market.resolved, ErrorCode::MarketResolved);
        require!(!market.cancelled, ErrorCode::InvalidState);

        require!(now >= market.resolution_time, ErrorCode::MarketNotEnded);

        let cutoff = market
            .resolution_time
            .checked_add(CREATOR_PROPOSE_WINDOW)
            .ok_or(ErrorCode::Overflow)?;
        require!(now >= cutoff, ErrorCode::TooEarly);

        market.status = MarketStatus::Cancelled;
        market.cancelled = true;

        emit!(Cancelled {
            market: market.key(),
            by: ctx.accounts.user.key(),
            reason: CancelReason::NoProposal48h,
        });

        Ok(())
    }

    /* ---------- CLAIM WINNINGS (existing behavior) ---------- */

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market_ai = ctx.accounts.market.to_account_info();
        let user_ai = ctx.accounts.user.to_account_info();

        let market = &mut ctx.accounts.market;
        let pos = &mut ctx.accounts.user_position;

        require!(market.resolved, ErrorCode::MarketNotResolved);
        require!(market.status == MarketStatus::Finalized, ErrorCode::InvalidState);
        require!(!market.cancelled, ErrorCode::InvalidState);

        require!(!pos.claimed, ErrorCode::AlreadyClaimed);

        // verify ownership
        require!(pos.market == market.key(), ErrorCode::InvalidUserPosition);
        require!(pos.user == ctx.accounts.user.key(), ErrorCode::InvalidUserPosition);

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

        emit!(Claimed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            kind: ClaimKind::Winnings,
            amount_lamports: payout,
        });

        Ok(())
    }

    /* ---------- CLAIM REFUND (cancelled) ---------- */
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let market_ai = ctx.accounts.market.to_account_info();
        let user_ai = ctx.accounts.user.to_account_info();

        let market = &mut ctx.accounts.market;
        let pos = &mut ctx.accounts.user_position;

        require!(market.cancelled, ErrorCode::NotCancelled);
        require!(market.status == MarketStatus::Cancelled, ErrorCode::InvalidState);
        require!(!market.resolved, ErrorCode::InvalidState);

        require!(!pos.claimed, ErrorCode::AlreadyClaimed);

        // verify ownership
        require!(pos.market == market.key(), ErrorCode::InvalidUserPosition);
        require!(pos.user == ctx.accounts.user.key(), ErrorCode::InvalidUserPosition);

        // refund is the user "net cost" (excluding fees), clamped to >= 0
        let nc = pos.net_cost_lamports;
        require!(nc > 0, ErrorCode::NothingToRefund);

        let refund_u64: u64 = u64::try_from(nc).map_err(|_| error!(ErrorCode::Overflow))?;

        require!(market_ai.lamports() >= refund_u64, ErrorCode::InsufficientMarketBalance);

        **market_ai.try_borrow_mut_lamports()? = market_ai.lamports().saturating_sub(refund_u64);
        **user_ai.try_borrow_mut_lamports()? = user_ai.lamports().saturating_add(refund_u64);

        pos.claimed = true;

        emit!(Claimed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            kind: ClaimKind::Refund,
            amount_lamports: refund_u64,
        });

        Ok(())
    }
}

/* ============================== TRADE INNER ============================== */

fn trade_inner(ctx: Context<Trade>, shares: u64, outcome_index: u8, is_buy: bool) -> Result<()> {
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

    // state gate
    require!(market.status == MarketStatus::Open, ErrorCode::MarketClosed);
    require!(!market.resolved, ErrorCode::MarketResolved);
    require!(!market.cancelled, ErrorCode::InvalidState);

    let now = Clock::get()?.unix_timestamp;
    require!(now < market.resolution_time, ErrorCode::MarketClosed);

    require!(shares > 0, ErrorCode::InvalidShares);
    require!(shares <= market.max_trade_shares, ErrorCode::TradeTooLarge);

    // init_if_needed invariants
    if pos.market == Pubkey::default() {
        pos.market = market_key;
        pos.user = trader_key;
        pos.shares = [0u64; MAX_OUTCOMES];
        pos.claimed = false;
        pos.last_trade_ts = 0;
        pos.net_cost_lamports = 0;
    } else {
        require!(pos.market == market_key, ErrorCode::InvalidUserPosition);
        require!(pos.user == trader_key, ErrorCode::InvalidUserPosition);
    }

    // cooldown
    if market.cooldown_seconds > 0 && pos.last_trade_ts > 0 {
        require!(
            now - pos.last_trade_ts >= market.cooldown_seconds,
            ErrorCode::CooldownActive
        );
    }

    let idx = outcome_index as usize;
    require!(idx < market.outcome_count as usize, ErrorCode::InvalidOutcomeIndex);

    if is_buy {
        // LMSR cost excluding fees
        let cost = lmsr_buy_cost_lamports(&market.q, idx, shares, market.b_lamports, market.outcome_count)?;
        require!(cost > 0, ErrorCode::InvalidCost);

        let platform_fee = cost.saturating_mul(PLATFORM_FEE_BPS) / 10_000;
        let creator_fee = cost.saturating_mul(CREATOR_FEE_BPS) / 10_000;

        let total_pay = cost
            .checked_add(platform_fee).ok_or(ErrorCode::Overflow)?
            .checked_add(creator_fee).ok_or(ErrorCode::Overflow)?;

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

        // track refundable principal (EXCLUDING fees)
        pos.net_cost_lamports = pos
            .net_cost_lamports
            .checked_add(cost as i128)
            .ok_or(ErrorCode::Overflow)?;

        enforce_position_cap(market, pos, idx)?;

        emit!(TradeExecuted {
            market: market.key(),
            user: trader_key,
            is_buy: true,
            outcome_index,
            shares,
            amount_lamports: cost,
            platform_fee_lamports: platform_fee,
            creator_fee_lamports: creator_fee,
        });

        Ok(())
    } else {
        require!(pos.shares[idx] >= shares, ErrorCode::NotEnoughShares);

        // LMSR refund excluding fees
        let refund = lmsr_sell_refund_lamports(&market.q, idx, shares, market.b_lamports, market.outcome_count)?;
        require!(refund > 0, ErrorCode::InvalidCost);

        let platform_fee = refund.saturating_mul(PLATFORM_FEE_BPS) / 10_000;
        let creator_fee = refund.saturating_mul(CREATOR_FEE_BPS) / 10_000;

        let net_receive = refund
            .checked_sub(platform_fee).ok_or(ErrorCode::Overflow)?
            .checked_sub(creator_fee).ok_or(ErrorCode::Overflow)?;

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

        // track refundable principal (EXCLUDING fees)
        pos.net_cost_lamports = pos
            .net_cost_lamports
            .checked_sub(refund as i128)
            .ok_or(ErrorCode::Overflow)?;

        // don't allow negative refundable principal
        if pos.net_cost_lamports < 0 {
            pos.net_cost_lamports = 0;
        }

        emit!(TradeExecuted {
            market: market.key(),
            user: trader_key,
            is_buy: false,
            outcome_index,
            shares,
            amount_lamports: refund,
            platform_fee_lamports: platform_fee,
            creator_fee_lamports: creator_fee,
        });

        Ok(())
    }
}

/* ============================== ANTI-MANIP ============================== */
/**
Cap per wallet on an outcome, computed from TOTAL market supply (sum(q)).
We skip enforcement until market has some depth (bootstrap).
*/
fn enforce_position_cap(market: &Market, pos: &UserPosition, idx: usize) -> Result<()> {
    let max_bps = market.max_position_bps as u64;

    // disabled
    if max_bps >= 10_000 {
        return Ok(());
    }

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

/* ============================== LMSR WRAPPERS ============================== */

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

/* ============================== ACCOUNTS ============================== */

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = Market::SPACE
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
    #[account(mut, address = PLATFORM_WALLET)]
    pub platform_wallet: UncheckedAccount<'info>,

    /// CHECK: creator wallet (fee receiver)
    #[account(mut, address = market.creator)]
    pub creator: UncheckedAccount<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeResolution<'info> {
    #[account(mut, has_one = creator)]
    pub market: Account<'info, Market>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeNoDisputes<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminResolve<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(mut, address = ADMIN_AUTHORITY)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelNoProposal<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    pub user: Signer<'info>,
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

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
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

/* ============================== STATE ============================== */

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Proposed,
    Finalized,
    Cancelled,
}

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub resolution_time: i64,

    pub market_type: u8,   // 0=binary, 1=multi
    pub outcome_count: u8, // 2..10

    // LMSR
    pub b_lamports: u64,
    pub q: [u64; MAX_OUTCOMES],

    // lifecycle
    pub status: MarketStatus,
    pub resolved: bool,
    pub cancelled: bool,
    pub winning_outcome: Option<u8>,

    // propose/dispute
    pub proposed_outcome: Option<u8>,
    pub proposed_at: Option<i64>,
    pub contest_deadline: Option<i64>,
    pub dispute_count: u32,

    // anti-manip config
    pub max_position_bps: u16,
    pub max_trade_shares: u64,
    pub cooldown_seconds: i64,

    // metadata
    pub outcome_names: Vec<String>,
}

impl Market {
    pub const SPACE: usize =
        8 +                    // discriminator
        32 +                   // creator
        8 +                    // resolution_time
        1 +                    // market_type
        1 +                    // outcome_count
        8 +                    // b_lamports
        (8 * MAX_OUTCOMES) +   // q
        1 +                    // status enum
        1 +                    // resolved
        1 +                    // cancelled
        (1 + 1) +              // winning_outcome Option<u8>
        (1 + 1) +              // proposed_outcome Option<u8>
        (1 + 8) +              // proposed_at Option<i64>
        (1 + 8) +              // contest_deadline Option<i64>
        4 +                    // dispute_count u32
        2 +                    // max_position_bps
        8 +                    // max_trade_shares
        8 +                    // cooldown_seconds
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

    // ✅ refundable principal (cost/refund excluding fees)
    pub net_cost_lamports: i128,
}

impl UserPosition {
    pub const SPACE: usize =
        8 +                    // discriminator
        32 +                   // market
        32 +                   // user
        (8 * MAX_OUTCOMES) +   // shares
        1 +                    // claimed
        8 +                    // last_trade_ts
        16;                    // i128
}

/* ============================== EVENTS ============================== */

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub resolution_time: i64,
    pub market_type: u8,
    pub outcome_count: u8,
    pub b_lamports: u64,
}

#[event]
pub struct TradeExecuted {
    pub market: Pubkey,
    pub user: Pubkey,
    pub is_buy: bool,
    pub outcome_index: u8,
    pub shares: u64,
    pub amount_lamports: u64,        // cost (buy) or refund (sell) excluding fees
    pub platform_fee_lamports: u64,
    pub creator_fee_lamports: u64,
}

#[event]
pub struct ResolutionProposed {
    pub market: Pubkey,
    pub proposed_outcome: u8,
    pub proposed_at: i64,
    pub contest_deadline: i64,
}

#[event]
pub struct Disputed {
    pub market: Pubkey,
    pub by: Pubkey,
    pub dispute_count: u32,
}

#[event]
pub struct Finalized {
    pub market: Pubkey,
    pub winning_outcome: u8,
    pub by: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    NoProposal48h,
    Admin,
}

#[event]
pub struct Cancelled {
    pub market: Pubkey,
    pub by: Pubkey,
    pub reason: CancelReason,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ClaimKind {
    Winnings,
    Refund,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub kind: ClaimKind,
    pub amount_lamports: u64,
}

/* ============================== ERRORS ============================== */

#[error_code]
pub enum ErrorCode {
    // ----- Market creation / config -----
    #[msg("Invalid outcomes")]
    InvalidOutcomes,
    #[msg("Invalid resolution time")]
    InvalidResolutionTime,
    #[msg("Invalid liquidity parameter b")]
    InvalidB,
    #[msg("Invalid anti-manip config")]
    InvalidAntiManip,

    // ----- Market lifecycle -----
    #[msg("Market is closed (past end time)")]
    MarketClosed,
    #[msg("Market already resolved")]
    MarketResolved,
    #[msg("Market not ended yet")]
    MarketNotEnded,
    #[msg("Market not resolved")]
    MarketNotResolved,
    #[msg("Invalid state")]
    InvalidState,
    #[msg("Too early")]
    TooEarly,
    #[msg("Too late to propose")]
    TooLateToPropose,

    // ----- Trading -----
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
    #[msg("Not enough shares to sell")]
    NotEnoughShares,
    #[msg("Invalid cost or refund")]
    InvalidCost,

    // ----- Claiming -----
    #[msg("Invalid payout")]
    InvalidPayout,
    #[msg("No winning shares to claim")]
    NoWinningShares,
    #[msg("Invalid supply")]
    InvalidSupply,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Nothing to refund")]
    NothingToRefund,

    // ----- Disputes / admin -----
    #[msg("Dispute window closed")]
    DisputeWindowClosed,
    #[msg("Has disputes; requires admin")]
    HasDisputes,
    #[msg("No dispute")]
    NoDispute,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Market not cancelled")]
    NotCancelled,

    // ----- Accounts / balances -----
    #[msg("Insufficient market balance")]
    InsufficientMarketBalance,
    #[msg("Invalid user position account")]
    InvalidUserPosition,

    // ----- Math.rs specific -----
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid liquidity parameter")]
    InvalidLiquidityParameter,
    #[msg("Invalid outcome count")]
    InvalidOutcomeCount,
    #[msg("Insufficient shares")]
    InsufficientShares,

    // ----- Generic -----
    #[msg("Overflow")]
    Overflow,
}