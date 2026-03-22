// ECD Intelligence Platform — Notification Service
// Multi-channel delivery: FCM Push, WhatsApp Business API, SMS, IVR
// Cascading fallback chain: WhatsApp → SMS → AWW verbal delivery

import { env } from "../config/env.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationChannel = "push" | "whatsapp" | "sms" | "ivr";
export type NotificationPriority = "P1" | "P2" | "P3";

export interface NotificationPayload {
  recipient_id: string;
  recipient_type: "aww" | "supervisor" | "cdpo" | "caregiver";
  phone?: string;
  device_token?: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  data?: Record<string, string>;
  language?: "en" | "te" | "hi";
  media_url?: string;
}

export interface DeliveryResult {
  channel: NotificationChannel;
  success: boolean;
  message_id?: string;
  error?: string;
  timestamp: string;
}

// ─── FCM Push Notification ──────────────────────────────────────────────────

async function sendPushNotification(payload: NotificationPayload): Promise<DeliveryResult> {
  const timestamp = new Date().toISOString();

  if (!payload.device_token) {
    return { channel: "push", success: false, error: "No device token", timestamp };
  }

  try {
    // Firebase Cloud Messaging HTTP v1 API
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID || "ecd-platform"}/messages:send`;

    const message = {
      message: {
        token: payload.device_token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: {
          ...payload.data,
          priority: payload.priority,
          click_action: "OPEN_ALERT",
        },
        android: {
          priority: payload.priority === "P1" ? "high" : "normal",
          notification: {
            channel_id: payload.priority === "P1" ? "ecd_critical" : "ecd_general",
            sound: payload.priority === "P1" ? "alarm.mp3" : "default",
            vibrate_timings: ["0.2s", "0.1s", "0.2s"],
          },
        },
      },
    };

    const response = await fetch(fcmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.FCM_SERVER_KEY || ""}`,
      },
      body: JSON.stringify(message),
    });

    if (response.ok) {
      const result = await response.json();
      return { channel: "push", success: true, message_id: result.name, timestamp };
    }

    const error = await response.text();
    return { channel: "push", success: false, error, timestamp };
  } catch (err) {
    return {
      channel: "push",
      success: false,
      error: err instanceof Error ? err.message : "FCM send failed",
      timestamp,
    };
  }
}

// ─── WhatsApp Business API ──────────────────────────────────────────────────

async function sendWhatsAppMessage(payload: NotificationPayload): Promise<DeliveryResult> {
  const timestamp = new Date().toISOString();

  if (!payload.phone) {
    return { channel: "whatsapp", success: false, error: "No phone number", timestamp };
  }

  try {
    // WhatsApp Business API (Meta Cloud API)
    const waUrl = `https://graph.facebook.com/v18.0/${env.WHATSAPP_PHONE_ID || ""}/messages`;

    const langMap: Record<string, string> = { en: "en", te: "te", hi: "hi" };
    const templateLang = langMap[payload.language || "en"] || "en";

    // Use template messages for caregiver activities
    const body = payload.recipient_type === "caregiver"
      ? {
          messaging_product: "whatsapp",
          to: payload.phone,
          type: "template",
          template: {
            name: "ecd_activity_reminder",
            language: { code: templateLang },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: payload.body }],
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: payload.phone,
          type: "text",
          text: { body: `*${payload.title}*\n\n${payload.body}` },
        };

    const response = await fetch(waUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.WHATSAPP_TOKEN || ""}`,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const result = await response.json();
      return {
        channel: "whatsapp",
        success: true,
        message_id: result.messages?.[0]?.id,
        timestamp,
      };
    }

    const error = await response.text();
    return { channel: "whatsapp", success: false, error, timestamp };
  } catch (err) {
    return {
      channel: "whatsapp",
      success: false,
      error: err instanceof Error ? err.message : "WhatsApp send failed",
      timestamp,
    };
  }
}

// ─── SMS (via gateway) ──────────────────────────────────────────────────────

async function sendSMS(payload: NotificationPayload): Promise<DeliveryResult> {
  const timestamp = new Date().toISOString();

  if (!payload.phone) {
    return { channel: "sms", success: false, error: "No phone number", timestamp };
  }

  try {
    // Generic SMS gateway (configurable: MSG91, Twilio, NIC SMS)
    const smsUrl = env.SMS_GATEWAY_URL || "https://api.msg91.com/api/v5/flow/";

    // Truncate to SMS limit (160 chars for GSM, ~70 for Unicode/vernacular)
    const isVernacular = payload.language === "te" || payload.language === "hi";
    const maxLen = isVernacular ? 65 : 155;
    const smsBody =
      payload.body.length > maxLen
        ? payload.body.substring(0, maxLen - 3) + "..."
        : payload.body;

    const response = await fetch(smsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: env.SMS_AUTH_KEY || "",
      },
      body: JSON.stringify({
        flow_id: env.SMS_FLOW_ID || "",
        sender: env.SMS_SENDER_ID || "ECDGOV",
        mobiles: payload.phone,
        message: `${payload.title}: ${smsBody}`,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      return { channel: "sms", success: true, message_id: result.request_id, timestamp };
    }

    const error = await response.text();
    return { channel: "sms", success: false, error, timestamp };
  } catch (err) {
    return {
      channel: "sms",
      success: false,
      error: err instanceof Error ? err.message : "SMS send failed",
      timestamp,
    };
  }
}

// ─── IVR (Interactive Voice Response) ───────────────────────────────────────

async function sendIVRCall(payload: NotificationPayload): Promise<DeliveryResult> {
  const timestamp = new Date().toISOString();

  if (!payload.phone) {
    return { channel: "ivr", success: false, error: "No phone number", timestamp };
  }

  try {
    // IVR provider (e.g., Exotel, Ozonetel)
    const ivrUrl = env.IVR_API_URL || "https://api.exotel.com/v1/calls";

    const response = await fetch(ivrUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${env.IVR_API_KEY || ""}:${env.IVR_API_SECRET || ""}`).toString("base64")}`,
      },
      body: JSON.stringify({
        from: env.IVR_CALLER_ID || "",
        to: payload.phone,
        call_type: "outbound",
        app_id: env.IVR_APP_ID || "",
        custom_field: payload.data?.alert_id || "",
        // TTS message in vernacular
        body: payload.body,
        language: payload.language || "en",
      }),
    });

    if (response.ok) {
      const result = await response.json();
      return { channel: "ivr", success: true, message_id: result.call_sid, timestamp };
    }

    const error = await response.text();
    return { channel: "ivr", success: false, error, timestamp };
  } catch (err) {
    return {
      channel: "ivr",
      success: false,
      error: err instanceof Error ? err.message : "IVR call failed",
      timestamp,
    };
  }
}

// ─── Cascading Delivery ─────────────────────────────────────────────────────

const channelHandlers: Record<NotificationChannel, (p: NotificationPayload) => Promise<DeliveryResult>> = {
  push: sendPushNotification,
  whatsapp: sendWhatsAppMessage,
  sms: sendSMS,
  ivr: sendIVRCall,
};

export async function sendNotification(payload: NotificationPayload): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  // For P1 critical alerts: send on ALL channels simultaneously
  if (payload.priority === "P1") {
    const deliveries = await Promise.allSettled(
      payload.channels.map((ch) => channelHandlers[ch](payload)),
    );

    for (const delivery of deliveries) {
      if (delivery.status === "fulfilled") {
        results.push(delivery.value);
      }
    }
    return results;
  }

  // For P2/P3: cascading fallback (try each channel in order, stop on first success)
  for (const channel of payload.channels) {
    const handler = channelHandlers[channel];
    if (!handler) continue;

    const result = await handler(payload);
    results.push(result);

    if (result.success) break; // Stop on first successful delivery
  }

  return results;
}

// ─── Notification Templates ─────────────────────────────────────────────────

export function buildAlertNotification(
  alert: {
    alert_id: string;
    child_id: string | null;
    severity: string;
    domain: string;
    message: string;
    suggested_action: string;
  },
  recipient: {
    id: string;
    type: "aww" | "supervisor" | "cdpo" | "caregiver";
    phone?: string;
    device_token?: string;
    language?: "en" | "te" | "hi";
  },
): NotificationPayload {
  const priority: NotificationPriority =
    alert.severity === "critical" ? "P1" : alert.severity === "high" ? "P2" : "P3";

  // Determine channels based on recipient type
  const channels: NotificationChannel[] =
    recipient.type === "caregiver"
      ? ["whatsapp", "sms", "ivr"] // Caregivers: WhatsApp → SMS → IVR
      : ["push", "whatsapp", "sms"]; // AWW/Supervisor: Push → WhatsApp → SMS

  return {
    recipient_id: recipient.id,
    recipient_type: recipient.type,
    phone: recipient.phone,
    device_token: recipient.device_token,
    title: `[${priority}] ${alert.domain} Alert`,
    body: alert.message,
    priority,
    channels,
    data: {
      alert_id: alert.alert_id,
      child_id: alert.child_id || "",
      action: alert.suggested_action,
    },
    language: recipient.language,
  };
}

export function buildCaregiverActivityReminder(
  childId: string,
  activityDescription: string,
  recipient: {
    id: string;
    phone?: string;
    language?: "en" | "te" | "hi";
  },
): NotificationPayload {
  return {
    recipient_id: recipient.id,
    recipient_type: "caregiver",
    phone: recipient.phone,
    title: "Activity Reminder",
    body: activityDescription,
    priority: "P3",
    channels: ["whatsapp", "sms"],
    data: { child_id: childId },
    language: recipient.language,
  };
}

export function buildDailySupervisorDigest(
  summary: {
    total_alerts: number;
    p1_count: number;
    p2_count: number;
    assessments_pending: number;
  },
  recipient: {
    id: string;
    phone?: string;
    device_token?: string;
    language?: "en" | "te" | "hi";
  },
): NotificationPayload {
  return {
    recipient_id: recipient.id,
    recipient_type: "supervisor",
    phone: recipient.phone,
    device_token: recipient.device_token,
    title: "Daily Summary",
    body: `Alerts: ${summary.total_alerts} (${summary.p1_count} critical). Assessments pending: ${summary.assessments_pending}`,
    priority: summary.p1_count > 0 ? "P1" : "P3",
    channels: ["push", "whatsapp"],
    data: {},
    language: recipient.language,
  };
}
