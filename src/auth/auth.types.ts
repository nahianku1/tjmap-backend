export type Role = 'user' | 'admin';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  mobile: string;
  password_hash: string;
  role: Role;
  created_at: Date;
  updated_at: Date;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: Role;
  createdAt: string;
}

export interface JwtUser {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

export interface AccessPayload extends JwtUser {
  type: 'access';
}

export interface RefreshPayload {
  sub: string;
  family: string;
  jti: string;
  type: 'refresh';
}
