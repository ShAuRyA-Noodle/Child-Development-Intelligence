import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(import.meta.dirname, '..', '..', '.env') });

const NODE_ENV = process.env.NODE_ENV ?? 'development';

// JWT_SECRET is the single root of trust for every authenticated request.
// A hardcoded fallback used to live here; that meant any deploy that forgot
// to set the env var inherited the same publicly-visible value and every
// attacker could forge tokens. We now hard-fail unless either:
//   * JWT_SECRET is explicitly set, or
//   * we're running locally (NODE_ENV !== 'production') AND the dev fallback
//     has been opted-in via ALLOW_DEV_JWT_FALLBACK=1.
const rawJwt = process.env.JWT_SECRET?.trim();
let JWT_SECRET: string;
if (rawJwt && rawJwt.length >= 32) {
  JWT_SECRET = rawJwt;
} else if (
  NODE_ENV !== 'production' &&
  process.env.ALLOW_DEV_JWT_FALLBACK === '1'
) {
  JWT_SECRET = 'dev-secret-change-in-production';
} else {
  throw new Error(
    'JWT_SECRET environment variable is missing or shorter than 32 chars. ' +
      'Generate one with `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"` ' +
      'and export it before starting the server. For local-only work you may set ' +
      'ALLOW_DEV_JWT_FALLBACK=1 with NODE_ENV != production.'
  );
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/ecd_intelligence',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  JWT_SECRET,
  JWT_EXPIRY: process.env.JWT_EXPIRY ?? '15m',
  REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY ?? '7d',
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  NODE_ENV,
  RISK_ENGINE_URL: process.env.RISK_ENGINE_URL ?? 'http://localhost:8000/api/v1/predict',
  // Notification services
  FCM_PROJECT_ID: process.env.FCM_PROJECT_ID ?? '',
  FCM_SERVER_KEY: process.env.FCM_SERVER_KEY ?? '',
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID ?? '',
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN ?? '',
  SMS_GATEWAY_URL: process.env.SMS_GATEWAY_URL ?? '',
  SMS_AUTH_KEY: process.env.SMS_AUTH_KEY ?? '',
  SMS_FLOW_ID: process.env.SMS_FLOW_ID ?? '',
  SMS_SENDER_ID: process.env.SMS_SENDER_ID ?? 'ECDGOV',
  IVR_API_URL: process.env.IVR_API_URL ?? '',
  IVR_API_KEY: process.env.IVR_API_KEY ?? '',
  IVR_API_SECRET: process.env.IVR_API_SECRET ?? '',
  IVR_CALLER_ID: process.env.IVR_CALLER_ID ?? '',
  IVR_APP_ID: process.env.IVR_APP_ID ?? '',
} as const;
