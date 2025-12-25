// programs/funmarket-pump/src/math.rs
//
// Robust LMSR fixed-point math (1e9 scale)
// - log-sum-exp to avoid overflow
// - supports negative exponent inputs via reciprocal
// - rounds COST up (ceil) so buy cost doesn't truncate to 0 lamport

use anchor_lang::prelude::*;
use crate::ErrorCode as MainErrorCode;

/// Scale factor for fixed-point arithmetic (1e9)
pub const SCALE: u128 = 1_000_000_000;

/// ln(2) scaled by 1e9
const LN2_SCALED: u128 = 693_147_180;

/// Max |x| for exp input (scaled). With log-sum-exp, this is mostly to bound series + shifts.
const MAX_EXP_INPUT: u128 = 60 * SCALE;

/// Max iterations for series
const MAX_ITERATIONS: usize = 28;

/// Convergence threshold (scaled)
const TERM_EPS: u128 = 1_000; // ~1e-6 in SCALE

#[inline]
fn div_ceil_u128(n: u128, d: u128) -> Result<u128> {
    require!(d > 0, MainErrorCode::MathOverflow);
    Ok(n
        .checked_add(d.checked_sub(1).ok_or(MainErrorCode::MathOverflow)?)
        .ok_or(MainErrorCode::MathOverflow)?
        .checked_div(d)
        .ok_or(MainErrorCode::MathOverflow)?)
}

/// Fixed-point natural logarithm approximation
/// Input/output scaled by SCALE (1e9)
///
/// Supports x >= SCALE only (ln(x) >= 0) to keep it simple.
/// In our usage, exp sums are always >= SCALE.
pub fn ln_fixed(x: u128) -> Result<u128> {
    require!(x >= SCALE, MainErrorCode::MathOverflow);

    // Normalize to v in [1,2) tracking k such that x = v * 2^k
    let mut v = x;
    let mut k: u32 = 0;

    while v >= 2 * SCALE {
        v = v.checked_div(2).ok_or(MainErrorCode::MathOverflow)?;
        k = k.checked_add(1).ok_or(MainErrorCode::MathOverflow)?;
    }

    // z = (v-1)/(v+1)
    let num = v.checked_sub(SCALE).ok_or(MainErrorCode::MathOverflow)?;
    let den = v.checked_add(SCALE).ok_or(MainErrorCode::MathOverflow)?;
    require!(den > 0, MainErrorCode::MathOverflow);

    let z = num
        .checked_mul(SCALE).ok_or(MainErrorCode::MathOverflow)?
        .checked_div(den).ok_or(MainErrorCode::MathOverflow)?;

    // atanh series:
    // ln(v) = 2 * ( z + z^3/3 + z^5/5 + ... )
    let z2 = z
        .checked_mul(z).ok_or(MainErrorCode::MathOverflow)?
        .checked_div(SCALE).ok_or(MainErrorCode::MathOverflow)?;

    let mut term = z;     // z^(2n+1)
    let mut sum = term;   // z

    for n in 1..=MAX_ITERATIONS {
        term = term
            .checked_mul(z2).ok_or(MainErrorCode::MathOverflow)?
            .checked_div(SCALE).ok_or(MainErrorCode::MathOverflow)?;

        let denom = (2u128)
            .checked_mul(n as u128)
            .and_then(|v| v.checked_add(1))
            .ok_or(MainErrorCode::MathOverflow)?; // 2n+1

        let add = term.checked_div(denom).ok_or(MainErrorCode::MathOverflow)?;
        if add < TERM_EPS {
            break;
        }
        sum = sum.checked_add(add).ok_or(MainErrorCode::MathOverflow)?;
    }

    let ln_v = sum.checked_mul(2).ok_or(MainErrorCode::MathOverflow)?;
    let k_ln2 = (k as u128).checked_mul(LN2_SCALED).ok_or(MainErrorCode::MathOverflow)?;

    ln_v.checked_add(k_ln2).ok_or(MainErrorCode::MathOverflow.into())
}

/// exp(x) for x >= 0, scaled in/out by SCALE.
/// Range reduction: x = k*ln2 + r, exp(x)=2^k * exp(r)
pub fn exp_fixed_pos(x: u128) -> Result<u128> {
    require!(x <= MAX_EXP_INPUT, MainErrorCode::MathOverflow);

    if x == 0 {
        return Ok(SCALE);
    }

    let k = x.checked_div(LN2_SCALED).ok_or(MainErrorCode::MathOverflow)?;
    let r = x
        .checked_sub(k.checked_mul(LN2_SCALED).ok_or(MainErrorCode::MathOverflow)?)
        .ok_or(MainErrorCode::MathOverflow)?;

    // exp(r) via Taylor series
    let mut sum = SCALE;
    let mut term = SCALE;

    for n in 1..=MAX_ITERATIONS {
        term = term
            .checked_mul(r).ok_or(MainErrorCode::MathOverflow)?
            .checked_div(SCALE).ok_or(MainErrorCode::MathOverflow)?
            .checked_div(n as u128).ok_or(MainErrorCode::MathOverflow)?;

        if term < TERM_EPS {
            break;
        }
        sum = sum.checked_add(term).ok_or(MainErrorCode::MathOverflow)?;
    }

    let k_u32: u32 = u32::try_from(k).map_err(|_| MainErrorCode::MathOverflow)?;
    sum.checked_shl(k_u32).ok_or(MainErrorCode::MathOverflow.into())
}

/// exp(x) for signed x (scaled), returning scaled result.
/// If x < 0: exp(-y) = 1/exp(y) => scaled = (SCALE*SCALE)/exp_fixed_pos(y)
pub fn exp_fixed_signed(x: i128) -> Result<u128> {
    if x >= 0 {
        return exp_fixed_pos(u128::try_from(x).map_err(|_| MainErrorCode::MathOverflow)?);
    }
    let y: u128 = u128::try_from(-x).map_err(|_| MainErrorCode::MathOverflow)?;
    require!(y <= MAX_EXP_INPUT, MainErrorCode::MathOverflow);

    let denom = exp_fixed_pos(y)?; // exp(y)*SCALE
    require!(denom > 0, MainErrorCode::MathOverflow);

    // (SCALE / exp(y)) * SCALE  == (SCALE*SCALE)/denom
    let num = SCALE.checked_mul(SCALE).ok_or(MainErrorCode::MathOverflow)?;
    Ok(num.checked_div(denom).ok_or(MainErrorCode::MathOverflow)?)
}

/// C(q) = b * ln(sum_i exp(q_i / b))
/// q in shares units (u64), b in lamports units (u64) => cost in lamports (u64)
///
/// Uses log-sum-exp for stability:
/// ln(sum exp(r_i)) = m + ln(sum exp(r_i - m))
pub fn lmsr_cost(q: &[u64; 10], b: u64, outcome_count: u8) -> Result<u64> {
    require!(b > 0, MainErrorCode::InvalidLiquidityParameter);
    require!((2..=10).contains(&outcome_count), MainErrorCode::InvalidOutcomeCount);

    let b_u128 = b as u128;

    // r_i = (q_i / b) scaled => q_i * SCALE / b
    let mut r: [u128; 10] = [0u128; 10];
    let mut max_r: u128 = 0;

    for i in 0..(outcome_count as usize) {
        let q_i = q[i] as u128;
        let ri = q_i
            .checked_mul(SCALE).ok_or(MainErrorCode::MathOverflow)?
            .checked_div(b_u128).ok_or(MainErrorCode::MathOverflow)?;
        r[i] = ri;
        if ri > max_r {
            max_r = ri;
        }
    }

    // sum exp(r_i - max_r)
    let mut exp_sum: u128 = 0;
    for i in 0..(outcome_count as usize) {
        let diff = (r[i] as i128)
            .checked_sub(max_r as i128)
            .ok_or(MainErrorCode::MathOverflow)?;
        // diff <= 0, safe
        let exp_val = exp_fixed_signed(diff)?;
        exp_sum = exp_sum.checked_add(exp_val).ok_or(MainErrorCode::MathOverflow)?;
    }

    // exp_sum is scaled, and >= SCALE (because at least one diff==0 => exp(0)=SCALE)
    require!(exp_sum >= SCALE, MainErrorCode::MathOverflow);

    let ln_small = ln_fixed(exp_sum)?;          // ln(sum exp(diff)) scaled
    let ln_total = max_r.checked_add(ln_small).ok_or(MainErrorCode::MathOverflow)?; // scaled

    // cost = b * ln_total / SCALE
    // IMPORTANT: ceil so we don't truncate tiny positive costs to 0 lamport
    let cost_u128 = b_u128.checked_mul(ln_total).ok_or(MainErrorCode::MathOverflow)?;
    let cost_u128 = div_ceil_u128(cost_u128, SCALE)?;

    Ok(u64::try_from(cost_u128).map_err(|_| MainErrorCode::MathOverflow)?)
}

/// Cost of buying Δ shares on outcome i: C(q+Δ) - C(q)
pub fn lmsr_buy_cost(
    q: &[u64; 10],
    b: u64,
    outcome_index: u8,
    amount: u64,
    outcome_count: u8,
) -> Result<u64> {
    require!((outcome_index as usize) < (outcome_count as usize), MainErrorCode::InvalidOutcomeCount);
    require!(amount > 0, MainErrorCode::InvalidShares);

    let cost_before = lmsr_cost(q, b, outcome_count)?;

    let mut q_after = *q;
    q_after[outcome_index as usize] = q_after[outcome_index as usize]
        .checked_add(amount)
        .ok_or(MainErrorCode::MathOverflow)?;

    let cost_after = lmsr_cost(&q_after, b, outcome_count)?;

    let delta = cost_after.checked_sub(cost_before).ok_or(MainErrorCode::MathOverflow)?;
    // With ceil, delta should almost never be 0, but keep it safe.
    Ok(delta.max(1))
}

/// Refund from selling Δ shares on outcome i: C(q) - C(q-Δ)
pub fn lmsr_sell_refund(
    q: &[u64; 10],
    b: u64,
    outcome_index: u8,
    amount: u64,
    outcome_count: u8,
) -> Result<u64> {
    require!((outcome_index as usize) < (outcome_count as usize), MainErrorCode::InvalidOutcomeCount);
    require!(amount > 0, MainErrorCode::InvalidShares);
    require!(q[outcome_index as usize] >= amount, MainErrorCode::InsufficientShares);

    let cost_before = lmsr_cost(q, b, outcome_count)?;

    let mut q_after = *q;
    q_after[outcome_index as usize] = q_after[outcome_index as usize]
        .checked_sub(amount)
        .ok_or(MainErrorCode::InsufficientShares)?;

    let cost_after = lmsr_cost(&q_after, b, outcome_count)?;

    Ok(cost_before.checked_sub(cost_after).ok_or(MainErrorCode::MathOverflow)?)
}

/// Price p_i = exp(q_i/b) / sum_j exp(q_j/b), scaled by SCALE (1e9)
pub fn lmsr_price(
    q: &[u64; 10],
    b: u64,
    outcome_index: u8,
    outcome_count: u8,
) -> Result<u64> {
    require!(b > 0, MainErrorCode::InvalidLiquidityParameter);
    require!((2..=10).contains(&outcome_count), MainErrorCode::InvalidOutcomeCount);
    require!((outcome_index as usize) < (outcome_count as usize), MainErrorCode::InvalidOutcomeCount);

    let b_u128 = b as u128;

    // compute r_i and max
    let mut r: [u128; 10] = [0u128; 10];
    let mut max_r: u128 = 0;
    for i in 0..(outcome_count as usize) {
        let ri = (q[i] as u128)
            .checked_mul(SCALE).ok_or(MainErrorCode::MathOverflow)?
            .checked_div(b_u128).ok_or(MainErrorCode::MathOverflow)?;
        r[i] = ri;
        if ri > max_r {
            max_r = ri;
        }
    }

    // denom = sum exp(r_i-max_r), numer = exp(r_k-max_r)
    let mut denom: u128 = 0;
    let mut numer: u128 = 0;

    for i in 0..(outcome_count as usize) {
        let diff = (r[i] as i128)
            .checked_sub(max_r as i128)
            .ok_or(MainErrorCode::MathOverflow)?;
        let e = exp_fixed_signed(diff)?;
        denom = denom.checked_add(e).ok_or(MainErrorCode::MathOverflow)?;
        if i == outcome_index as usize {
            numer = e;
        }
    }

    require!(denom > 0, MainErrorCode::MathOverflow);

    let price = numer
        .checked_mul(SCALE).ok_or(MainErrorCode::MathOverflow)?
        .checked_div(denom).ok_or(MainErrorCode::MathOverflow)?;

    Ok(u64::try_from(price).map_err(|_| MainErrorCode::MathOverflow)?)
}