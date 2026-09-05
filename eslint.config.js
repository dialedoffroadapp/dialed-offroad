// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions is Deno (npm:/jsr:/URL imports the Node resolver cannot
    // follow); .expo/types is generated. Both are out of scope for this lint.
    ignores: ['dist/*', 'supabase/functions/**', '.expo/**'],
  },
]);
