export const ANNUITY_SYSTEM_PROMPT = `You are an expert financial analyst specializing in annuity contracts.
Extract structured data from annuity carrier statements, then evaluate each contract against a 10-point review framework.
Always respond with valid JSON only — no markdown, no prose, no code fences.`

export const ANNUITY_USER_PROMPT = `Extract all annuity contract information from this carrier statement or account document. This may be a variable, indexed, fixed, or MYGA annuity from any carrier (including Sammons Financial Group companies such as Midland National, North American Company, etc.).

Return a JSON object with this exact shape:

{
  "contracts": [
    {
      "contract_number": "string or null",
      "carrier": "string — insurance company name",
      "product_name": "string — product or series name, or null",
      "annuity_type": "one of: Fixed, Fixed Indexed, Variable, RILA, SPIA, MYGA, DIA, or null",
      "owner": "string — owner name(s)",
      "joint_owner": "string or null",
      "insured": "string or null",
      "account_type": "one of: Non-Qualified, Traditional IRA, Roth IRA, SEP IRA, SIMPLE IRA, Inherited IRA, or null",
      "issue_date": "YYYY-MM-DD or null",
      "valuation_date": "YYYY-MM-DD or null — the AS-OF date of this statement (most recent date shown)",
      "account_value": "number or null — CURRENT ending balance as of statement date; NOT a beginning-of-period value",
      "surrender_value": "number or null — net surrender value after charges",
      "initial_premium": "number or null — first premium paid at contract issue",
      "total_premiums_paid": "number or null — ALL premiums and contributions paid to date (initial + every subsequent). Look for: total premiums paid, total contributions, cumulative premiums, purchase payments, cost basis",
      "total_withdrawals": "number or null — cumulative total amount withdrawn from the contract to date",
      "surrender_period": "string or null — e.g. '7 years' or 'ends 2027'",
      "surrender_schedule": [{ "year": 1, "charge_pct": 8 }],
      "current_surrender_charge_pct": "number or null",
      "current_surrender_charge_amt": "number or null",
      "free_withdrawal_pct": "number or null — typically 10%",
      "me_cost_pct": "number or null — mortality and expense risk charge as annual % (e.g. 1.25 for 1.25%)",
      "total_rider_cost_pct": "number or null — sum of all annual rider fees as %",
      "total_cost_pct": "number or null — total annual contract cost: M&E + riders (add ~1% for fund fees if variable)",
      "beneficiary": "string or null — primary beneficiary name(s) and percentages, e.g. 'John Smith (100%)'",
      "beneficiary_is_trust": "boolean — true if primary beneficiary is a trust or estate",
      "income_benefit": {
        "rider_name": "string or null",
        "benefit_base": "number or null — income base / protected benefit value",
        "guaranteed_rollup_rate": "number or null — annual rollup % during accumulation",
        "withdrawal_pct": "number or null — payout % applied to benefit base",
        "annual_income": "number or null — guaranteed annual income amount",
        "income_start_date": "YYYY-MM-DD or null",
        "income_status": "one of: not started, active, or null"
      },
      "notes": "string or null — important details not captured above",
      "analysis": [
        { "number": 1, "question": "Can income be increased?", "flagged": false, "reason": null },
        { "number": 2, "question": "Can a guaranteed death benefit be increased?", "flagged": false, "reason": null },
        { "number": 3, "question": "Is there a single-life rider that could be upgraded to joint life?", "flagged": false, "reason": null },
        { "number": 4, "question": "Does the contract have step-ups that end?", "flagged": false, "reason": null },
        { "number": 5, "question": "Does the client need an enhanced death benefit?", "flagged": false, "reason": null },
        { "number": 6, "question": "Does the client have a rider or benefit they are not utilizing?", "flagged": false, "reason": null },
        { "number": 7, "question": "Can the fees be lowered?", "flagged": false, "reason": null },
        { "number": 8, "question": "Has the client objective changed?", "flagged": false, "reason": null },
        { "number": 9, "question": "Does the client have protection from market loss?", "flagged": false, "reason": null },
        { "number": 10, "question": "Are the beneficiaries set up correctly?", "flagged": false, "reason": null }
      ]
    }
  ],
  "document_summary": "string — brief description of what this document is",
  "statement_date": "YYYY-MM-DD or null — the as-of date of this statement",
  "account_holder": "string — primary account holder name(s)"
}

KEY EXTRACTION RULES:
- account_value: ENDING/CURRENT balance as of statement date, NOT beginning-of-period
- total_premiums_paid: sum of ALL money paid in (initial + every subsequent contribution); look for transaction history tables and sum purchase payments
- If there is only one contract, the contracts array has one entry; if multiple, include all
- Use null for any field you cannot find or determine

10-POINT ANALYSIS — evaluate each item based on the extracted data; set flagged=true if it is an opportunity or concern; provide a specific one-sentence reason when flagged, null when not:
1. Can income be increased? — Flag if income_benefit rider exists AND income_status="not started" (income never activated), OR benefit_base is much larger than what the current annual_income implies
2. Can a guaranteed death benefit be increased? — Flag if no death benefit rider detected, OR account_value < total_premiums_paid (contract is underwater)
3. Single-life rider upgradeable to joint life? — Flag if income_benefit rider exists AND no joint_owner on the contract (potential upgrade for spouse coverage)
4. Contract has step-ups or bonuses that end? — Flag if notes, rider terms, or the product name mention a bonus period, rollup period, or step-ups that expire after a set number of years
5. Client needs enhanced death benefit? — Flag if annuity_type is Variable AND no guaranteed minimum death benefit or death benefit rider is mentioned
6. Rider or benefit not being utilized? — Flag if income_benefit rider exists AND income_status="not started" (paying for a rider but not using it)
7. Can the fees be lowered? — Flag if total_cost_pct > 2.5, OR me_cost_pct > 1.35, OR total_rider_cost_pct > 1.5
8. Has the client objective changed? — Flag if annuity_type=Variable AND account_value < total_premiums_paid (loss may indicate risk tolerance shift), OR contract was issued 15+ years ago and structure may no longer match retirement stage
9. Does the client have protection from market loss? — Flag if annuity_type=Variable AND no floor, guaranteed minimum accumulation benefit, or downside protection is mentioned
10. Beneficiaries set up correctly? — Flag if beneficiary_is_trust=true (trust beneficiary creates IRA distribution complexity), OR no beneficiary information found, OR beneficiary appears to be "estate"

Return ONLY the JSON object — nothing else`
