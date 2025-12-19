// LMSR (Logarithmic Market Scoring Rule) fixed-point math implementation
// Uses 1e9 scale (1_000_000_000) for fixed-point arithmetic
// All calculations are checked to prevent overflow

use anchor_lang::prelude::*;
use crate::ErrorCode as MainErrorCode;

/// Scale factor for fixed-point arithmetic (1e9)
pub const SCALE: u128 = 1_000_000_000;

/// Maximum value for exp input to prevent overflow (ln(2^64) ≈ 44)
const MAX_EXP_INPUT: u128 = 40 * SCALE;

/// Maximum iterations for Taylor series
const MAX_ITERATIONS: usize = 20;

/// Fixed-point natural logarithm approximation
/// Input and output are scaled by SCALE (1e9)
/// Uses Taylor series: ln(1+x) = x - x²/2 + x³/3 - x⁴/4 + ...
pub fn ln_fixed(x: u128) -> Result<u128> {
    require!(x > 0, MainErrorCode::MathOverflow);

    // For x close to SCALE, use Taylor series around ln(1+x)
    // For other values, use ln(x) = ln(x/SCALE) + ln(SCALE)

    if x == SCALE {
        return Ok(0); // ln(1) = 0
    }

    // For simplicity, we'll use an approximation valid for x near SCALE
    // ln(x) ≈ (x - SCALE) / SCALE for x close to SCALE
    // More accurate: use iterative refinement

    // Use change of base and scaling
    let mut result: i128 = 0;
    let mut value = x;

    // Scale to range [1, e) by dividing/multiplying by e ≈ 2.71828
    // Count how many times we multiply/divide by e
    const E_SCALED: u128 = 2_718_281_828; // e * SCALE

    while value >= E_SCALED {
        value = value.checked_mul(SCALE).unwrap().checked_div(E_SCALED).unwrap();
        result += SCALE as i128;
    }

    while value < SCALE {
        value = value.checked_mul(E_SCALED).unwrap().checked_div(SCALE).unwrap();
        result -= SCALE as i128;
    }

    // Now value is in [1, e), use Taylor series for ln(value)
    // ln(1+x) = x - x²/2 + x³/3 - ...
    let delta = (value as i128) - (SCALE as i128);
    let mut series_sum: i128 = 0;
    let mut term = delta;

    for n in 1..=MAX_ITERATIONS {
        series_sum += term / (n as i128);
        term = term * delta / (SCALE as i128);
        term = -term; // Alternating series

        if term.abs() < 1000 { // Convergence threshold
            break;
        }
    }

    result += series_sum;

    // Return absolute value (we'll handle negatives at call site if needed)
    Ok(result.abs() as u128)
}

/// Fixed-point exponential approximation
/// Input and output are scaled by SCALE (1e9)
/// Uses Taylor series: e^x = 1 + x + x²/2! + x³/3! + ...
pub fn exp_fixed(x: u128) -> Result<u128> {
    // Prevent overflow
    require!(x <= MAX_EXP_INPUT, MainErrorCode::MathOverflow);

    if x == 0 {
        return Ok(SCALE); // e^0 = 1
    }

    // Taylor series: e^x = 1 + x + x²/2! + x³/3! + ...
    let mut sum = SCALE; // Start with 1.0
    let mut term = SCALE; // Current term

    for n in 1..=MAX_ITERATIONS {
        // term = term * x / n
        term = term.checked_mul(x)
            .ok_or(MainErrorCode::MathOverflow)?
            .checked_div(SCALE)
            .ok_or(MainErrorCode::MathOverflow)?
            .checked_div(n as u128)
            .ok_or(MainErrorCode::MathOverflow)?;

        sum = sum.checked_add(term)
            .ok_or(MainErrorCode::MathOverflow)?;

        // Check convergence
        if term < 1000 {
            break;
        }
    }

    Ok(sum)
}

/// Calculate LMSR cost function: C(q) = b * ln(sum_i exp(q_i / b))
/// All inputs are in lamports (not scaled), b is liquidity parameter
/// Returns cost in lamports
pub fn lmsr_cost(q: &[u64; 10], b: u64, outcome_count: u8) -> Result<u64> {
    require!(b > 0, MainErrorCode::InvalidLiquidityParameter);
    require!(outcome_count >= 2 && outcome_count <= 10, MainErrorCode::InvalidOutcomeCount);

    let b_scaled = (b as u128).checked_mul(SCALE).ok_or(MainErrorCode::MathOverflow)?;

    // Calculate sum of exp(q_i / b)
    let mut exp_sum: u128 = 0;

    for i in 0..(outcome_count as usize) {
        let q_i = q[i] as u128;

        // Calculate q_i / b (scaled)
        let ratio = q_i.checked_mul(SCALE)
            .ok_or(MainErrorCode::MathOverflow)?
            .checked_mul(SCALE)
            .ok_or(MainErrorCode::MathOverflow)?
            .checked_div(b_scaled)
            .ok_or(MainErrorCode::MathOverflow)?;

        // Calculate exp(q_i / b)
        let exp_val = exp_fixed(ratio)?;

        exp_sum = exp_sum.checked_add(exp_val)
            .ok_or(MainErrorCode::MathOverflow)?;
    }

    // Calculate ln(sum)
    let ln_sum = ln_fixed(exp_sum)?;

    // Calculate b * ln(sum)
    let cost = (b as u128).checked_mul(ln_sum)
        .ok_or(MainErrorCode::MathOverflow)?
        .checked_div(SCALE)
        .ok_or(MainErrorCode::MathOverflow)?;

    Ok(cost as u64)
}

/// Calculate cost of buying shares: C(q + Δ) - C(q)
/// Returns cost in lamports
pub fn lmsr_buy_cost(
    q: &[u64; 10],
    b: u64,
    outcome_index: u8,
    amount: u64,
    outcome_count: u8,
) -> Result<u64> {
    // Calculate C(q)
    let cost_before = lmsr_cost(q, b, outcome_count)?;

    // Calculate C(q + Δ)
    let mut q_after = *q;
    q_after[outcome_index as usize] = q_after[outcome_index as usize]
        .checked_add(amount)
        .ok_or(MainErrorCode::MathOverflow)?;

    let cost_after = lmsr_cost(&q_after, b, outcome_count)?;

    // Return difference
    cost_after.checked_sub(cost_before)
        .ok_or(MainErrorCode::MathOverflow.into())
}

/// Calculate refund from selling shares: C(q) - C(q - Δ)
/// Returns refund in lamports
pub fn lmsr_sell_refund(
    q: &[u64; 10],
    b: u64,
    outcome_index: u8,
    amount: u64,
    outcome_count: u8,
) -> Result<u64> {
    // Ensure we have enough shares to sell
    require!(
        q[outcome_index as usize] >= amount,
        MainErrorCode::InsufficientShares
    );

    // Calculate C(q)
    let cost_before = lmsr_cost(q, b, outcome_count)?;

    // Calculate C(q - Δ)
    let mut q_after = *q;
    q_after[outcome_index as usize] = q_after[outcome_index as usize]
        .checked_sub(amount)
        .ok_or(MainErrorCode::InsufficientShares)?;

    let cost_after = lmsr_cost(&q_after, b, outcome_count)?;

    // Return difference
    cost_before.checked_sub(cost_after)
        .ok_or(MainErrorCode::MathOverflow.into())
}

/// Calculate current price for an outcome: p_i = exp(q_i/b) / sum_j exp(q_j/b)
/// Returns price scaled by SCALE (1e9), so 0.5 = 500_000_000
pub fn lmsr_price(
    q: &[u64; 10],
    b: u64,
    outcome_index: u8,
    outcome_count: u8,
) -> Result<u64> {
    require!(b > 0, MainErrorCode::InvalidLiquidityParameter);
    require!(outcome_count >= 2 && outcome_count <= 10, MainErrorCode::InvalidOutcomeCount);

    let b_scaled = (b as u128).checked_mul(SCALE).ok_or(MainErrorCode::MathOverflow)?;

    // Calculate sum of exp(q_j / b) and exp(q_i / b)
    let mut exp_sum: u128 = 0;
    let mut exp_i: u128 = 0;

    for j in 0..(outcome_count as usize) {
        let q_j = q[j] as u128;

        // Calculate q_j / b (scaled)
        let ratio = q_j.checked_mul(SCALE)
            .ok_or(MainErrorCode::MathOverflow)?
            .checked_mul(SCALE)
            .ok_or(MainErrorCode::MathOverflow)?
            .checked_div(b_scaled)
            .ok_or(MainErrorCode::MathOverflow)?;

        // Calculate exp(q_j / b)
        let exp_val = exp_fixed(ratio)?;

        exp_sum = exp_sum.checked_add(exp_val)
            .ok_or(MainErrorCode::MathOverflow)?;

        if j == outcome_index as usize {
            exp_i = exp_val;
        }
    }

    // Calculate p_i = exp_i / exp_sum (scaled)
    let price = exp_i.checked_mul(SCALE)
        .ok_or(MainErrorCode::MathOverflow)?
        .checked_div(exp_sum)
        .ok_or(MainErrorCode::MathOverflow)?;

    Ok(price as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exp_fixed() {
        // e^0 = 1
        assert_eq!(exp_fixed(0).unwrap(), SCALE);

        // e^1 ≈ 2.718281828
        let e = exp_fixed(SCALE).unwrap();
        assert!(e > 2_700_000_000 && e < 2_750_000_000);
    }

    #[test]
    fn test_lmsr_cost_binary() {
        let b = 100_000_000_000; // 100 SOL
        let mut q = [0u64; 10];

        // Initial cost with q = [0, 0]
        let cost0 = lmsr_cost(&q, b, 2).unwrap();
        assert!(cost0 > 0);

        // Cost after buying outcome 0
        q[0] = 10_000_000_000; // 10 shares
        let cost1 = lmsr_cost(&q, b, 2).unwrap();
        assert!(cost1 > cost0);
    }

    #[test]
    fn test_lmsr_buy_cost() {
        let b = 50_000_000_000; // 50 SOL
        let q = [0u64; 10];

        let cost = lmsr_buy_cost(&q, b, 0, 5_000_000_000, 2).unwrap();
        assert!(cost > 0);
    }
}
