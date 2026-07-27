// __tests__/noDynamicRequire.test.ts
// Bundler-constraint guard: Metro resolves require()/import() at BUNDLE time
// and rejects non-literal arguments with "Invalid call: require(name)" — an
// app-boot crash that jest and the native build both sail past, because
// neither goes through Metro (shipped 2026-07-28: lib/socialAuth.ts's
// loadModule(name) helper bricked the dev client's first launch exactly
// this way). This test statically scans every Metro-bundled source file and
// fails on any require(/import( whose first argument is not a string
// literal, so the next dynamic-require helper dies in CI instead of on a
// phone.

import * as fs from "fs";
import * as path from "path";

// Directories Metro actually bundles — __tests__ and config files excluded.
const SHIPPED_DIRS = ["app", "lib", "components", "hooks", "constants", "theme"];

// First non-space char after the paren must open a string literal.
// Negative lookbehind keeps jest.requireActual / customRequire( etc. out.
const DYNAMIC_CALL = /(?<![.\w])(require|import)\(\s*[^\s"'`)]/;

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

test("no dynamic require()/import() in Metro-bundled source", () => {
  const root = path.join(__dirname, "..");
  const offenders: string[] = [];

  for (const dir of SHIPPED_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        if (DYNAMIC_CALL.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}: ${trimmed.slice(0, 120)}`);
        }
      });
    }
  }

  expect(offenders).toEqual([]);
});
