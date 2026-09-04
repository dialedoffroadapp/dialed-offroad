# Conversion dashboards (migration 20260904160000, schema `analytics`, service role)

Targets from the conversion playbook ("What to measure and target thresholds"):

| View | Metric | Target / trip-wire |
|---|---|---|
| `analytics.blended_free_to_paid` | paid ÷ post-3.0 accounts by signup week | 4 to 6% (2 to 3x the 2.1% freemium median); below 3% for two cohorts = free tier too generous, re-gate |
| `analytics.reverse_trial_conversion` | trials → paid within 45 days, plus how trials ended (ride_days vs clock) | 35%+; below 25% = trial too short or aha not landing |
| `analytics.downgrade_intent` | gate dismissed / pricing viewed without purchase inside 24 h and 48 h of trial start | day-0 / day-1 intent share (episodic risk indicator) |
| `analytics.revenue_per_account_day60` | RC revenue per account within 60 days, pre- vs post-3.0 | the single number that says whether 3.0 earned more than the hard paywall |
| `analytics.gate_funnel` | shown → dismissed → pricing → converted per trigger | paywall visibility (many apps leak because <30% ever see it) |

Inputs: `profiles.entitlement_state/trial_*` (migration 20260904150000), `usage_events` (`trial_started`, `trial_ended`, `downgraded`, `gate_shown`, `gate_dismissed`, `gate_converted`, `pricing_page_viewed`, `lifetime_offered`, `qualified_trial`), and `rc_events` (written by the RevenueCat webhook's additive revenue log; not deployed yet). `app_config.launch_3_0_at` splits pre/post cohorts; set it at launch.

Example:
```sql
select * from analytics.blended_free_to_paid order by cohort_week desc limit 12;
select * from analytics.reverse_trial_conversion order by trial_week desc limit 12;
select * from analytics.downgrade_intent order by trial_week desc limit 12;
select * from analytics.revenue_per_account_day60;
select * from analytics.gate_funnel;
```
Do not blend these with RevenueCat's own dashboard rates: different denominators (playbook data caveat).
