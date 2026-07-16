import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

interface Summary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  billsTotal: number;
  byPerson: {
    husband: { income: number; expense: number };
    wife: { income: number; expense: number };
  };
}

interface CategoryItem {
  category: string;
  total: number;
}

interface PercentageItem {
  person: string;
  expense: number;
  salary: number;
  percentage: number;
}

interface ComparisonData {
  current: { income: number; expense: number };
  previous: { income: number; expense: number };
  diffIncome: number;
  diffExpense: number;
  diffPercent: number;
}

interface YearAnalysisData {
  worstMonth: [string, number];
  bestMonth: [string, number];
  topCategory: [string, number];
  avgPerMonth: number;
  totalExpense: number;
  allMonths: [string, number][];
}

interface TipData {
  tip: string;
  topCategories: { name: string; total: number }[];
}

interface DashboardData {
  summary: Summary | null;
  byCategory: CategoryItem[];
  percentage: PercentageItem[];
  byPayment: { method: string; total: number }[];
  creditCardTotal: number;
}

export function useDashboard(month?: string) {
  const [data, setData] = useState<DashboardData>({
    summary: null,
    byCategory: [],
    percentage: [],
    byPayment: [],
    creditCardTotal: 0,
  });
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [yearAnalysis, setYearAnalysis] = useState<YearAnalysisData | null>(null);
  const [tip, setTip] = useState<TipData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = month ? `?month=${encodeURIComponent(month)}` : '';

      const [summary, byCategory, percentageRaw, byPayment, creditCardData, comparisonData, yearAnalysisData, tipData] = await Promise.all([
        api(`/api/dashboard/summary${params}`).catch(() => null),
        api(`/api/dashboard/by-category${params}`).catch(() => []),
        api(`/api/dashboard/percentage${params}`).catch(() => ({ husband: { expense: 0, salary: 0, percentage: 0 }, wife: { expense: 0, salary: 0, percentage: 0 } })),
        api(`/api/dashboard/by-payment${params}`).catch(() => []),
        api(`/api/dashboard/credit-card-total${params}`).catch(() => ({ total: 0 })),
        api(`/api/dashboard/comparison${params}`).catch(() => null),
        api('/api/dashboard/year-analysis').catch(() => null),
        api(`/api/dashboard/tip${params}`).catch(() => null),
      ]);

      const percentage: PercentageItem[] = [
        { person: 'husband', expense: percentageRaw?.husband?.expense ?? 0, salary: percentageRaw?.husband?.salary ?? 0, percentage: percentageRaw?.husband?.percentage ?? 0 },
        { person: 'wife', expense: percentageRaw?.wife?.expense ?? 0, salary: percentageRaw?.wife?.salary ?? 0, percentage: percentageRaw?.wife?.percentage ?? 0 },
      ];

      setData({ summary, byCategory, percentage, byPayment: byPayment || [], creditCardTotal: creditCardData?.total ?? 0 });
      setComparison(comparisonData);
      setYearAnalysis(yearAnalysisData);
      setTip(tipData);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...data, comparison, yearAnalysis, tip, loading, refresh };
}
