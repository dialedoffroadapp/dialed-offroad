// "Why this setup" (device pass finding 6, 2026-09-08): one text for the
// reveal and the setup sheet, the first two sentences visible, the rest
// behind "Read more". The deterministic one-liner stands in until richer
// engine text lands.

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'])/;

export function splitWhy(text: string, visible = 2): { lead: string; rest: string } {
  const sentences = text.trim().split(SENTENCE_SPLIT).filter(Boolean);
  return { lead: sentences.slice(0, visible).join(" "), rest: sentences.slice(visible).join(" ") };
}

const CLASS_WORD: Record<string, string> = { novice: "novice", c: "C-class", b: "B-class", a: "A-class" };

export function whyTextFor(p: {
  notes?: readonly string[] | null;
  weightLbs?: number | null;
  riderClass?: "novice" | "c" | "b" | "a" | null;
  skill?: "beginner" | "intermediate" | "pro" | null;
  terrain?: string | null;
}): string {
  const notes = (p.notes ?? []).map((n) => n.trim()).filter(Boolean);
  if (notes.length > 0) return notes.map((n) => (/[.!?]$/.test(n) ? n : `${n}.`)).join(" ");
  const who = [
    typeof p.weightLbs === "number" && Number.isFinite(p.weightLbs) ? `${Math.round(p.weightLbs)} lb` : null,
    p.riderClass ? CLASS_WORD[p.riderClass] : p.skill === "pro" ? "A-class" : p.skill === "beginner" ? "novice" : p.skill === "intermediate" ? "C-class" : null,
  ].filter(Boolean).join(" ");
  const where = p.terrain ? ` on ${p.terrain.toLowerCase()}` : "";
  const first = who ? `Built for a ${who} rider${where}.` : `Built from your weight, your riding, and what we know about this bike${where}.`;
  return `${first} Ride it, then tell us what it did.`;
}
