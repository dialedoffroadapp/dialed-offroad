// Test stub for react-native-purchases (native SDK): only the surface
// lib/purchases.ts touches at call time; nothing runs at import.
const Purchases = {
  setLogLevel: () => {},
  configure: async () => {},
  logIn: async () => ({ customerInfo: null }),
  logOut: async () => {},
  getCustomerInfo: async () => null,
  invalidateCustomerInfoCache: async () => {},
  getOfferings: async () => null,
  purchasePackage: async () => ({ customerInfo: null }),
  restorePurchases: async () => null,
};
module.exports = {
  __esModule: true,
  default: Purchases,
  LOG_LEVEL: { DEBUG: "DEBUG", INFO: "INFO" },
};
