import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Intervalo de polling quando o sync automático (webhook) está ativo. */
export const PLUGGY_POLL_MS = 90_000;

interface PluggyStatus {
  autoSync: { registered: boolean; active: boolean; events: string[] } | null;
  connections?: { bank: string; lastSyncAt: string | null }[];
}

// Cache em memória (5 min): o /status consulta a Pluggy, então não pode ser
// chamado a cada montagem de tela.
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; status: PluggyStatus } | null = null;

export async function fetchPluggyStatus(force = false): Promise<PluggyStatus | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.status;
  try {
    const status = (await api('/api/pluggy/status')) as PluggyStatus;
    cache = { at: Date.now(), status };
    return status;
  } catch {
    return cache?.status ?? null;
  }
}

/** true quando o sync automático (webhook da Pluggy) está ativo. */
export function usePluggyAutoSync(): boolean {
  const [active, setActive] = useState<boolean>(cache?.status?.autoSync?.active ?? false);
  useEffect(() => {
    let alive = true;
    fetchPluggyStatus().then((s) => {
      if (alive) setActive(Boolean(s?.autoSync?.active));
    });
    return () => {
      alive = false;
    };
  }, []);
  return active;
}

/** Data/hora da sincronização mais recente entre as conexões. */
export function usePluggyLastSync(): string | null {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchPluggyStatus().then((s) => {
      if (!alive) return;
      const dates = (s?.connections ?? [])
        .map((c) => c.lastSyncAt)
        .filter((d): d is string => Boolean(d));
      if (dates.length) {
        setLast(dates.sort().reverse()[0]);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  return last;
}
