import { CompanyAdmin, CompanyAdminListResponse, COMPANY_ADMIN_STATUSES } from '../../../data/interfaces/company-admin';

function normalizeStatus(value: unknown): CompanyAdmin['status'] {
  const s = String(value ?? '').toLowerCase();
  return (COMPANY_ADMIN_STATUSES as readonly string[]).includes(s) ? (s as CompanyAdmin['status']) : 'active';
}

export function digitsOnlyPhone(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function mapCompanyAdminRow(raw: Record<string, unknown>): CompanyAdmin {
  const contact = raw['contactInfo'] as { email?: string; phone?: string } | undefined;
  const phoneSource = String(contact?.phone ?? raw['phone'] ?? '');
  return {
    id: Number(raw['id']),
    fullName: String(raw['fullName'] ?? ''),
    email: String(contact?.email ?? raw['email'] ?? ''),
    phone: digitsOnlyPhone(phoneSource) || phoneSource.trim(),
    status: normalizeStatus(raw['status']),
    companyId: Number(raw['companyId'] ?? ''),
    companyName: String(raw['companyName'] ?? ''),
  };
}

export function normalizeCompanyAdminList(res: CompanyAdminListResponse): CompanyAdmin[] {
  const raw = res.companyAdmins ?? res.admins ?? [];
  return raw.map((item) => mapCompanyAdminRow(item as Record<string, unknown>));
}
