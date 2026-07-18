// constants/bike-catalog.ts
// Canonical make → model list. Single source of truth for BOTH the garage
// picker AND on-save canonicalization / model_id resolution (see lib/bikes.ts:
// normalizeBikeStrings / resolveModelId).
//
// Naming here is the CANONICAL spelling. On-save normalization maps
// case/space/hyphen variants of the SAME model onto these strings and never
// merges genuinely different models — KTM XC vs XC-W vs XC-F vs XCF-W are
// different bikes and stay distinct. Expand anytime; keep spellings canonical.

export const BIKE_CATALOG: Record<string, string[]> = {
  KTM: [
    // Minis
    "50 SX", "65 SX", "85 SX", "85 SX Big Wheel",
    // SX (2T MX)
    "125 SX", "150 SX", "250 SX", "300 SX",
    // SX-F (4T MX)
    "250 SX-F", "350 SX-F", "450 SX-F", "250 SX-F Factory", "450 SX-F Factory",
    // XC (2T cross-country)
    "125 XC", "250 XC", "300 XC",
    // XC-F (4T cross-country)
    "250 XC-F", "350 XC-F", "450 XC-F",
    // XC-W (2T off-road / enduro)
    "150 XC-W", "250 XC-W", "300 XC-W",
    // XCF-W (4T off-road / enduro)
    "250 XCF-W", "350 XCF-W", "500 XCF-W",
    // EXC (2T enduro)
    "250 EXC", "300 EXC", "300 EXC Hardenduro",
    // EXC-F (4T enduro)
    "250 EXC-F", "350 EXC-F", "450 EXC-F", "500 EXC-F",
  ],

  Husqvarna: [
    // Minis
    "TC 50", "TC 65", "TC 85", "TC 85 Big Wheel",
    // TC (2T MX)
    "TC 125", "TC 250",
    // FC (4T MX)
    "FC 250", "FC 350", "FC 450",
    // TX / FX (cross-country)
    "TX 300", "FX 350", "FX 450",
    // TE (2T enduro)
    "TE 150", "TE 250", "TE 300",
    // FE (4T enduro)
    "FE 250", "FE 350", "FE 450", "FE 501",
  ],

  GasGas: [
    // Minis
    "MC 50", "MC 65", "MC 85", "MC 85 Big Wheel",
    // MC (2T MX)
    "MC 125", "MC 250",
    // MC-F (4T MX)
    "MC 250F", "MC 350F", "MC 450F",
    // EX (cross-country)
    "EX 250", "EX 300", "EX 250F", "EX 350F", "EX 450F",
    // EC (enduro)
    "EC 250", "EC 300", "EC 250F", "EC 350F",
  ],

  Yamaha: [
    // Minis
    "YZ65", "YZ85", "YZ85LW", "YZ85 Big Wheel",
    // YZ (2T MX)
    "YZ125", "YZ250",
    // YZ-F (4T MX)
    "YZ250F", "YZ450F",
    // Cross-country
    "YZ125X", "YZ250X", "YZ250FX", "YZ450FX",
    // Enduro
    "WR250F", "WR450F",
  ],

  Honda: [
    // Minis
    "CRF110F", "CRF125F", "CRF125FB", "CRF150R", "CRF150RB",
    "CR80R", "CR85R", "CR85RB",
    // MX
    "CRF250R", "CRF450R", "CRF450RWE",
    // Off-road / Enduro
    "CRF250RX", "CRF450RX", "CRF450X", "CRF450RL",
  ],

  Kawasaki: [
    // Minis
    "KX65", "KX85", "KX85-II", "KX100",
    // MX
    "KX250", "KX450",
    // XC / Enduro
    "KX250X", "KX450X", "KLX450R",
  ],

  Suzuki: [
    // Minis
    "RM85", "RM85L",
    // MX
    "RM-Z250", "RM-Z450",
    // Off-road
    "RMX450Z",
  ],

  Beta: [
    "RR 2T 200", "RR 2T 250", "RR 2T 300",
    "RR 4T 350", "RR 4T 390", "RR 4T 430", "RR 4T 480",
    "RR Race 250", "RR Race 300",
    "XTrainer 250", "XTrainer 300",
  ],

  Sherco: [
    "SE 250 Factory", "SE 300 Factory",
    "SEF 250 Factory", "SEF 300 Factory", "SEF 450 Factory",
  ],

  "TM Racing": [
    "MX 125", "MX 250", "MX 250 4T", "MX 300 4T", "MX 450 4T",
    "EN 250", "EN 300", "EN 250 4T", "EN 300 4T", "EN 450 4T",
  ],

  Stark: ["Varg MX", "Varg EX", "Varg SM"],
};

// Brand order for the picker's make-selection list.
export const BIKE_BRANDS = Object.keys(BIKE_CATALOG);
