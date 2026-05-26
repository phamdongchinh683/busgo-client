export type UserStatus = 'active' | 'inactive' | 'banned';
export type UserRole = 'driver' | 'customer' | 'operator';
export type StaffProfileRole = 'company_admin' | 'dispatcher' | 'support' | string;

export interface User {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  status: UserStatus;
  role: UserRole;
  staffProfileRole?: StaffProfileRole | null;
  password: string;
}

export interface UserListResponse {
  users: User[];
  next: number | null;
}

export interface CreateUserBody {
  fullName: string;
  email: string;
  phone: string;
  status: UserStatus;
  password: string;
  role: UserRole;
}

export interface CreateUserResponse {
  message: string;
  user: Omit<User, 'password'>;
}

export interface UpdateUserBody {
  fullName: string;
  email: string;
  phone: string;
  status: UserStatus;
  role?: UserRole;
}

export interface UpdateUserResponse {
  user: Omit<User, 'password'>;
}

export interface UpdateUserPasswordResponse {
  message: string;
  password: string;
}

export interface DeleteUserResponse {
  message: string;
  user: Omit<User, 'password'>;
}

export const USER_STATUSES: UserStatus[] = ['active', 'inactive', 'banned'];
export const USER_ROLES: UserRole[] = ['driver', 'customer', 'operator'];
