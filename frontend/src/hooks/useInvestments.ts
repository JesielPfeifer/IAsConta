import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAutoRefresh } from './useAutoRefresh';

export interface Investment {
  id: string;
  type: 'RESERVA' | 'RENDA_FIXA' | 'RENDA_VARIAVEL';
  amount: number;
  month: string;
  date: string | null;
  createdAt: string;
}

export interface ByType {
  RESERVA: number;
  RENDA_FIXA: number;
  RENDA_VARIAVEL: number;
  total: number;
}

export interface MonthRow {
  month: string;
  RESERVA: number;
  RENDA_FIXA: number;
  RENDA_VARIAVEL: number;
  total: number;
}

export interface InvestmentsData {
  investments: Investment[];
  byType: ByType;
  byMonth: MonthRow[];
}

export function useInvestments(month?: string) {
  const [data, setData] = useState<InvestmentsData>({
    investments: [],
    byType: { RESERVA: 0, RENDA_FIXA: 0, RENDA_VARIAVEL: 0, total: 0 },
    byMonth: [],
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = month ? `?month=${encodeURIComponent(month)}` : '';
      const result = await api(`/api/investments${params}`);
      setData({
        investments: result.investments || [],
        byType: result.byType || { RESERVA: 0, RENDA_FIXA: 0, RENDA_VARIAVEL: 0, total: 0 },
        byMonth: result.byMonth || [],
      });
    } finally {
      setLoading(false);
    }
  }, [month]);

  useAutoRefresh(refresh, [month]);

  const create = async (invData: { type: string; amount: number; month: string; date?: string }) => {
    await api('/api/investments', {
      method: 'POST',
      body: JSON.stringify(invData),
    });
    await refresh();
  };

  const update = async (id: string, invData: Partial<Investment>) => {
    await api(`/api/investments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(invData),
    });
    await refresh();
  };

  const remove = async (id: string) => {
    await api(`/api/investments/${id}`, { method: 'DELETE' });
    await refresh();
  };

  return { ...data, loading, create, update, remove, refresh };
}
