import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAutoRefresh } from './useAutoRefresh';

export interface GoalMonth {
  id: string;
  goalId: string;
  month: string;
  amount: number;
}

export interface Goal {
  id: string;
  name: string;
  totalAmount: number;
  targetDate: string | null;
  savedAmount: number;
  months: GoalMonth[];
  createdAt: string;
}

export function useGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/goals');
      setGoals(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefresh(refresh, []);

  const create = async (data: { name: string; totalAmount: number; targetDate?: string | null }) => {
    await api('/api/goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refresh();
  };

  const update = async (id: string, data: Partial<Goal>) => {
    await api(`/api/goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await refresh();
  };

  const remove = async (id: string) => {
    await api(`/api/goals/${id}`, { method: 'DELETE' });
    await refresh();
  };

  const upsertMonth = async (goalId: string, month: string, amount: number) => {
    await api(`/api/goals/${goalId}/months`, {
      method: 'POST',
      body: JSON.stringify({ month, amount }),
    });
    await refresh();
  };

  return { goals, loading, create, update, remove, upsertMonth, refresh };
}
