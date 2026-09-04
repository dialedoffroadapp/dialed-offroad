# Lifecycle emails (drafts for River's review; nothing sends yet)

**Why Loops over Resend.** Our stack is Supabase (Postgres + Deno edge functions) with no email infrastructure at all. Every email below is behavior-triggered with a delay somewhere (trial ending 3 days out, downgraded plus 3 days, a manual seasonal send). Loops is built for exactly that: send it an event and contact properties, and it owns sequencing, delays, unsubscribes, and one-off campaigns from its UI, so River can retime or reword without a deploy. Resend is a transactional API; we would have to build scheduling (pg_cron), preference management, and templates ourselves. Resend remains the right choice later for Supabase Auth's transactional mail (SMTP), which is a separate wiring. The conversion playbook (§5) is explicit that freemium conversion is behavior-triggered, not drip-timed, which is what the event model gives us.

**Wiring.** `lib/lifecycle.ts` emits events from the app to the `lifecycle-events` edge function, which forwards to Loops and upserts contact properties (bike, trial_ends_at, locked_versions). A cron call of the same function handles the two time-based legs. `lifecycle_sends` dedupes once-per-account events. Not deployed; `LOOPS_API_KEY` unset; nothing sends until these drafts are approved.

Voice: the app's. Short lines, plain words, no em dashes, no fake urgency, no guilt (playbook §3: honest pitch, one-click cancel).

---

## 1. Account created (immediately)
**Event:** `account_created`
**Subject:** Your [bike] baseline is saved
**Body:**

Your baseline tune for the [year] [bike] is in your garage.

Pro is on for your next 3 ride days. That means the whole loop: log a moto, get the clicker change, ride it, log the next one.

Here is what riders do first:
1. Set the numbers on the bike. Two minutes with the clickers.
2. Start riding on your next ride day. The clock and the numbers travel with you.
3. Log moto one. The app tells you what to turn before moto two.

Nothing to buy today. Ride it.

[Open Dialed]

---

## 2. First session (after the first app session, day 1)
**Event:** `first_session`
**Subject:** How the ride day loop works
**Body:**

You have a baseline. Here is how it gets better.

Every ride day is a loop. Start riding, log each moto (Better, Same, Worse, and what it did), and the app hands you one change at a time with the reason. One change, then re-test. That is how tuners work, and it is how your setup story gets written.

Your first three ride days are on Pro. Use them.

[Start riding]

---

## 3. First ride day logged (after the first logged ride day)
**Event:** `first_ride_day_logged`
**Subject:** The app has a clicker change ready
**Body:**

You logged your first ride day at [track]. [N] motos, [sentiment summary].

The app has a change ready for your next moto: [change line, e.g. 2 clicks out on shock low speed comp], because [reason]. It is waiting in ride mode.

Your setup story started saving today. Every version, every reason.

[Open ride mode]

---

## 4. Trial ending (1 ride day left, or 3 days before the clock runs out)
**Event:** `trial_ending`
**Subject:** One more Pro ride day
**Body:**

You have one Pro ride day left. After it, clicker suggestions pause and your setup story keeps saving in the background.

What stays free: your bike, its baseline, the current numbers, and a fresh baseline whenever you want one.

What Pro keeps going: log motos, get the change, setup history, a second setup, a second bike.

A suspension tuner runs about $500 a visit. A revalve is $295 to $600. Dialed Pro is $59.99 a year, about a dollar per ride day.

[Keep Pro]

---

## 5. Downgraded (3 days after the trial ends)
**Event:** `downgraded`
**Subject:** Your setup story is still saving
**Body:**

Pro paused after your [N] trial ride days. Your baseline is still yours, and you can regenerate it any time.

Since then the app has kept recording: [locked_versions] versions of your [bike] setup are in your story, every reason attached. Pro opens all of it, plus the next clicker change.

No pressure. It will be there when you want it.

[See what's waiting]

---

## 6. Meter stalled (when the meter has not moved in 2 ride days and the rest is locked)
**Event:** `meter_stalled`
**Subject:** You're [pct]% dialed. Here's the rest.
**Body:**

Your [bike] is [pct]% dialed and has been for two ride days.

The next [rest]% is Pro: [locked categories, e.g. your first refinement and setup history]. That is the part where the app turns your motos into clicker changes.

If you are happy where it is, keep riding it. If it is not quite there yet, Pro is the fastest way through.

[Finish dialing it]

---

## 7. Seasonal reactivation (manual send, pre-season or the first warm weekend)
**Event:** `seasonal_reactivation` (sent manually from Loops as a campaign)
**Subject:** New season. Re-dial before your first ride.
**Body:**

The tracks are opening back up. Your [bike] is still in your garage, and last season's story is where you left it: [last setup name] v[n], last ridden at [track].

Before the first ride day, check your baseline. Fresh springs, a winter's worth of wear, or a new bike all change the numbers. A regenerated baseline is free.

Then start riding and let the loop pick up where it stopped.

[Check my baseline]

---

## Placeholders
`[bike]`, `[year]`, `[track]`, `[N]`, `[sentiment summary]`, `[change line]`, `[reason]`, `[locked_versions]`, `[pct]`, `[rest]`, `[locked categories]`, `[last setup name]`, `[n]` are Loops contact/event properties the edge function sends. Prices in email 4 should read from the same config as the app once Loops properties carry them.
