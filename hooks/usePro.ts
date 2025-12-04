// hooks/usePro.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomerInfo, Offerings, PurchasesPackage } from "react-native-purchases";
import {
    isPro as _isPro,
    getCustomerInfo,
    getOfferings,
    isWeb,
    purchasePackage,
    restorePurchases,
} from "../lib/purchases";

type UseProReturn = {
  loading: boolean;
  isPro: boolean;
  offering: Offerings | null;
  monthly?: PurchasesPackage | null;
  annual?: PurchasesPackage | null;
  refresh: () => Promise<void>;
  buy: (pkg: PurchasesPackage) => Promise<CustomerInfo | null>;
  restore: () => Promise<CustomerInfo | null>;
  customerInfo: CustomerInfo | null;
};

export default function usePro(): UseProReturn {
  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState<Offerings | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // On web, just clear and bail
      if (isWeb) {
        setOffering(null);
        setCustomerInfo(null);
        return;
      }
      const [o, ci] = await Promise.all([getOfferings(), getCustomerInfo()]);
      if (o) setOffering(o);
      if (ci) setCustomerInfo(ci);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Add a change listener (native only)
    if (isWeb) return;
    const remove = (require("react-native-purchases") as typeof import("react-native-purchases"))
      .default.addCustomerInfoUpdateListener((ci) => setCustomerInfo(ci));
    return () => {
      try {
        // older SDKs return void; newer return remover
        (remove as any)?.();
      } catch {}
    };
  }, [refresh]);

  const buy = useCallback(async (pkg: PurchasesPackage) => {
    if (isWeb) return null;
    const ci = await purchasePackage(pkg);
    if (ci) setCustomerInfo(ci);
    return ci;
  }, []);

  const restore = useCallback(async () => {
    if (isWeb) return null;
    const ci = await restorePurchases();
    if (ci) setCustomerInfo(ci);
    return ci;
  }, []);

  // pull common packages off the current offering
  const { monthly, annual } = useMemo(() => {
    const o: any = offering as any;
    return {
      monthly:
        o?.current?.availablePackages?.find((p: any) => p?.packageType === "MONTHLY") ??
        o?.current?.monthly ??
        null,
      annual:
        o?.current?.availablePackages?.find((p: any) => p?.packageType === "ANNUAL") ??
        o?.current?.annual ??
        null,
    };
  }, [offering]);

  return {
    loading,
    isPro: _isPro(customerInfo),
    offering,
    monthly,
    annual,
    buy,
    restore,
    refresh,
    customerInfo,
  };
}
