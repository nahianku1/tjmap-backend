import { config as loadEnv } from 'dotenv';
import { join } from 'path';

// Prefer this package's own .env, even when the shell exports PORT or DB_URL.
loadEnv({ path: join(__dirname, '..', '.env'), override: true });
loadEnv();

function normaliseDbUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    // libpq-only flags that node-postgres does not understand.
    url.searchParams.delete('channel_binding');
    return url.toString();
  } catch {
    return raw;
  }
}

function sameSite(): 'lax' | 'strict' | 'none' {
  const value = (process.env.COOKIE_SAME_SITE ?? '').trim().toLowerCase();
  if (value === 'none' || value === 'strict' || value === 'lax') return value;
  // A deployed frontend and API usually live on different sites (for example
  // fibreatlas.vercel.app and tjmap-backend.vercel.app), and a Lax cookie is
  // dropped on such cross-site responses. None + Secure is the only policy that
  // survives that, so it is the production default.
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
}

const parsedPort = Number(process.env.PORT);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 4000;

export const config = {
  port,
  dbUrl: normaliseDbUrl(process.env.DB_URL ?? ''),
  accessSecret: process.env.JWT_ACCESS_SECRET ?? 'isp-tj-dev-access-secret-change-me',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'isp-tj-dev-refresh-secret-change-me',
  accessTtlSeconds: Number(process.env.ACCESS_TTL_SECONDS ?? 900),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cookieSameSite: sameSite(),
  isProd: process.env.NODE_ENV === 'production',
  refreshCookieName: 'isp_tj_refresh',
  accessCookieName: 'isp_tj_access',
};
