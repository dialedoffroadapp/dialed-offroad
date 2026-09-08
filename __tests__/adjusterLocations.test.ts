// The walkthrough's WHERE copy per family (second report, 2026-09-07,
// sub-task 3): every card names the correct cap or leg. One assertion table
// per family so a rewrite that moves a clicker fails here first.
import { DRAFT_FORK_FAMILIES, forkFamilyFor, locationCopy, shockFamilyFor, type ForkFamily, type ShockFamily } from "../lib/adjusterLocations";

const forkCases: Record<ForkFamily, { comp: RegExp; reb: RegExp; air?: RegExp }> = {
  wp_xact_air: { comp: /^Right fork leg, top cap/, reb: /^Right fork leg, top cap/, air: /^Left fork leg, top cap/ },
  wp_aer_air: { comp: /^Right fork leg, top cap/, reb: /^Right fork leg, top cap/, air: /^Left fork leg, top cap/ },
  wp_xact_spring: { comp: /^Top cap of each leg/, reb: /^Bottom of each leg/ },
  wp_xplor: { comp: /^Left fork leg, top cap/, reb: /^Right fork leg, top cap/ },
  kyb_sss: { comp: /^Top cap of each fork leg/, reb: /^Bottom of each fork leg.*base bolt/ },
  kyb_psf2: { comp: /^DRAFT/, reb: /^DRAFT/, air: /^Both fork legs, top caps/ },
  showa_coil: { comp: /^Top cap of each leg/, reb: /^Bottom of each leg/ },
  showa_sff2: { comp: /^Left fork leg, top cap/, reb: /^Left fork leg, bottom/ },
  showa_sff_air_tac: { comp: /^Right fork leg, top cap/, reb: /^Right fork leg, bottom/, air: /^Left fork leg.*balance chamber valve is under the left lug/ },
  ohlins: { comp: /^Top cap of each leg, the center adjuster \(3 mm Allen\)/, reb: /^Top cap of each leg, the right-hand adjuster \(T25\)/ },
  sachs: { comp: /^Top cap of each leg/, reb: /^Top cap of each leg/ },
  generic: { comp: /top cap or in the axle lug/, reb: /opposite end/ },
};

test.each(Object.entries(forkCases) as [ForkFamily, (typeof forkCases)[ForkFamily]][])("fork family %s names the correct cap and leg", (family, want) => {
  expect(locationCopy("fork_comp", "12", "clicks", family, "generic").where).toMatch(want.comp);
  expect(locationCopy("fork_reb", "12", "clicks", family, "generic").where).toMatch(want.reb);
  if (want.air) expect(locationCopy("fork_air", "10.6", "bar", family, "generic").where).toMatch(want.air);
  expect(locationCopy("fork_comp", "12", "clicks", family, "generic").how).toMatch(/clockwise gently until it stops/);
});

const shockCases: Record<ShockFamily, { lsc: RegExp; hsc: RegExp; reb: RegExp }> = {
  wp_linkage: { lsc: /reservoir.*small slotted screw/i, hsc: /reservoir.*large hex knob/i, reb: /^Bottom of the shock.*clevis/ },
  wp_pds: { lsc: /reservoir.*small center screw/i, hsc: /reservoir.*large hex knob/i, reb: /^Bottom of the shock/ },
  kyb: { lsc: /^Top of the reservoir, the small center clicker/, hsc: /large outer hex knob/, reb: /clevis/ },
  showa: { lsc: /^On the reservoir, the small slotted screw/, hsc: /large hex knob/, reb: /^Bottom of the shock.*clevis/ },
  showa_bfrc: { lsc: /piggyback.*labeled Com.*turns/, hsc: /no high-speed compression adjuster/, reb: /piggyback.*labeled Ten.*Turns, not clicks/ },
  ohlins: { lsc: /^On the reservoir/, hsc: /TTX Flow DV/, reb: /^Bottom of the shock, the rebound knob/ },
  sachs: { lsc: /reservoir.*Clicks/, hsc: /reservoir.*Turns/, reb: /^Bottom of the shock.*Clicks/ },
  generic: { lsc: /reservoir/, hsc: /reservoir/, reb: /bottom of the shock/i },
};

test.each(Object.entries(shockCases) as [ShockFamily, (typeof shockCases)[ShockFamily]][])("shock family %s names the correct spot", (family, want) => {
  expect(locationCopy("shock_lsc", "12", "clicks", "generic", family).where).toMatch(want.lsc);
  expect(locationCopy("shock_hsc", "1.5", "turns", "generic", family).where).toMatch(want.hsc);
  expect(locationCopy("shock_reb", "14", "clicks", "generic", family).where).toMatch(want.reb);
});

test("the Honda Showa cluster side is year-conditional; BFRC HOW counts turns; families resolve from catalog strings", () => {
  expect(locationCopy("shock_lsc", "12", "clicks", "generic", "showa", { make: "Honda", year: 2023 }).where).toMatch(/right side of the bike/);
  expect(locationCopy("shock_lsc", "12", "clicks", "generic", "showa", { make: "Honda", year: 2019 }).where).toMatch(/left side of the bike/);
  expect(locationCopy("shock_lsc", "12", "clicks", "generic", "showa", { make: "Kawasaki", year: 2019 }).where).not.toMatch(/side of the bike/);
  expect(locationCopy("shock_lsc", "2.5", "turns", "generic", "showa_bfrc").how).toMatch(/Com adjuster.*2\.5 turns/);
  expect(locationCopy("shock_reb", "2.75", "turns", "generic", "showa_bfrc").how).toMatch(/Ten adjuster.*2\.75 turns/);
  expect(forkFamilyFor("Showa SFF-Air TAC")).toBe("showa_sff_air_tac");
  expect(forkFamilyFor("Showa SFF coil")).toBe("showa_sff2");
  expect(forkFamilyFor("Showa 49 coil")).toBe("showa_coil");
  expect(forkFamilyFor("KYB SSS 48 coil")).toBe("kyb_sss");
  expect(forkFamilyFor("KYB PSF-2 air")).toBe("kyb_psf2");
  expect(forkFamilyFor("Sachs ZF 48 coil")).toBe("sachs");
  expect(shockFamilyFor("Showa BFRC linkage")).toBe("showa_bfrc");
  expect(shockFamilyFor("Showa linkage")).toBe("showa");
  expect(shockFamilyFor("KYB linkage")).toBe("kyb");
  expect(DRAFT_FORK_FAMILIES).toEqual(["kyb_psf2", "generic"]);
});
