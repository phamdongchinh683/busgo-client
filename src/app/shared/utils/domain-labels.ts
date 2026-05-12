export function userStatusLabel(value: string): string {
  switch (value) {
    case 'active':
      return 'Hoạt động';
    case 'inactive':
      return 'Tạm ngưng';
    case 'banned':
      return 'Bị cấm';
    default:
      return value;
  }
}

export function userRoleLabel(value: string): string {
  switch (value) {
    case 'driver':
      return 'Tài xế';
    case 'customer':
      return 'Khách hàng';
    case 'operator':
      return 'Nhà xe';
    default:
      return value;
  }
}

export function bookingStatusLabel(value: string): string {
  switch (value) {
    case 'pending':
      return 'Chờ xử lý';
    case 'paid':
      return 'Đã thanh toán';
    case 'cancelled':
      return 'Đã hủy';
    case 'expired':
      return 'Hết hạn';
    case 'success':
      return 'Thành công';
    case 'failed':
      return 'Thất bại';
    case 'refunded':
      return 'Đã hoàn tiền';
    default:
      return userStatusLabel(value);
  }
}

export function paymentMethodLabel(value: string): string {
  switch (value) {
    case 'cash':
      return 'Tiền mặt';
    case 'vnpay':
      return 'VNPay';
    case 'stripe':
      return 'Stripe';
    default:
      return value;
  }
}

export function payoutStatusLabel(value: string): string {
  switch ((value || '').toLowerCase()) {
    case 'paid':
      return 'Đã chuyển';
    case 'pending':
      return 'Đang chờ';
    case 'in_transit':
      return 'Đang xử lý';
    case 'failed':
      return 'Thất bại';
    case 'canceled':
      return 'Đã hủy';
    default:
      return value || 'Không rõ';
  }
}

export function staffProfileRoleLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'super_admin':
      return 'Quản trị viên';
    case 'company_admin':
      return 'Quản trị nhà xe';
    default:
      return userRoleLabel(normalized);
  }
}

export function localizeDashboardDatasetLabel(label: string): string {
  if (label.includes(' · ')) {
    return label
      .split(' · ')
      .map((part) => localizeDashboardDatasetLabel(part))
      .join(' · ');
  }

  switch (label) {
    case 'Users':
      return 'Người dùng';
    case 'Revenue':
      return 'Doanh thu';
    default:
      return bookingStatusLabel(userRoleLabel(paymentMethodLabel(label)));
  }
}
