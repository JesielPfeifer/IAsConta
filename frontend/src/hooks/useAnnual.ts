import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export interface MonthData {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

export interface AnnualData {
  months: MonthData[];
  totals: {
    income: number;
    expense: number;
    balance: number;
  };
  avgPerMonth: {
    income: number;
    expense: number;
  };
}

export function useAnnual(year?: number) {
  const [data, setData] = useState<AnnualData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = year ? `?year=${year}` : '';
      const result = await api(`/api/annual${params}`);
      setData(result);
    } catch (err) {
      console.error('Failed to fetch annual data:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}
