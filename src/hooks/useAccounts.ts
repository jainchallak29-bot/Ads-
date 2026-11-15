import { useEffect, useState } from 'react';

import { useApp } from '@/components/AppProvider';
import type { Broker, PlotAccount } from '@/lib/types';

/** Live payments/commission data (admins only; returns empty data otherwise). */
export function useAccounts(pid: string | undefined, enabled: boolean) {
  const { backend } = useApp();
  const [accounts, setAccounts] = useState<Record<string, PlotAccount>>({});
  const [brokers, setBrokers] = useState<Broker[]>([]);
  useEffect(() => {
    if (!pid || !enabled) return;
    const a = backend.watchAccounts(pid, setAccounts, () => undefined);
    const b = backend.watchBrokers(pid, setBrokers, () => undefined);
    return () => {
      a();
      b();
    };
  }, [backend, pid, enabled]);
  return { accounts: enabled ? accounts : {}, brokers: enabled ? brokers : [] };
}
