// On-save bike string canonicalization: uppercase-known makes, canonical-case
// models against the catalog for case/space/hyphen variants of the SAME model,
// never merge across genuinely different models, pass unknowns through trimmed.

import { catalogHasModel, normalizeBikeStrings } from "../lib/bikes";

describe("normalizeBikeStrings — makes", () => {
  test("uppercases known brands regardless of case/spacing", () => {
    expect(normalizeBikeStrings("ktm", "300 EXC").make).toBe("KTM");
    expect(normalizeBikeStrings("Ktm", "300 EXC").make).toBe("KTM");
    expect(normalizeBikeStrings("gas gas", "MC 250").make).toBe("GasGas");
    expect(normalizeBikeStrings("tm racing", "MX 250").make).toBe("TM Racing");
  });

  test("unknown brand passes through collapsed, never guessed", () => {
    expect(normalizeBikeStrings("WeirdBrand", "Model X")).toEqual({
      make: "WeirdBrand",
      model: "Model X",
    });
  });
});

describe("normalizeBikeStrings — models", () => {
  test("canonical-cases case/space/hyphen variants of the SAME model", () => {
    expect(normalizeBikeStrings("KTM", "300 xcw").model).toBe("300 XC-W");
    expect(normalizeBikeStrings("KTM", "300xc").model).toBe("300 XC");
    expect(normalizeBikeStrings("ktm", "300 exc").model).toBe("300 EXC");
    expect(normalizeBikeStrings("KTM", "  250  sx-f  ").model).toBe("250 SX-F");
  });

  test("NEVER collapses genuinely different models (XC / XC-W / XC-F / XCF-W)", () => {
    expect(normalizeBikeStrings("KTM", "250 xc").model).toBe("250 XC");
    expect(normalizeBikeStrings("KTM", "250 xc-w").model).toBe("250 XC-W");
    expect(normalizeBikeStrings("KTM", "250 xc-f").model).toBe("250 XC-F");
    expect(normalizeBikeStrings("KTM", "250 xcf-w").model).toBe("250 XCF-W");
  });

  test("token-reordered input is NOT merged (only case/space/hyphen)", () => {
    // "Xcw 300" reorders tokens — a different transform than the spec allows.
    expect(normalizeBikeStrings("KTM", "Xcw 300").model).toBe("Xcw 300");
  });

  test("unrecognized model passes through trimmed/collapsed", () => {
    expect(normalizeBikeStrings("KTM", "  totally fake  999 ").model).toBe(
      "totally fake 999"
    );
  });
});

describe("catalogHasModel (drives bike_search_no_result suppression)", () => {
  test("true for catalog models incl. spacing/case/hyphen variants", () => {
    expect(catalogHasModel("KTM", "300 EXC")).toBe(true);
    expect(catalogHasModel("ktm", "300 xcw")).toBe(true); // → 300 XC-W exists
    expect(catalogHasModel("KTM", "300xc")).toBe(true);
  });

  test("false for gibberish, reordered tokens, or unknown make", () => {
    expect(catalogHasModel("KTM", "asdf")).toBe(false);
    expect(catalogHasModel("KTM", "Xcw 300")).toBe(false); // reordered
    expect(catalogHasModel("WeirdBrand", "300 XC")).toBe(false);
  });
});
