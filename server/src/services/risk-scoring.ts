import { env } from '../config/env.js';

// ─── Risk scoring constants v2 (regression-derived weights) ─────────────────

// Legacy flat weight (for old_score backward compatibility)
const DELAY_DOMAIN_POINTS = 5;

// v2 domain-specific weights from logistic regression
const DELAY_DOMAIN_WEIGHTS: Record<string, number> = {
  gmDelay: 7,
  fmDelay: 7,
  lcDelay: 8, // Language/Communication — strongest predictor
  cogDelay: 6,
  seDelay: 5,
};

const AUTISM_RISK_POINTS: Record<string, number> = {
  High: 15,
  Moderate: 8,
  Low: 0,
};

// v2 reduced ADHD weights (from validation analysis)
const ADHD_RISK_POINTS_V1: Record<string, number> = { High: 8, Moderate: 4, Low: 0 };
const ADHD_RISK_POINTS_V2: Record<string, number> = { High: 5, Moderate: 3, Low: 0 };

// v2 reduced behavioral weights
const BEHAVIORAL_RISK_POINTS_V1: Record<string, number> = { High: 7, Moderate: 3, Low: 0 };
const BEHAVIORAL_RISK_POINTS_V2: Record<string, number> = { High: 5, Moderate: 2, Low: 0 };

// Legacy thresholds (for old_score)
const RISK_THRESHOLDS = { Low: 10, Medium: 25 } as const;
// v2 recalibrated thresholds
const RISK_THRESHOLDS_V2 = { Low: 12, Medium: 32 } as const;

// v2 environmental risk add-ons
const ENV_RISK_HOME_STIMULATION_THRESHOLD = 2;
const ENV_RISK_HOME_STIMULATION_POINTS = 3;
const ENV_RISK_PARENT_MENTAL_HEALTH_THRESHOLD = 2;
const ENV_RISK_PARENT_MENTAL_HEALTH_POINTS = 2;
const ENV_RISK_LOW_CAREGIVER_ENGAGEMENT_POINTS = 2;
const ENV_RISK_INADEQUATE_LANGUAGE_EXPOSURE_POINTS = 2;

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ContributingDomain {
  domain: string;
  points: number;
  reason: string;
}

export interface RiskScoreResult {
  riskScore: number;
  riskCategory: 'Low' | 'Medium' | 'High';
  oldScore: number;
  oldCategory: 'Low' | 'Medium' | 'High';
  confidence: number;
  contributingDomains: ContributingDomain[];
  numDelays: number;
  formulaVersion: 'v1_original' | 'v2_recalibrated';
  activeFormula: 'v1' | 'v2';
}

export interface AssessmentData {
  gmDelay: number;
  fmDelay: number;
  lcDelay: number;
  cogDelay: number;
  seDelay: number;
  numDelays: number;
  autismRisk: string | null;
  adhdRisk: string | null;
  behaviorRisk: string | null;
  nutritionScore: number;
  gmDq: number | null;
  fmDq: number | null;
  lcDq: number | null;
  cogDq: number | null;
  seDq: number | null;
  compositeDq: number | null;
  behaviourScore: number;
  // v2 environmental fields
  homeStimulationScore: number;
  parentMentalHealthScore: number;
  caregiverEngagement: string | null;
  languageExposure: string | null;
  // WHO z-score fields (computed externally and injected)
  waz: number | null;
  haz: number | null;
  whz: number | null;
  muacCm: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function categorize(
  score: number,
  thresholds: { Low: number; Medium: number }
): 'Low' | 'Medium' | 'High' {
  if (score <= thresholds.Low) return 'Low';
  if (score <= thresholds.Medium) return 'Medium';
  return 'High';
}

function applyOverrides(
  category: 'Low' | 'Medium' | 'High',
  data: AssessmentData,
  isV2: boolean
): 'Low' | 'Medium' | 'High' {
  let result = category;
  if (data.autismRisk === 'High' && result === 'Low') result = 'Medium';
  if (data.numDelays >= 3 && result === 'Low') result = 'Medium';
  if (data.compositeDq !== null && data.compositeDq > 0 && data.compositeDq < 60) result = 'High';
  // v2: WAZ < -3.0 → minimum Medium
  if (isV2 && data.waz !== null && data.waz < -3.0 && result === 'Low') result = 'Medium';
  return result;
}

// ─── Dual rule-based scoring (v2 + legacy) ──────────────────────────────────

export function computeRuleBasedScore(data: AssessmentData): RiskScoreResult {
  let oldScore = 0;
  let newScore = 0;
  const contributing: ContributingDomain[] = [];

  // Developmental delays
  const delayDomains: Array<{ field: keyof AssessmentData; label: string }> = [
    { field: 'gmDelay', label: 'Gross Motor' },
    { field: 'fmDelay', label: 'Fine Motor' },
    { field: 'lcDelay', label: 'Language/Communication' },
    { field: 'cogDelay', label: 'Cognitive' },
    { field: 'seDelay', label: 'Socio-Emotional' },
  ];

  for (const { field, label } of delayDomains) {
    if (data[field] === 1) {
      const oldPts = DELAY_DOMAIN_POINTS;
      const newPts = DELAY_DOMAIN_WEIGHTS[field] ?? DELAY_DOMAIN_POINTS;
      oldScore += oldPts;
      newScore += newPts;
      contributing.push({
        domain: label,
        points: newPts,
        reason: `Developmental delay detected (v2 weight: ${newPts})`,
      });
    }
  }

  // Autism risk (same for v1 and v2)
  const autismPts = AUTISM_RISK_POINTS[data.autismRisk ?? 'Low'] ?? 0;
  if (autismPts > 0) {
    oldScore += autismPts;
    newScore += autismPts;
    contributing.push({
      domain: 'Autism Risk',
      points: autismPts,
      reason: `Autism risk: ${data.autismRisk}`,
    });
  }

  // ADHD risk (v1 uses old weights, v2 uses reduced weights)
  const adhdPtsV1 = ADHD_RISK_POINTS_V1[data.adhdRisk ?? 'Low'] ?? 0;
  const adhdPtsV2 = ADHD_RISK_POINTS_V2[data.adhdRisk ?? 'Low'] ?? 0;
  if (adhdPtsV1 > 0) oldScore += adhdPtsV1;
  if (adhdPtsV2 > 0) {
    newScore += adhdPtsV2;
    contributing.push({
      domain: 'ADHD Risk',
      points: adhdPtsV2,
      reason: `ADHD risk: ${data.adhdRisk}`,
    });
  }

  // Behavioral risk (v1 uses old weights, v2 uses reduced weights)
  const behPtsV1 = BEHAVIORAL_RISK_POINTS_V1[data.behaviorRisk ?? 'Low'] ?? 0;
  const behPtsV2 = BEHAVIORAL_RISK_POINTS_V2[data.behaviorRisk ?? 'Low'] ?? 0;
  if (behPtsV1 > 0) oldScore += behPtsV1;
  if (behPtsV2 > 0) {
    newScore += behPtsV2;
    contributing.push({
      domain: 'Behavioral',
      points: behPtsV2,
      reason: `Behavior risk: ${data.behaviorRisk}`,
    });
  }

  // Nutrition (old formula: integer threshold)
  if (data.nutritionScore >= 4) {
    oldScore += 3;
  }

  // v2: WHO-based nutrition thresholds (replace integer nutrition_score)
  if (data.waz !== null) {
    if (data.waz < -3.0) {
      newScore += 5;
      contributing.push({ domain: 'WHO Nutrition', points: 5, reason: `Severely underweight (WAZ=${data.waz.toFixed(2)})` });
    } else if (data.waz < -2.0) {
      newScore += 3;
      contributing.push({ domain: 'WHO Nutrition', points: 3, reason: `Underweight (WAZ=${data.waz.toFixed(2)})` });
    }
  }
  if (data.whz !== null && data.whz < -2.0) {
    newScore += 3;
    contributing.push({ domain: 'WHO Nutrition', points: 3, reason: `Wasted (WHZ=${data.whz.toFixed(2)})` });
  }
  if (data.haz !== null && data.haz < -2.0) {
    newScore += 2;
    contributing.push({ domain: 'WHO Nutrition', points: 2, reason: `Stunted (HAZ=${data.haz.toFixed(2)})` });
  }
  if (data.muacCm !== null && data.muacCm < 11.5) {
    newScore += 3;
    contributing.push({ domain: 'WHO Nutrition', points: 3, reason: `Acute malnutrition (MUAC=${data.muacCm}cm)` });
  }
  // Fallback: if no WHO z-scores, use old nutrition_score for v2 too
  if (data.waz === null && data.whz === null && data.haz === null && data.nutritionScore >= 4) {
    newScore += 3;
    contributing.push({ domain: 'Nutrition', points: 3, reason: `Nutrition score: ${data.nutritionScore} (pre-WHO)` });
  }

  // v2 environmental risk factors (new_score only)
  if (data.homeStimulationScore <= ENV_RISK_HOME_STIMULATION_THRESHOLD) {
    newScore += ENV_RISK_HOME_STIMULATION_POINTS;
    contributing.push({
      domain: 'Home Environment',
      points: ENV_RISK_HOME_STIMULATION_POINTS,
      reason: `Low home stimulation score: ${data.homeStimulationScore}`,
    });
  }

  if (data.parentMentalHealthScore <= ENV_RISK_PARENT_MENTAL_HEALTH_THRESHOLD) {
    newScore += ENV_RISK_PARENT_MENTAL_HEALTH_POINTS;
    contributing.push({
      domain: 'Parent Mental Health',
      points: ENV_RISK_PARENT_MENTAL_HEALTH_POINTS,
      reason: `Low parent mental health score: ${data.parentMentalHealthScore}`,
    });
  }

  if (data.caregiverEngagement === 'Low') {
    newScore += ENV_RISK_LOW_CAREGIVER_ENGAGEMENT_POINTS;
    contributing.push({
      domain: 'Caregiver Engagement',
      points: ENV_RISK_LOW_CAREGIVER_ENGAGEMENT_POINTS,
      reason: 'Low caregiver engagement',
    });
  }

  if (data.languageExposure === 'Inadequate') {
    newScore += ENV_RISK_INADEQUATE_LANGUAGE_EXPOSURE_POINTS;
    contributing.push({
      domain: 'Language Exposure',
      points: ENV_RISK_INADEQUATE_LANGUAGE_EXPOSURE_POINTS,
      reason: 'Inadequate language exposure',
    });
  }

  // Categorize with respective thresholds
  const oldCategory = applyOverrides(categorize(oldScore, RISK_THRESHOLDS), data, false);
  const newCategory = applyOverrides(categorize(newScore, RISK_THRESHOLDS_V2), data, true);

  // Confidence — placeholder until calibrated model (Task 3) replaces it
  const dqValues = [data.gmDq, data.fmDq, data.lcDq, data.cogDq, data.seDq];
  const otherValues = [data.behaviourScore, data.nutritionScore];
  const allValues = [...dqValues, ...otherValues];
  const fieldsFilled = allValues.filter((v) => v !== null && v !== 0).length;
  const completeness = fieldsFilled / 7;
  const confidence = Math.min(98, Math.round((70 + completeness * 25 + (newScore / 50) * 5) * 10) / 10);

  return {
    riskScore: newScore,
    riskCategory: newCategory,
    oldScore,
    oldCategory,
    confidence,
    contributingDomains: contributing,
    numDelays: data.numDelays,
    formulaVersion: 'v2_recalibrated',
    activeFormula: 'v1', // v1 during transition, flip to v2 after 90 days
  };
}

// ─── ML Engine call (Phase 2 — calibrated model) ───────────────────────────

export interface MLPrediction {
  riskScore: number;
  riskCategory: 'Low' | 'Medium' | 'High';
  confidence: number;
  calibratedProbabilities?: { Low: number; Medium: number; High: number };
}

export async function callMLEngine(features: Record<string, unknown>): Promise<MLPrediction | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(env.RISK_ENGINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`ML engine returned ${response.status}: ${response.statusText}`);
      return null;
    }

    const result = (await response.json()) as MLPrediction;
    // Hard cap: never show confidence > 98%
    if (result.confidence > 98) result.confidence = 98;
    return result;
  } catch (err) {
    console.warn('ML engine unavailable, using rule-based scoring only:', (err as Error).message);
    return null;
  }
}

// ─── Hybrid scoring ─────────────────────────────────────────────────────────────

export function computeHybridScore(
  ruleScore: number,
  mlScore: number,
  alpha: number = 0.7
): { hybridScore: number; riskCategory: 'Low' | 'Medium' | 'High' } {
  const hybridScore = Math.round((alpha * ruleScore + (1 - alpha) * mlScore) * 100) / 100;

  let riskCategory: 'Low' | 'Medium' | 'High';
  if (hybridScore <= RISK_THRESHOLDS_V2.Low) {
    riskCategory = 'Low';
  } else if (hybridScore <= RISK_THRESHOLDS_V2.Medium) {
    riskCategory = 'Medium';
  } else {
    riskCategory = 'High';
  }

  return { hybridScore, riskCategory };
}

// ─── Confidence band classification ─────────────────────────────────────────

export function getConfidenceBand(confidence: number): 'Low' | 'Moderate' | 'High' {
  if (confidence < 70) return 'Low';
  if (confidence < 85) return 'Moderate';
  return 'High';
}

export function getConfidenceNote(confidence: number): string {
  if (confidence >= 85) return '';
  if (confidence >= 70) return 'Moderate confidence';
  return 'Low confidence — incomplete data';
}
