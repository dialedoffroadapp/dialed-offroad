// lib/rideLiveActivity.ts
// Lock-screen presence for ride mode: iOS Live Activity (elapsed time + a
// "Log moto" deep link) and an Android foreground service with an ongoing
// notification (PROMPT §5). NEITHER native module is in the dev client yet
// — this adapter require-guards an optional module so the JS flow ships now
// and the native work (a widget-extension config plugin + a foreground
// service module, then a new dev-client / EAS build) drops in behind the
// same three calls. Every call is a no-op until then. This is NOT a
// notification: nothing here fires a push or a scheduled alert.
type Activity = {
  start(params: { startedAt: string; track: string | null; deepLink: string }): Promise<void>;
  update(params: { motos: number; values: string }): Promise<void>;
  end(): Promise<void>;
};

let impl: Activity | null = null;
try {
    const mod = require("../native/rideActivity");
  if (mod && typeof mod.start === "function") impl = mod as Activity;
} catch {
  impl = null;
}

export const liveActivityAvailable = (): boolean => impl !== null;

export async function startRideActivity(p: { startedAt: string; track: string | null }): Promise<void> {
  try {
    await impl?.start({ ...p, deepLink: "dialedoffroad://ride/log" });
  } catch {
    // never surface
  }
}
export async function updateRideActivity(p: { motos: number; values: string }): Promise<void> {
  try {
    await impl?.update(p);
  } catch {
    // never surface
  }
}
export async function endRideActivity(): Promise<void> {
  try {
    await impl?.end();
  } catch {
    // never surface
  }
}
