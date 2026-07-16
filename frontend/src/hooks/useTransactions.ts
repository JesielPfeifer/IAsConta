import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export interface Transaction {
  id: string;
  amount: number;
  description: string;
  type: 'EXPENSE' | 'INCOME';
  categoryId?: string;
  category?: { id: string; name: string };
  categoryName?: string;
  person?: string;
  date: string;
  isShared: boolean;
  source?: string;
  paymentMethod?: string;
  totalInstallments?: number;
  currentInstallment?: number;
  isFixed?: boolean;
}

interface Filters {
  month?: string;
  categoryId?: string;
  person?: string;
  type?: string;
  paymentMethod?: string;
}

function normalize(tx: any): Transaction {
  return {
    ...tx,
    categoryName: tx.category?.name || undefined,
  };
}

export function useTransactions(filters: Filters = {}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.month) params.set('month', filters.month);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.person) params.set('person', filters.person);
    if (filters.type) params.set('type', filters.type);
    if (filters.paymentMethod) params.set('paymentMethod', filters.paymentMethod);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [filters.month, filters.categoryId, filters.person, filters.type, filters.paymentMethod]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/api/transactions${buildQuery()}`);
      const list = Array.isArray(data) ? data : data.transactions || [];
      setTransactions(list.map(normalize));
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async (txData: Omit<Transaction, 'id' | 'categoryName'>) => {
    await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(txData),
    });
    await refresh();
  };

  const update = async (id: string, txData: Partial<Transaction>) => {
    await api(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(txData),
    });
    await refresh();
  };

  const remove = async (id: string) => {
    await api(`/api/transactions/${id}`, { method: 'DELETE' });
    await refresh();
  };

  return { transactions, loading, create, update, remove, refresh };
}
