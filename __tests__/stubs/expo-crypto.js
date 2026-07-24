// Test stub for expo-crypto: deterministic nonce + transparent "digest" so
// tests can assert Apple received sha256(rawNonce) while Supabase received
// the raw nonce.
module.exports = {
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  randomUUID: () => "raw-nonce-uuid",
  digestStringAsync: async (_algorithm, input) => `sha256:${input}`,
};
