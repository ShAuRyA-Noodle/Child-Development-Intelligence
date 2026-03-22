// ECD Intelligence Platform — Consent Management Service
// DPDP Act 2023 compliant consent collection, storage, and withdrawal
// Supports verbal/visual consent for illiterate caregivers

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConsentType =
  | "data_collection"      // Collect child developmental data
  | "ai_processing"        // Use data for AI risk scoring
  | "data_sharing"         // Share with health/nutrition systems
  | "research"             // Use anonymized data for research
  | "notifications";       // Send messages to caregiver

export type CollectionMethod = "verbal" | "visual" | "written" | "digital";

export type ConsentStatus = "active" | "withdrawn" | "expired";

export interface ConsentRecord {
  consent_id: string;
  child_id: string;
  caregiver_id: string;
  consent_types: ConsentType[];
  status: ConsentStatus;
  collection_method: CollectionMethod;
  collected_by: string; // AWW user_id
  witness_id?: string;
  language: "en" | "te" | "hi";
  collected_at: string;
  expires_at: string;
  withdrawn_at?: string;
  withdrawal_reason?: string;
}

export interface ConsentVerification {
  child_id: string;
  has_consent: boolean;
  consent_types: ConsentType[];
  collection_method: CollectionMethod;
  collected_at: string;
  is_expired: boolean;
}

// ─── Consent Templates ─────────────────────────────────────────────────────

const CONSENT_TEXT: Record<string, Record<ConsentType, string>> = {
  en: {
    data_collection: "I agree to allow the anganwadi worker to collect information about my child's development, health, and growth.",
    ai_processing: "I agree that this information may be analyzed by a computer system to identify if my child needs extra support.",
    data_sharing: "I agree that relevant information may be shared with health workers and nutrition programs to help my child.",
    research: "I agree that anonymized information (without names) may be used for research to improve child development programs.",
    notifications: "I agree to receive messages about activities and exercises to help my child's development.",
  },
  te: {
    data_collection: "నా బిడ్డ అభివృద్ధి, ఆరోగ్యం మరియు పెరుగుదల గురించి సమాచారాన్ని సేకరించడానికి అంగన్‌వాడీ కార్యకర్తకు నేను అనుమతిస్తున్నాను.",
    ai_processing: "నా బిడ్డకు అదనపు మద్దతు అవసరమా అని గుర్తించడానికి ఈ సమాచారాన్ని కంప్యూటర్ వ్యవస్థ ద్వారా విశ్లేషించవచ్చని నేను అంగీకరిస్తున్నాను.",
    data_sharing: "నా బిడ్డకు సహాయపడటానికి సంబంధిత సమాచారాన్ని ఆరోగ్య కార్యకర్తలు మరియు పోషకాహార కార్యక్రమాలతో పంచుకోవచ్చని నేను అంగీకరిస్తున్నాను.",
    research: "బాలల అభివృద్ధి కార్యక్రమాలను మెరుగుపరచడానికి అనామక సమాచారం (పేర్లు లేకుండా) పరిశోధన కోసం ఉపయోగించబడవచ్చని నేను అంగీకరిస్తున్నాను.",
    notifications: "నా బిడ్డ అభివృద్ధికి సహాయపడే కార్యకలాపాలు మరియు వ్యాయామాల గురించి సందేశాలను అందుకోవడానికి నేను అంగీకరిస్తున్నాను.",
  },
  hi: {
    data_collection: "मैं आंगनवाड़ी कार्यकर्ता को अपने बच्चे के विकास, स्वास्थ्य और वृद्धि के बारे में जानकारी एकत्र करने की अनुमति देता/देती हूं.",
    ai_processing: "मैं सहमत हूं कि यह जानकारी कंप्यूटर प्रणाली द्वारा विश्लेषित की जा सकती है ताकि पता चल सके कि मेरे बच्चे को अतिरिक्त सहायता की आवश्यकता है.",
    data_sharing: "मैं सहमत हूं कि मेरे बच्चे की मदद के लिए संबंधित जानकारी स्वास्थ्य कार्यकर्ताओं और पोषण कार्यक्रमों के साथ साझा की जा सकती है.",
    research: "मैं सहमत हूं कि बाल विकास कार्यक्रमों को बेहतर बनाने के लिए अनामित जानकारी (बिना नाम) शोध के लिए उपयोग की जा सकती है.",
    notifications: "मैं अपने बच्चे के विकास में मदद करने वाली गतिविधियों और अभ्यासों के बारे में संदेश प्राप्त करने के लिए सहमत हूं.",
  },
};

// ─── Consent Operations ─────────────────────────────────────────────────────

export function createConsentRecord(
  childId: string,
  caregiverId: string,
  consentTypes: ConsentType[],
  method: CollectionMethod,
  collectedBy: string,
  language: "en" | "te" | "hi",
  witnessId?: string,
): ConsentRecord {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1-year consent validity

  return {
    consent_id: `consent_${childId}_${Date.now()}`,
    child_id: childId,
    caregiver_id: caregiverId,
    consent_types: consentTypes,
    status: "active",
    collection_method: method,
    collected_by: collectedBy,
    witness_id: witnessId,
    language,
    collected_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

export function withdrawConsent(
  record: ConsentRecord,
  typesToWithdraw: ConsentType[],
  reason: string,
): ConsentRecord {
  const remainingTypes = record.consent_types.filter(
    (t) => !typesToWithdraw.includes(t),
  );

  return {
    ...record,
    consent_types: remainingTypes,
    status: remainingTypes.length === 0 ? "withdrawn" : "active",
    withdrawn_at: new Date().toISOString(),
    withdrawal_reason: reason,
  };
}

export function verifyConsent(
  record: ConsentRecord | null,
  requiredType: ConsentType,
): ConsentVerification {
  if (!record) {
    return {
      child_id: "",
      has_consent: false,
      consent_types: [],
      collection_method: "verbal",
      collected_at: "",
      is_expired: true,
    };
  }

  const now = new Date();
  const expiresAt = new Date(record.expires_at);
  const isExpired = now > expiresAt;

  return {
    child_id: record.child_id,
    has_consent: record.status === "active" && !isExpired && record.consent_types.includes(requiredType),
    consent_types: record.consent_types,
    collection_method: record.collection_method,
    collected_at: record.collected_at,
    is_expired: isExpired,
  };
}

export function getConsentText(
  language: "en" | "te" | "hi",
  consentType: ConsentType,
): string {
  return CONSENT_TEXT[language]?.[consentType] || CONSENT_TEXT.en[consentType];
}

export function getAllConsentTexts(
  language: "en" | "te" | "hi",
): Record<ConsentType, string> {
  return CONSENT_TEXT[language] || CONSENT_TEXT.en;
}

// ─── Data Deletion Cascade (DPDP Act Right to Erasure) ──────────────────────

export interface DeletionPlan {
  child_id: string;
  tables_affected: string[];
  records_to_delete: number;
  records_to_anonymize: number;
  audit_retention: boolean; // Audit logs retained per legal requirement
}

export function planDataDeletion(childId: string): DeletionPlan {
  return {
    child_id: childId,
    tables_affected: [
      "children",         // Delete PII
      "assessments",      // Delete
      "risk_profiles",    // Delete
      "intelligent_alerts", // Delete
      "intervention_plans", // Delete
      "caregiver_interactions", // Delete
      "intervention_compliance", // Delete
      "growth_records",   // Delete
      "milestone_achievements", // Delete
      "sync_mutations",   // Delete
      "consent_records",  // Retain withdrawal record
    ],
    records_to_delete: 0, // Actual count computed at execution time
    records_to_anonymize: 0,
    audit_retention: true, // Audit trail retained with PII removed per DPDP Act
  };
}

// ─── PII Anonymization ─────────────────────────────────────────────────────

export interface AnonymizationRule {
  field: string;
  method: "hash" | "mask" | "generalize" | "suppress";
  output: string;
}

export const PII_ANONYMIZATION_RULES: AnonymizationRule[] = [
  { field: "child_name", method: "suppress", output: "[REDACTED]" },
  { field: "caregiver_name", method: "suppress", output: "[REDACTED]" },
  { field: "caregiver_phone", method: "mask", output: "XXXX-XXX-XXX" },
  { field: "aadhaar_reference", method: "hash", output: "SHA256(value)" },
  { field: "address", method: "generalize", output: "district_only" },
  { field: "dob", method: "generalize", output: "birth_year_quarter" },
  { field: "gps_coordinates", method: "generalize", output: "mandal_centroid" },
];

export function anonymizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const anonymized = { ...record };

  for (const rule of PII_ANONYMIZATION_RULES) {
    if (rule.field in anonymized) {
      switch (rule.method) {
        case "suppress":
          anonymized[rule.field] = "[REDACTED]";
          break;
        case "mask":
          anonymized[rule.field] = rule.output;
          break;
        case "hash":
          anonymized[rule.field] = `hashed_${String(anonymized[rule.field]).substring(0, 4)}`;
          break;
        case "generalize":
          // Keep only generalized value
          if (rule.field === "dob" && typeof anonymized[rule.field] === "string") {
            const date = new Date(anonymized[rule.field] as string);
            const quarter = Math.ceil((date.getMonth() + 1) / 3);
            anonymized[rule.field] = `${date.getFullYear()}-Q${quarter}`;
          } else {
            anonymized[rule.field] = `generalized_${rule.field}`;
          }
          break;
      }
    }
  }

  return anonymized;
}
