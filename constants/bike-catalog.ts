// constants/bike-catalog.ts
// Tunable-suspension models (MX + XC/EXC/Enduro). Expand anytime.

export const BIKE_CATALOG: Record<string, string[]> = {
  KTM: [
    // MX (AER forks on SX-F/SX 125-450 MY ~2016+)
    "125 SX", "150 SX",
    "250 SX", "300 SX",
    "250 SX-F", "350 SX-F", "450 SX-F",
    "250 SX-F Factory", "450 SX-F Factory",
    "250 XC-F", "350 XC-F", "450 XC-F",
    "125 XC", "250 XC", "300 XC",
    // Enduro (mostly XPLOR coil)
    "250 EXC-F", "350 EXC-F", "450 EXC-F", "500 EXC-F",
    "250 EXC", "300 EXC", "300 EXC Hardenduro",
    "250 XCF-W", "350 XCF-W", "500 XCF-W",
  ],

  Husqvarna: [
    // MX
    "TC 125", "TC 250",
    "FC 250", "FC 350", "FC 450",
    "FX 350", "FX 450",
    // Enduro
    "TE 150", "TE 250", "TE 300",
    "FE 250", "FE 350", "FE 450", "FE 501",
  ],

  GasGas: [
    // MX
    "MC 125", "MC 250",
    "MC 250F", "MC 350F", "MC 450F",
    "EX 250F", "EX 350F", "EX 450F",
    // Enduro
    "EC 250", "EC 300",
    "EC 250F", "EC 350F",
  ],

  Yamaha: [
    // MX
    "YZ125", "YZ250",
    "YZ250F", "YZ450F",
    // Cross-country / Enduro
    "YZ250X", "YZ125X",
    "WR250F", "WR450F",
    "YZ250FX", "YZ450FX",
  ],

  Honda: [
    // MX
    "CRF250R", "CRF450R", "CRF450RWE",
    // Off-road / Enduro
    "CRF250RX", "CRF450RX",
    "CRF450X", "CRF450RL",
  ],

  Kawasaki: [
    // MX
    "KX250", "KX450",
    // XC / Enduro
    "KX250X", "KX450X",
    // (Optional) KLX450R (older enduro coil)
  ],

  Suzuki: [
    // MX
    "RM-Z250", "RM-Z450",
    // Off-road (older)
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
    "MX 125", "MX 250",
    "MX 250 4T", "MX 300 4T", "MX 450 4T",
    "EN 250", "EN 300", "EN 250 4T", "EN 300 4T", "EN 450 4T",
  ],
};

// Optional brand order for UI
export const BIKE_BRANDS = Object.keys(BIKE_CATALOG);
