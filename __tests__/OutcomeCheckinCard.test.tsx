// Render-path tests for components/OutcomeCheckinCard.tsx: every trigger path
// (Home mount, Tune focus, warm resume, notification arrival), exactly-once
// logging across remounts, the one-card-per-session latch and its >1h reset,
// and checkin_source attribution on checkin_shown / preride_shown and the
// router params threaded to /tune-feedback.
//
// The card holds module-level session state (shownThisSession), so every test
// builds a fresh module registry via jest.resetModules() and requires React,
// react-test-renderer, and the card from that same registry — which is why
// elements are built with React.createElement instead of JSX (the test file's
// own JSX would bind to the original registry's React copy).
//
// supabase is a scripted queue mock (enqueue responses per table in call
// order), AsyncStorage is the official in-memory jest mock, AppState is the
// stub in stubs/react-native.js driven via __emit.

/* eslint-disable @typescript-eslint/no-require-imports --
   the fresh-registry pattern above requires require() after resetModules;
   top-level imports would pin the first registry's copies. */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();

jest.mock("expo-router", () => {
  const React = require("react");
  return {
    // Always-focused host tab: run on mount and whenever the callback identity
    // changes (the card's useCallback deps), with cleanup — the focused-tab
    // subset of useFocusEffect's behavior.
    useFocusEffect: (cb: any) => {
      React.useEffect(cb, [cb]);
    },
    useRouter: () => ({ push: mockPush }),
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("../lib/theme", () => ({
  useTheme: () => ({
    colors: {
      CARD: "#111",
      TEXT: "#fff",
      MUTED: "#888",
      ACCENT: "#1d9bf0",
      BORDER: "#333",
    },
  }),
}));

jest.mock("../lib/usage", () => ({
  logEvent: jest.fn(async () => undefined),
}));

jest.mock("../lib/rideReminder", () => ({
  cancelRideReminderForVersion: jest.fn(async () => undefined),
}));

jest.mock("../lib/setupVersions", () => ({
  ...jest.requireActual("../lib/setupVersions"),
  updateFeedbackOutcome: jest.fn(async () => undefined),
}));

jest.mock("../lib/supabase", () => {
  const queues: Record<string, any[]> = {};
  const auth = { getUser: jest.fn() };
  return {
    supabase: {
      auth,
      from: (table: string) => {
        const chain: any = {};
        for (const m of ["select", "eq", "not", "is", "lt", "order", "limit"]) {
          chain[m] = jest.fn(() => chain);
        }
        chain.maybeSingle = jest.fn(async () => {
          const q = queues[table];
          return q && q.length ? q.shift() : { data: null, error: null };
        });
        return chain;
      },
    },
    __enqueue: (table: string, data: any) => {
      (queues[table] ??= []).push({ data, error: null });
    },
    __auth: auth,
  };
});

const NOW = 1_753_300_000_000;
const HOUR = 60 * 60 * 1000;

let now = NOW;

// Per-test module world, all from one fresh registry.
let React: any;
let rtr: any;
let Card: any;
let rn: any;
let sb: any;
let usage: any;
let rideReminder: any;
let setupVersions: any;
let reminderArrival: any;

function loadWorld() {
  jest.resetModules();
  mockPush.mockClear();
  React = require("react");
  rtr = require("react-test-renderer");
  rn = require("react-native");
  sb = require("../lib/supabase");
  usage = require("../lib/usage");
  rideReminder = require("../lib/rideReminder");
  setupVersions = require("../lib/setupVersions");
  reminderArrival = require("../lib/reminderArrival");
  Card = require("../components/OutcomeCheckinCard").OutcomeCheckinCard;
  sb.__auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
}

const drain = () => new Promise<void>((r) => setImmediate(r));

async function mount(props: Record<string, any> = {}) {
  let tree: any;
  await rtr.act(async () => {
    tree = rtr.create(React.createElement(Card, props));
    await drain();
  });
  return tree;
}

async function press(node: any) {
  await rtr.act(async () => {
    node.props.onPress();
    await drain();
  });
}

async function warmResume(backgroundMs: number) {
  await rtr.act(async () => {
    rn.AppState.__emit("background");
    now += backgroundMs;
    rn.AppState.__emit("active");
    await drain();
  });
}

function pressableWithText(tree: any, text: string) {
  return tree.root
    .findAll((n: any) => n.type === "Pressable")
    .find((n: any) =>
      n
        .findAll((c: any) => c.type === "Text")
        .some((t: any) => t.props.children === text)
    );
}

function shownCalls(eventType: string) {
  return usage.logEvent.mock.calls.filter((c: any[]) => c[0] === eventType);
}

function versionRow(overrides: Record<string, any> = {}) {
  return {
    id: "v1",
    user_id: "u1",
    bike_id: "b1",
    parent_version_id: null,
    source: "baseline",
    version_number: 1,
    created_at: new Date(now - 13 * HOUR).toISOString(),
    fork_comp_clicks: 12,
    fork_reb_clicks: 12,
    fork_air_bar: null,
    shock_lsc_clicks: 12,
    shock_hsc_turns: 1.5,
    shock_reb_clicks: 14,
    sag_mm: 105,
    notes: [],
    terrain: "moto",
    context: {},
    ...overrides,
  };
}

const BIKE = { make: "KTM", model: "250 SX-F", year: 2025, nickname: null };

/** Branch-1 scenario: pending outcome fb → outcome card with a resolvable
 *  next version (so answering can route into the picker). */
function enqueueOutcomeScenario(feedbackId = "fb1", resultingId = "v9") {
  sb.__enqueue("ride_feedback", {
    id: feedbackId,
    symptoms: [{ id: "front_washes", severity: 9 }],
    resulting_version_id: resultingId,
  });
  sb.__enqueue(
    "setup_versions",
    versionRow({ id: resultingId, source: "refinement", version_number: 2 })
  );
  sb.__enqueue("bikes", BIKE);
}

/** Branch-2 organic scenario: no pending outcome, uncritiqued baseline. */
function enqueueFirstRideScenario(overrides: Record<string, any> = {}) {
  sb.__enqueue("ride_feedback", null); // branch 1: nothing pending
  sb.__enqueue("setup_versions", versionRow(overrides));
  sb.__enqueue("ride_feedback", null); // no feedback critiques it yet
  sb.__enqueue("bikes", BIKE);
}

// react-test-renderer 19 prints a deprecation banner on every create();
// swallow exactly that line so real act()/render warnings stay visible.
const realConsoleError = console.error.bind(console);
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation((...args: any[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("react-test-renderer is deprecated")
    ) {
      return;
    }
    realConsoleError(...args);
  });
});

beforeEach(() => {
  now = NOW;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  loadWorld();
});

afterEach(() => {
  (Date.now as jest.Mock).mockRestore?.();
});

test("Home mount: outcome card logs checkin_shown once, source home_mount; one AppState listener", async () => {
  enqueueOutcomeScenario();
  const tree = await mount({ surface: "home" });

  expect(tree.toJSON()).not.toBeNull();
  const calls = shownCalls("checkin_shown");
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual({
    feedback_id: "fb1",
    surface: "home",
    checkin_source: "home_mount",
  });

  expect(rn.AppState.__listenerCount()).toBe(1);
  await rtr.act(async () => tree.unmount());
  expect(rn.AppState.__listenerCount()).toBe(0);
});

test("Tune focus: first-ride card logs preride_shown with source tune_focus", async () => {
  enqueueFirstRideScenario();
  const tree = await mount({ surface: "tune" });

  expect(tree.toJSON()).not.toBeNull();
  expect(shownCalls("checkin_shown")).toHaveLength(0);
  const calls = shownCalls("preride_shown");
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual({
    version_id: "v1",
    bike_id: "b1",
    surface: "tune",
    shown_via_reminder: false,
    checkin_source: "tune_focus",
  });
});

test("organic first-ride respects the 12h age gate: young baseline renders nothing, logs nothing", async () => {
  enqueueFirstRideScenario({
    created_at: new Date(now - 1 * HOUR).toISOString(),
  });
  const tree = await mount({ surface: "home" });

  expect(tree.toJSON()).toBeNull();
  expect(usage.logEvent).not.toHaveBeenCalled();
});

test("guest: no card, no shown events", async () => {
  sb.__auth.getUser.mockResolvedValue({ data: { user: null } });
  enqueueOutcomeScenario();
  const tree = await mount({ surface: "home" });

  expect(tree.toJSON()).toBeNull();
  expect(usage.logEvent).not.toHaveBeenCalled();
});

test("warm resume: re-evaluation after background→active labels source warm_resume", async () => {
  const tree = await mount({ surface: "home" }); // nothing eligible yet
  expect(tree.toJSON()).toBeNull();

  enqueueOutcomeScenario();
  await warmResume(5 * 60 * 1000);

  const calls = shownCalls("checkin_shown");
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual(
    expect.objectContaining({ feedback_id: "fb1", checkin_source: "warm_resume" })
  );
});

test("notification arrival: bypasses the age gate, labels source notification + shown_via_reminder", async () => {
  const tree = await mount({ surface: "home" }); // nothing eligible organically
  expect(tree.toJSON()).toBeNull();

  // The reminder targets a 1h-old refinement — organically ineligible twice
  // over (age gate + refinement source); only the arrival admits it.
  sb.__enqueue("ride_feedback", null);
  sb.__enqueue(
    "setup_versions",
    versionRow({
      id: "v2",
      source: "refinement",
      version_number: 2,
      created_at: new Date(now - 1 * HOUR).toISOString(),
    })
  );
  sb.__enqueue("ride_feedback", null);
  sb.__enqueue("bikes", BIKE);

  await rtr.act(async () => {
    await reminderArrival.markReminderArrival("v2");
    await drain();
  });

  const calls = shownCalls("preride_shown");
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual({
    version_id: "v2",
    bike_id: "b1",
    surface: "home",
    shown_via_reminder: true,
    checkin_source: "notification",
  });
});

test("exactly-once: a remount in the same session never re-logs (module latch)", async () => {
  enqueueOutcomeScenario();
  const first = await mount({ surface: "home" });
  expect(shownCalls("checkin_shown")).toHaveLength(1);
  await rtr.act(async () => first.unmount());

  enqueueOutcomeScenario(); // same data offered again
  const second = await mount({ surface: "home" });

  expect(second.toJSON()).toBeNull();
  expect(shownCalls("checkin_shown")).toHaveLength(1);
});

test("session latch: <=1h background keeps it; >1h background re-offers and logs again", async () => {
  enqueueOutcomeScenario("fb1");
  const tree = await mount({ surface: "home" });
  expect(shownCalls("checkin_shown")).toHaveLength(1);

  // Dismiss so the slot is empty (fb1 is now snoozed/dismissed; fb2 is not).
  const dismiss = tree.root
    .findAll((n: any) => n.type === "Pressable")
    .find((n: any) => n.props.accessibilityLabel === "Dismiss check-in");
  await press(dismiss);
  expect(tree.toJSON()).toBeNull();

  enqueueOutcomeScenario("fb2", "v10");
  await warmResume(10 * 60 * 1000); // 10min: same session, latch holds
  expect(shownCalls("checkin_shown")).toHaveLength(1);

  await warmResume(2 * HOUR); // new session: latch resets
  const calls = shownCalls("checkin_shown");
  expect(calls).toHaveLength(2);
  expect(calls[1][1]).toEqual(
    expect.objectContaining({ feedback_id: "fb2", checkin_source: "warm_resume" })
  );
});

test("first-ride CTA threads checkinSource into the /tune-feedback params", async () => {
  enqueueFirstRideScenario();
  const tree = await mount({ surface: "home" });

  await press(pressableWithText(tree, "Give feedback"));

  expect(mockPush).toHaveBeenCalledTimes(1);
  const arg = mockPush.mock.calls[0][0];
  expect(arg.pathname).toBe("/tune-feedback");
  expect(arg.params.versionId).toBe("v1");
  expect(arg.params.checkinSource).toBe("home_mount");
});

test("outcome answer: records outcome, logs checkin_answered, threads checkinSource", async () => {
  enqueueOutcomeScenario();
  const tree = await mount({ surface: "home" });

  await press(pressableWithText(tree, "Better"));

  expect(setupVersions.updateFeedbackOutcome).toHaveBeenCalledWith(
    "fb1",
    "improved"
  );
  expect(rideReminder.cancelRideReminderForVersion).toHaveBeenCalledWith("v9");
  const answered = shownCalls("checkin_answered");
  expect(answered).toHaveLength(1);
  expect(answered[0][1]).toEqual({
    feedback_id: "fb1",
    outcome: "improved",
    surface: "home",
  });

  expect(mockPush).toHaveBeenCalledTimes(1);
  const arg = mockPush.mock.calls[0][0];
  expect(arg.pathname).toBe("/tune-feedback");
  expect(arg.params.versionId).toBe("v9");
  expect(arg.params.checkinSource).toBe("home_mount");
});
