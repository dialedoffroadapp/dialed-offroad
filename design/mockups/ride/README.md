# Dialed Offroad 3.0 mockup pack: Ride day

Visual source of truth for the ride-day sequence. Open any file in a browser. `dialed.css` is the shared system; `ride.css` adds the ride-day components and the OUTDOOR treatment.

| File | Screen | Treatment |
|---|---|---|
| 01-start-first-ride.html | Start Riding, first ride, unpopulated prompts, dimmed CTA | normal |
| 02-start-returning.html | Start Riding, defaulted from last time, 3 filled cards | normal |
| 03-track-picker.html | Track picker: search or name, Recent, Nearby, New track here | normal |
| 04-conditions.html | Conditions: surface, track state, temperature band, watered toggle | normal |
| 05-todays-setup.html | Set this before moto 1: plain list, 32pt numbers, changed rows show old → new | normal |
| 06-ride-mode.html | Persistent ride mode: elapsed time, running numbers, retune row, huge Log moto | OUTDOOR |
| 07-midday-retune.html | What changed? tiles, retuned rows, set it | OUTDOOR |
| 08-log-moto.html | Better/Same/Worse, 4 large chips + More, terrain qualifier, optional voice | OUTDOOR |
| 09-adjust.html | One change per screen, old → new, direction, Done confirmation | OUTDOOR |
| 10-end-ride.html | Day wrapped: moto timeline, stats, dialed delta, save as track baseline | normal |

Rules the mockups encode:
- OUTDOOR treatment (06, 07, 08, 09): pure black background, pure white text, 800-weight numerals, 2px borders, no hairlines. Blue only on the primary action and the direction line.
- Every control used between motos is 56pt or taller; Log moto and Done are the biggest controls in the app.
- Symptom grid is 4 large chips plus "More symptoms" (never 8 small chips).
- Adjust is one change per screen with progress dots; nothing saves until "Done, turned it"; the confirmation records the new absolute clicker position.
- Ride mode shows "saved on phone" at all times (offline-first outbox), persists across relaunch, and runs a lock-screen Live Activity.
- No notifications tied to ride days of any kind, ever. The only ride-related prompt is a next-day "still riding?" that closes a forgotten session with an editable end time.
