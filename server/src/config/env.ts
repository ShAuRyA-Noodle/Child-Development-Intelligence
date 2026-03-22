import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(import.meta.dirname, '..', '..', '.env') });

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/ecd_intelligence',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  JWT_EXPIRY: process.env.JWT_EXPIRY ?? '15m',
  REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY ?? '7d',
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
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
