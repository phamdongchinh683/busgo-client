export type CompanyAdminStatus = 'active' | 'inactive' | 'banned';

export interface CompanyAdmin {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  status: CompanyAdminStatus;
  companyId: number;
  companyName: string;
}

export interface CompanyAdminListResponse {
  companyAdmins?: unknown[];
  admins?: unknown[];
  next: number | null;
}

export interface CreateCompanyAdminBody {
  fullName: string;
  contactInfo: { email: string; phone: string };
  password: string;
  companyId: number;
}

export interface UpdateCompanyAdminBody {
  fullName: string;
  email: string;
  phone: string;
  status: CompanyAdminStatus;
}

export const COMPANY_ADMIN_STATUSES: CompanyAdminStatus[] = ['active', 'inactive', 'banned'];
