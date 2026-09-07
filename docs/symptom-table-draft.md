# Symptom table draft (contract v3, for River's review)

Generated 2026-09-07 by scripts/engine-tools/symptom_table.ts from the engine on feat/engine-contract-v3. Every row is the engine's actual answer for that symptom alone, on an air-fork previous tune of fork 14 / 12 at 10.6 bar and shock LSC 12, HSC 1.5, rebound 14, sag 103, overall rating 6 (global scale 1.0). Deltas are clicks out from closed (positive = softer or faster), bar for air, turns for HSC. Severity 3 / 6 / 9 are the regression suite's mild / moderate / bad. "Inherited from X" means the row mirrors the byte-frozen legacy row X; "NEW" means authored on 2026-09-05 and awaiting correction. Sag never moves.

How to review: change the numbers or the direction in this file (or say so in the PR); the PR then implements the corrected table and its tests. Rows you leave alone ship as shown.

## The 14 ids at three severities

| Symptom | Severity | Fork comp | Fork reb | Fork air (bar) | Shock LSC | Shock HSC (turns) | Shock reb | Authorship | Engine notes |
|---|---|---|---|---|---|---|---|---|---|
| harsh_small_bumps | 3 | +1 | 0 | -0.03 | 0 | 0 | 0 | inherited from harsh_braking_bumps | Harsh on small bumps → +1 fork compression clicks (softer). Optionally -0.05 bar AER. |
| harsh_small_bumps | 6 | +2 | 0 | -0.05 | 0 | 0 | 0 | inherited from harsh_braking_bumps | Harsh on small bumps → +2 fork compression clicks (softer). Optionally -0.10 bar AER. |
| harsh_small_bumps | 9 | +3 | 0 | -0.1 | 0 | 0 | 0 | inherited from harsh_braking_bumps | Harsh on small bumps → +3 fork compression clicks (softer). Optionally -0.20 bar AER. |
| bottoming | 3 | 0 | 0 | +0.03 | -1 | -0.25 | 0 | inherited from bottoms_landings | Bottoming on landings / G-outs → -1 shock LSC clicks (firmer) and -0.25 HSC turns. ⏎ Also +0.03 bar fork AER for more mid-stroke support. |
| bottoming | 6 | 0 | 0 | +0.07 | -1 | -0.25 | 0 | inherited from bottoms_landings | Bottoming on landings / G-outs → -1 shock LSC clicks (firmer) and -0.25 HSC turns. ⏎ Also +0.07 bar fork AER for more mid-stroke support. |
| bottoming | 9 | 0 | 0 | +0.14 | -2 | -0.5 | 0 | inherited from bottoms_landings | Bottoming on landings / G-outs → -2 shock LSC clicks (firmer) and -0.50 HSC turns. ⏎ Also +0.14 bar fork AER for more mid-stroke support. |
| rear_kicks | 3 | 0 | 0 | 0 | 0 | 0 | -1 | inherited from rear_kicks_accel | Rear kicks → -1 shock rebound clicks (slower to stop kicking). |
| rear_kicks | 6 | 0 | 0 | 0 | 0 | 0 | -2 | inherited from rear_kicks_accel | Rear kicks → -2 shock rebound clicks (slower to stop kicking). |
| rear_kicks | 9 | 0 | 0 | 0 | 0 | 0 | -3 | inherited from rear_kicks_accel | Rear kicks → -3 shock rebound clicks (slower to stop kicking). |
| front_pushes | 3 | -1 | +1 | 0 | 0 | 0 | 0 | inherited from front_knifes | Front pushes in corners → -1 fork compression clicks (firmer) and +1 fork rebound click for a touch more pop. |
| front_pushes | 6 | -1 | +1 | 0 | 0 | 0 | 0 | inherited from front_knifes | Front pushes in corners → -1 fork compression clicks (firmer) and +1 fork rebound click for a touch more pop. |
| front_pushes | 9 | -2 | +1 | 0 | 0 | 0 | 0 | inherited from front_knifes | Front pushes in corners → -2 fork compression clicks (firmer) and +1 fork rebound click for a touch more pop. |
| packs_in_chop | 3 | 0 | +1 | 0 | 0 | 0 | +1 | inherited from packs_whoops | Packing in chop → +1 fork rebound clicks and +1 shock rebound clicks (faster to avoid packing). |
| packs_in_chop | 6 | 0 | +2 | 0 | 0 | 0 | +2 | inherited from packs_whoops | Packing in chop → +2 fork rebound clicks and +2 shock rebound clicks (faster to avoid packing). |
| packs_in_chop | 9 | 0 | +3 | 0 | 0 | 0 | +3 | inherited from packs_whoops | Packing in chop → +3 fork rebound clicks and +3 shock rebound clicks (faster to avoid packing). |
| wallows_dives | 3 | -1 | 0 | 0 | -1 | 0 | 0 | NEW (sign-off) | Wallowing / diving → -1 fork compression clicks (firmer) and -1 shock LSC click for hold-up. |
| wallows_dives | 6 | -1 | 0 | 0 | -1 | 0 | 0 | NEW (sign-off) | Wallowing / diving → -1 fork compression clicks (firmer) and -1 shock LSC click for hold-up. |
| wallows_dives | 9 | -2 | 0 | 0 | -1 | 0 | 0 | NEW (sign-off) | Wallowing / diving → -2 fork compression clicks (firmer) and -1 shock LSC click for hold-up. |
| headshake | 3 | 0 | -1 | 0 | 0 | 0 | -1 | inherited from headshake | High-speed headshake → -1 fork rebound click and -1 shock rebound click (slightly slower) for stability. |
| headshake | 6 | 0 | -1 | 0 | 0 | 0 | -1 | inherited from headshake | High-speed headshake → -1 fork rebound click and -1 shock rebound click (slightly slower) for stability. |
| headshake | 9 | 0 | -1 | 0 | 0 | 0 | -1 | inherited from headshake | High-speed headshake → -1 fork rebound click and -1 shock rebound click (slightly slower) for stability. |
| rear_swaps | 3 | 0 | 0 | 0 | +1 | 0 | -1 | NEW (sign-off) | Rear swaps → +1 shock LSC clicks (softer for traction) and -1 shock rebound click to settle it. |
| rear_swaps | 6 | 0 | 0 | 0 | +2 | 0 | -1 | NEW (sign-off) | Rear swaps → +2 shock LSC clicks (softer for traction) and -1 shock rebound click to settle it. |
| rear_swaps | 9 | 0 | 0 | 0 | +3 | 0 | -1 | NEW (sign-off) | Rear swaps → +3 shock LSC clicks (softer for traction) and -1 shock rebound click to settle it. |
| deflects | 3 | 0 | -1 | 0 | 0 | 0 | 0 | inherited from deflects_in_chop | Front deflects → -1 fork rebound clicks (slower to keep the tire planted). |
| deflects | 6 | 0 | -2 | 0 | 0 | 0 | 0 | inherited from deflects_in_chop | Front deflects → -2 fork rebound clicks (slower to keep the tire planted). |
| deflects | 9 | 0 | -3 | 0 | 0 | 0 | 0 | inherited from deflects_in_chop | Front deflects → -3 fork rebound clicks (slower to keep the tire planted). |
| rear_squats | 3 | 0 | 0 | 0 | -1 | 0 | 0 | NEW (sign-off) | Rear squats on the gas → -1 shock LSC clicks (firmer). |
| rear_squats | 6 | 0 | 0 | 0 | -1 | 0 | 0 | NEW (sign-off) | Rear squats on the gas → -1 shock LSC clicks (firmer). |
| rear_squats | 9 | 0 | 0 | 0 | -2 | -0.25 | 0 | NEW (sign-off) | Rear squats on the gas → -2 shock LSC clicks (firmer) and -0.25 HSC turns. |
| too_stiff | 3 | +1 | 0 | -0.03 | +1 | 0 | 0 | inherited from general_harsh | Too stiff → +1 fork compression clicks (softer) and +1 shock LSC click. ⏎ Also -0.03 bar AER for a touch more comfort. |
| too_stiff | 6 | +1 | 0 | -0.05 | +1 | 0 | 0 | inherited from general_harsh | Too stiff → +1 fork compression clicks (softer) and +1 shock LSC click. ⏎ Also -0.05 bar AER for a touch more comfort. |
| too_stiff | 9 | +2 | 0 | -0.1 | +1 | 0 | 0 | inherited from general_harsh | Too stiff → +2 fork compression clicks (softer) and +1 shock LSC click. ⏎ Also -0.10 bar AER for a touch more comfort. |
| too_soft | 3 | -1 | 0 | +0.03 | -1 | 0 | 0 | NEW (sign-off) | Too soft → -1 fork compression clicks (firmer) and -1 shock LSC click. ⏎ Also +0.03 bar AER for more hold-up. |
| too_soft | 6 | -1 | 0 | +0.05 | -1 | 0 | 0 | NEW (sign-off) | Too soft → -1 fork compression clicks (firmer) and -1 shock LSC click. ⏎ Also +0.05 bar AER for more hold-up. |
| too_soft | 9 | -2 | 0 | +0.1 | -1 | 0 | 0 | NEW (sign-off) | Too soft → -2 fork compression clicks (firmer) and -1 shock LSC click. ⏎ Also +0.10 bar AER for more hold-up. |
| arm_pump | 3 | +1 | +1 | -0.03 | 0 | 0 | 0 | NEW (sign-off) | Arm pump → +1 fork compression clicks (softer) and +1 fork rebound click so the front stops hammering your hands. ⏎ Also -0.03 bar AER for comfort. |
| arm_pump | 6 | +2 | +1 | -0.05 | 0 | 0 | 0 | NEW (sign-off) | Arm pump → +2 fork compression clicks (softer) and +1 fork rebound click so the front stops hammering your hands. ⏎ Also -0.05 bar AER for comfort. |
| arm_pump | 9 | +3 | +1 | -0.1 | 0 | 0 | 0 | NEW (sign-off) | Arm pump → +3 fork compression clicks (softer) and +1 fork rebound click so the front stops hammering your hands. ⏎ Also -0.10 bar AER for comfort. |
| chatters | 3 | +1 | -1 | 0 | 0 | 0 | 0 | NEW (sign-off) | Chatter → -1 fork rebound clicks (slower) and +1 fork compression click (softer) to settle the front. |
| chatters | 6 | +1 | -2 | 0 | 0 | 0 | 0 | NEW (sign-off) | Chatter → -2 fork rebound clicks (slower) and +1 fork compression click (softer) to settle the front. |
| chatters | 9 | +1 | -3 | 0 | 0 | 0 | 0 | NEW (sign-off) | Chatter → -3 fork rebound clicks (slower) and +1 fork compression click (softer) to settle the front. |

## Qualifier pairs (severity 6)

The three chips with a mandatory qualifier. A route marked NEW changes the move; the others keep the chip's default move and only mention the location in the note.

| Symptom | Severity | Fork comp | Fork reb | Fork air (bar) | Shock LSC | Shock HSC (turns) | Shock reb | Authorship | Engine notes |
|---|---|---|---|---|---|---|---|---|---|
| harsh_small_bumps (no qualifier) | 6 | +2 | 0 | -0.05 | 0 | 0 | 0 | inherited from harsh_braking_bumps | Harsh on small bumps → +2 fork compression clicks (softer). Optionally -0.10 bar AER. |
| harsh_small_bumps + small_chop | 6 | +2 | 0 | -0.05 | 0 | 0 | 0 | default move + note | Harsh on small bumps → +2 fork compression clicks (softer). Optionally -0.10 bar AER. (reported in small chop) |
| harsh_small_bumps + under_braking | 6 | +2 | 0 | -0.05 | 0 | 0 | 0 | default move + note | Harsh on small bumps → +2 fork compression clicks (softer). Optionally -0.10 bar AER. (reported in under braking) |
| harsh_small_bumps + big_hits | 6 | 0 | 0 | +0.07 | -1 | -0.25 | 0 | NEW route (sign-off) | Harshness on landings is a bottoming problem → -1 shock LSC clicks (firmer) and -0.25 HSC turns. ⏎ Also +0.07 bar fork AER for more mid-stroke support. |
| rear_kicks (no qualifier) | 6 | 0 | 0 | 0 | 0 | 0 | -2 | inherited from rear_kicks_accel | Rear kicks → -2 shock rebound clicks (slower to stop kicking). |
| rear_kicks + jump_face | 6 | 0 | 0 | 0 | 0 | -0.25 | -2 | NEW route (sign-off) | Rear kicks → -2 shock rebound clicks (slower to stop kicking). ⏎ Since it kicks on jump faces → also -0.25 HSC turns to hold the rear up on the face. |
| rear_kicks + braking_bumps | 6 | 0 | -1 | 0 | 0 | 0 | -2 | NEW route (sign-off) | Rear kicks → -2 shock rebound clicks (slower to stop kicking). ⏎ Since it kicks in the braking bumps → also -1 fork rebound click to keep the front settled under braking. |
| rear_kicks + logs_ledges | 6 | 0 | 0 | 0 | +1 | 0 | -2 | NEW route (sign-off) | Rear kicks → -2 shock rebound clicks (slower to stop kicking). ⏎ Since it kicks on logs and ledges → also +1 shock LSC click (softer) so the rear can absorb the edge. |
| packs_in_chop (no qualifier) | 6 | 0 | +2 | 0 | 0 | 0 | +2 | inherited from packs_whoops | Packing in chop → +2 fork rebound clicks and +2 shock rebound clicks (faster to avoid packing). |
| packs_in_chop + whoops | 6 | 0 | +2 | 0 | 0 | 0 | +2 | default move + note | Packing in chop → +2 fork rebound clicks and +2 shock rebound clicks (faster to avoid packing). (reported in whoops) |
| packs_in_chop + rocks | 6 | +1 | +2 | 0 | 0 | 0 | +2 | NEW route (sign-off) | Packing in chop → +2 fork rebound clicks and +2 shock rebound clicks (faster to avoid packing). ⏎ Since it packs in the rocks → also +1 fork compression click (softer) for the sharp hits. |

## Legacy ids, for reference (byte-frozen; severity 6)

| Symptom | Severity | Fork comp | Fork reb | Fork air (bar) | Shock LSC | Shock HSC (turns) | Shock reb | Authorship | Engine notes |
|---|---|---|---|---|---|---|---|---|---|
| harsh_braking_bumps | 6 | +2 | 0 | -0.05 | 0 | 0 | 0 | frozen; reads as harsh_small_bumps + under_braking | Harsh on braking bumps → +2 fork compression clicks (softer). Optionally -0.10 bar AER. |
| deflects_in_chop | 6 | 0 | -2 | 0 | 0 | 0 | 0 | frozen; reads as deflects | Front deflects in chop → -2 fork rebound clicks (slower to keep the tire planted). |
| rear_kicks_accel | 6 | 0 | 0 | 0 | 0 | 0 | -2 | frozen; reads as rear_kicks | Rear kicks on acceleration chop → -2 shock rebound clicks (slower to stop kicking). |
| bottoms_landings | 6 | 0 | 0 | +0.07 | -1 | -0.25 | 0 | frozen; reads as bottoming | Bottoming on landings / G-outs → -1 shock LSC clicks (firmer) and -0.25 HSC turns. ⏎ Also +0.07 bar fork AER for more mid-stroke support. |
| front_knifes | 6 | -1 | +1 | 0 | 0 | 0 | 0 | frozen; reads as front_pushes | Front knifing in corners → -1 fork compression clicks (firmer) and +1 fork rebound click for a touch more pop. |
| dead_feel | 6 | -1 | +2 | 0 | 0 | 0 | +1 | frozen; reads as dead_feel | Bike feels dead / no pop → +2 fork rebound clicks and +1 shock rebound clicks (faster), with -1 fork comp click for a bit more support. |
| unstable_whoops | 6 | 0 | -2 | +0.04 | 0 | 0 | -2 | frozen; reads as unstable_whoops | Unstable in whoops → -2 fork rebound clicks and -2 shock rebound clicks (slower for stability). ⏎ Slight +0.04 bar AER to hold up in whoops. |
| packs_whoops | 6 | 0 | +2 | 0 | 0 | 0 | +2 | frozen; reads as packs_in_chop + whoops | Packing in whoops → +2 fork rebound clicks and +2 shock rebound clicks (faster to avoid packing). |
| harsh_square_edge | 6 | +2 | 0 | 0 | +1 | 0 | 0 | frozen; reads as harsh_square_edge | Harsh on square-edge → +2 fork compression clicks (softer) and +1 shock LSC clicks for traction. |
| headshake | 6 | 0 | -1 | 0 | 0 | 0 | -1 | frozen; reads as headshake | High-speed headshake → -1 fork rebound click and -1 shock rebound click (slightly slower) for stability. |
| general_harsh | 6 | +1 | 0 | -0.05 | +1 | 0 | 0 | frozen; reads as too_stiff | General harshness → +1 fork compression clicks (softer) and +1 shock LSC click. ⏎ Also -0.05 bar AER for a touch more comfort. |

## Legacy tags on the v3 ids (severity 6)

The four v2 location tags still route on the inherited rows exactly as they did on the legacy ids.

| Symptom | Severity | Fork comp | Fork reb | Fork air (bar) | Shock LSC | Shock HSC (turns) | Shock reb | Authorship | Engine notes |
|---|---|---|---|---|---|---|---|---|---|
| harsh_small_bumps + landings | 6 | 0 | 0 | +0.07 | -1 | -0.25 | 0 | inherited from harsh_braking_bumps | Harshness on landings is a bottoming problem → -1 shock LSC clicks (firmer) and -0.25 HSC turns. ⏎ Also +0.07 bar fork AER for more mid-stroke support. |
| harsh_small_bumps + corners | 6 | +2 | 0 | 0 | 0 | 0 | 0 | inherited from harsh_braking_bumps | Harsh into corners → +2 fork compression clicks (softer), leaving air pressure alone. |
| harsh_small_bumps + whoops | 6 | +2 | 0 | -0.05 | +1 | 0 | 0 | inherited from harsh_braking_bumps | Harsh on small bumps → +2 fork compression clicks (softer). Optionally -0.10 bar AER. ⏎ Since it's harsh in the whoops → also +1 shock LSC click (softer). |
| bottoming + whoops | 6 | 0 | 0 | +0.07 | -1 | -0.25 | -1 | inherited from bottoms_landings | Bottoming on landings / G-outs → -1 shock LSC clicks (firmer) and -0.25 HSC turns. ⏎ Also +0.07 bar fork AER for more mid-stroke support. ⏎ Since the bottoming is in whoops → also -1 shock rebound click (slower on whoop faces). |
| deflects + braking | 6 | 0 | -2 | 0 | 0 | 0 | 0 | inherited from deflects_in_chop | Front deflects → -2 fork rebound clicks (slower to keep the tire planted). (reported in braking) |
| front_pushes + corners | 6 | -1 | +1 | 0 | 0 | 0 | 0 | inherited from front_knifes | Front pushes in corners → -1 fork compression clicks (firmer) and +1 fork rebound click for a touch more pop. |
