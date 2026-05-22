export type RevenueExportTimeType = 'monthly' | 'yearly';

export type RevenueExportMethod = 'vnpay' | 'stripe' | 'cash';

export interface RevenueExportQuery {
  type: RevenueExportTimeType;
  year: number;
  method: RevenueExportMethod;
}
