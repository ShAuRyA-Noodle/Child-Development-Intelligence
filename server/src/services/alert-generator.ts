import { PrismaClient, SeverityLevel } from '@prisma/client';

const prisma = new PrismaClient();

const DQ_DELAY_THRESHOLD = 75;

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface AlertInput {
  childId: string;
  gmDq: number | null;
  fmDq: number | null;
  lcDq: number | null;
  cogDq: number | null;
  seDq: number | null;
  compositeDq: number | null;
  autismRisk: string | null;
  numDelays: number;
  nutritionScore: number;
  underweight: number;
  stunting: number;
  wasting: number;
}

export interface GeneratedAlert {
  childId: string | null;
  domain: string;
  indicator: string;
  severity: SeverityLevel;
  confidencePct: number;
  dqValue: number | null;
  message: string;
  suggestedAction: string;
}

// ─── Alert action lookup (ported from process_data.py) ──────────────────────

function getAlertAction(domain: string, severity: string): string {
  const actions: Record<string, Record<string, string>> = {
    Speech: {
      critical: 'Urgent speech therapy referral; daily structured speech stimulation; parent audio guidance',
      high: 'Speech assessment referral; 3x/week picture card narration; caregiver communication training',
      moderate: 'Monitor speech development; 2x/week story narration activities',
    },
    Motor: {
      critical: 'Physiotherapy referral; daily structured motor exercises; occupational therapy assessment',
      high: 'Motor development assessment; daily fine/gross motor activities; parent demonstration',
      moderate: 'Regular motor activities; play-based movement exercises 3x/week',
    },
    Cognitive: {
      critical: 'Specialist cognitive assessment; daily structured learning activities; parent guidance',
      high: 'Cognitive stimulation program; 3x/week problem-solving games; home activity kit',
      moderate: 'Pattern recognition games 2x/week; age-appropriate puzzles',
    },
    'Socio-emotional': {
      critical: 'Child psychologist referral; daily social interaction activities; caregiver counseling',
      high: 'Group play therapy; 3x/week emotion recognition exercises; parent support',
      moderate: 'Social play activities 2x/week; peer interaction monitoring',
    },
  };
  return actions[domain]?.[severity] ?? 'Regular monitoring and follow-up assessment';
}

// ─── Deduplication check ────────────────────────────────────────────────────────

async function isDuplicate(childId: string, domain: string, severity: SeverityLevel): Promise<boolean> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const existing = await prisma.intelligentAlert.findFirst({
    where: {
      childId,
      domain,
      severity,
      generatedAt: { gte: sevenDaysAgo },
    },
  });

  return existing !== null;
}

// ─── Main alert generation (ported from process_data.py lines 322-420) ──────

export async function generateAlerts(input: AlertInput): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];

  // Alert 1: Domain-specific DQ delays
  const domainChecks: Array<{ domain: string; dqKey: keyof AlertInput; label: string }> = [
    { domain: 'Speech', dqKey: 'lcDq', label: 'Language/Communication' },
    { domain: 'Motor', dqKey: 'gmDq', label: 'Gross Motor' },
    { domain: 'Motor', dqKey: 'fmDq', label: 'Fine Motor' },
    { domain: 'Cognitive', dqKey: 'cogDq', label: 'Cognitive' },
    { domain: 'Socio-emotional', dqKey: 'seDq', label: 'Socio-Emotional' },
  ];

  for (const { domain, dqKey, label } of domainChecks) {
    const dq = input[dqKey] as number | null;
    if (dq !== null && dq < DQ_DELAY_THRESHOLD && dq > 0) {
      let severity: SeverityLevel;
      if (dq < 60) {
        severity = 'critical';
      } else if (dq < 70) {
        severity = 'high';
      } else {
        severity = 'moderate';
      }

      const confidencePct = Math.min(97, Math.round((90 + (DQ_DELAY_THRESHOLD - dq) / 10) * 10) / 10);

      const dup = await isDuplicate(input.childId, domain, severity);
      if (!dup) {
        alerts.push({
          childId: input.childId,
          domain,
          indicator: label,
          severity,
          confidencePct: Math.round(confidencePct),
          dqValue: dq,
          message: `${label} DQ=${Math.round(dq)} (threshold: ${DQ_DELAY_THRESHOLD})`,
          suggestedAction: getAlertAction(domain, severity),
        });
      }
    }
  }

  // Alert 2: High autism risk -> critical alert
  if (input.autismRisk === 'High') {
    const dup = await isDuplicate(input.childId, 'Behavioral', 'critical');
    if (!dup) {
      alerts.push({
        childId: input.childId,
        domain: 'Behavioral',
        indicator: 'Autism Screening',
        severity: 'critical',
        confidencePct: 94,
        dqValue: null,
        message: 'High autism risk detected — requires specialist referral',
        suggestedAction: 'Priority referral to RBSK/DEIC for autism screening',
      });
    }
  }

  // Alert 3: Multiple delays (>=3) -> critical alert (global delay)
  if (input.numDelays >= 3) {
    const dup = await isDuplicate(input.childId, 'Multi-domain', 'critical');
    if (!dup) {
      alerts.push({
        childId: input.childId,
        domain: 'Multi-domain',
        indicator: 'Global Developmental Delay',
        severity: 'critical',
        confidencePct: 96,
        dqValue: input.compositeDq,
        message: `Global delay: ${input.numDelays} domains affected, Composite DQ=${input.compositeDq !== null ? Math.round(input.compositeDq) : 'N/A'}`,
        suggestedAction: 'Urgent multi-domain intervention + specialist referral',
      });
    }
  }

  // Alert 4: Severe malnutrition (nutrition_score >= 5) -> high alert
  if (input.nutritionScore >= 5) {
    const dup = await isDuplicate(input.childId, 'Nutrition', 'high');
    if (!dup) {
      alerts.push({
        childId: input.childId,
        domain: 'Nutrition',
        indicator: 'Severe Malnutrition',
        severity: 'high',
        confidencePct: 92,
        dqValue: null,
        message: `Nutrition score ${input.nutritionScore}: underweight=${input.underweight}, stunting=${input.stunting}, wasting=${input.wasting}`,
        suggestedAction: 'Refer to NRC; supplementary nutrition program; growth monitoring',
      });
    }
  }

  return alerts;
}

// ─── Cluster risk concentration alerts ──────────────────────────────────────────

export async function generateClusterAlerts(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];

  // Get mandal-level risk concentration
  const children = await prisma.child.findMany({
    where: { isActive: true },
    include: {
      awc: true,
      riskProfiles: {
        orderBy: { calculationDate: 'desc' },
        take: 1,
      },
    },
  });

  // Group by mandal (location name at the sector/project level)
  const mandalRisk: Record<string, { high: number; total: number }> = {};

  for (const child of children) {
    const mandalName = child.awc?.name ?? 'Unknown';
    if (!mandalRisk[mandalName]) {
      mandalRisk[mandalName] = { high: 0, total: 0 };
    }
    mandalRisk[mandalName].total += 1;
    if (child.riskProfiles[0]?.riskCategory === 'High') {
      mandalRisk[mandalName].high += 1;
    }
  }

  for (const [mandal, counts] of Object.entries(mandalRisk)) {
    const pct = counts.total > 0 ? (counts.high / counts.total) * 100 : 0;
    if (pct > 15) {
      const confidencePct = Math.round(Math.min(98, 85 + pct / 10));
      alerts.push({
        childId: null,
        domain: 'Cluster',
        indicator: 'Risk Concentration',
        severity: 'high',
        confidencePct,
        dqValue: null,
        message: `${mandal}: ${Math.round(pct)}% children at high risk (${counts.high}/${counts.total})`,
        suggestedAction: `Deploy additional AWW resources to ${mandal}; community awareness camp`,
      });
    }
  }

  return alerts;
}

// ─── Persist alerts to database ─────────────────────────────────────────────────

export async function persistAlerts(alerts: GeneratedAlert[]): Promise<void> {
  if (alerts.length === 0) return;

  await prisma.intelligentAlert.createMany({
    data: alerts.map((a) => ({
      childId: a.childId,
      domain: a.domain,
      indicator: a.indicator,
      severity: a.severity,
      confidencePct: a.confidencePct,
      dqValue: a.dqValue,
      message: a.message,
      suggestedAction: a.suggestedAction,
      status: 'active' as const,
    })),
  });
}
