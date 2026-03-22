import { Queue, Worker, type Job } from 'bullmq';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IORedis = require('ioredis');
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { computeRuleBasedScore, callMLEngine, computeHybridScore, type AssessmentData } from '../services/risk-scoring.js';
import { generateAlerts, persistAlerts, type AlertInput } from '../services/alert-generator.js';
import { mapInterventions, type InterventionInput } from '../services/intervention-mapper.js';

const prisma = new PrismaClient();

// ─── Redis connection ───────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisConnection: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRedisConnection(): any {
  if (!redisConnection) {
    redisConnection = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return redisConnection;
}

// ─── Queue definitions ─────────────────────────────────────────────────────────

let riskScoringQueue: Queue;
let alertGenerationQueue: Queue;
let interventionUpdateQueue: Queue;
let notificationQueue: Queue;

export function initializeQueues(): {
  riskScoringQueue: Queue;
  alertGenerationQueue: Queue;
  interventionUpdateQueue: Queue;
  notificationQueue: Queue;
} {
  const connection = getRedisConnection() as unknown as import('bullmq').ConnectionOptions;

  riskScoringQueue = new Queue('risk-scoring', { connection });
  alertGenerationQueue = new Queue('alert-generation', { connection });
  interventionUpdateQueue = new Queue('intervention-update', { connection });
  notificationQueue = new Queue('notification', { connection });

  return { riskScoringQueue, alertGenerationQueue, interventionUpdateQueue, notificationQueue };
}

// ─── Job dispatchers ────────────────────────────────────────────────────────────

export async function enqueueRiskScoring(assessmentId: string, childId: string): Promise<void> {
  await riskScoringQueue.add('score', { assessmentId, childId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export async function enqueueAlertGeneration(childId: string, assessmentId: string): Promise<void> {
  await alertGenerationQueue.add('generate', { childId, assessmentId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export async function enqueueInterventionUpdate(childId: string, assessmentId: string): Promise<void> {
  await interventionUpdateQueue.add('update', { childId, assessmentId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

// ─── Workers ────────────────────────────────────────────────────────────────────

export function startWorkers(): void {
  const connection = getRedisConnection() as unknown as import('bullmq').ConnectionOptions;

  // Risk Scoring Worker
  // Triggered on assessment.created -> compute score -> store -> trigger alert generation
  const riskWorker = new Worker('risk-scoring', async (job: Job) => {
    const { assessmentId, childId } = job.data as { assessmentId: string; childId: string };

    const assessment = await prisma.assessment.findUnique({
      where: { assessmentId },
    });

    if (!assessment) {
      throw new Error(`Assessment ${assessmentId} not found`);
    }

    const assessmentData: AssessmentData = {
      gmDelay: assessment.gmDelay,
      fmDelay: assessment.fmDelay,
      lcDelay: assessment.lcDelay,
      cogDelay: assessment.cogDelay,
      seDelay: assessment.seDelay,
      numDelays: assessment.numDelays,
      autismRisk: assessment.autismRisk,
      adhdRisk: assessment.adhdRisk,
      behaviorRisk: assessment.behaviorRisk,
      nutritionScore: assessment.nutritionScore,
      gmDq: assessment.gmDq ? Number(assessment.gmDq) : null,
      fmDq: assessment.fmDq ? Number(assessment.fmDq) : null,
      lcDq: assessment.lcDq ? Number(assessment.lcDq) : null,
      cogDq: assessment.cogDq ? Number(assessment.cogDq) : null,
      seDq: assessment.seDq ? Number(assessment.seDq) : null,
      compositeDq: assessment.compositeDq ? Number(assessment.compositeDq) : null,
      behaviourScore: assessment.behaviourScore,
      homeStimulationScore: assessment.homeStimulationScore ?? 5,
      parentMentalHealthScore: assessment.parentMentalHealthScore ?? 5,
      caregiverEngagement: assessment.caregiverEngagement ?? null,
      languageExposure: assessment.languageExposure ?? null,
      waz: null, // Will be computed by WHO z-score module if weight/height available
      haz: null,
      whz: null,
      muacCm: assessment.muacCm ? Number(assessment.muacCm) : null,
    };

    // Compute rule-based score
    const ruleResult = computeRuleBasedScore(assessmentData);

    // Attempt ML engine call
    const mlResult = await callMLEngine({
      gm_dq: assessmentData.gmDq,
      fm_dq: assessmentData.fmDq,
      lc_dq: assessmentData.lcDq,
      cog_dq: assessmentData.cogDq,
      se_dq: assessmentData.seDq,
      composite_dq: assessmentData.compositeDq,
      num_delays: assessmentData.numDelays,
      autism_risk: assessmentData.autismRisk,
      adhd_risk: assessmentData.adhdRisk,
      behavior_risk: assessmentData.behaviorRisk,
      nutrition_score: assessmentData.nutritionScore,
    });

    let finalScore = ruleResult.riskScore;
    let finalCategory = ruleResult.riskCategory;
    let mlScoreValue: number | null = null;
    let hybridScoreValue: number | null = null;
    let alphaValue: number | null = null;

    if (mlResult) {
      mlScoreValue = mlResult.riskScore;
      alphaValue = 0.7;
      const hybrid = computeHybridScore(ruleResult.riskScore, mlResult.riskScore, alphaValue);
      hybridScoreValue = hybrid.hybridScore;
      finalScore = hybrid.hybridScore;
      finalCategory = hybrid.riskCategory;
    }

    // Store risk profile with dual scoring
    const riskProfile = await prisma.riskProfile.create({
      data: {
        childId,
        assessmentId,
        computedRiskScore: finalScore,
        riskCategory: finalCategory,
        confidenceScore: ruleResult.confidence,
        numDelays: ruleResult.numDelays,
        contributingDomains: JSON.parse(JSON.stringify(ruleResult.contributingDomains)),
        oldScore: ruleResult.oldScore,
        oldCategory: ruleResult.oldCategory,
        formulaVersion: ruleResult.formulaVersion,
        activeFormula: ruleResult.activeFormula,
      },
    });

    // Log the decision
    await prisma.riskDecisionLog.create({
      data: {
        riskProfileId: riskProfile.riskId,
        ruleScore: ruleResult.riskScore,
        mlScore: mlScoreValue,
        hybridScore: hybridScoreValue,
        alpha: alphaValue,
        overrides: undefined,
        reasoning: mlResult
          ? `Hybrid scoring: rule=${ruleResult.riskScore}, ml=${mlScoreValue}, alpha=${alphaValue}`
          : 'Rule-based only (ML engine unavailable)',
      },
    });

    // Trigger alert generation
    await enqueueAlertGeneration(childId, assessmentId);

    // Trigger intervention update
    await enqueueInterventionUpdate(childId, assessmentId);

    return { riskProfileId: riskProfile.riskId, category: finalCategory, score: finalScore };
  }, { connection, concurrency: 5 });

  riskWorker.on('failed', (job, err) => {
    console.error(`Risk scoring job ${job?.id} failed:`, err.message);
  });

  // Alert Generation Worker
  // Triggered on risk.scored -> generate alerts -> persist
  const alertWorker = new Worker('alert-generation', async (job: Job) => {
    const { childId, assessmentId } = job.data as { childId: string; assessmentId: string };

    const assessment = await prisma.assessment.findUnique({
      where: { assessmentId },
    });

    if (!assessment) {
      throw new Error(`Assessment ${assessmentId} not found`);
    }

    const alertInput: AlertInput = {
      childId,
      gmDq: assessment.gmDq ? Number(assessment.gmDq) : null,
      fmDq: assessment.fmDq ? Number(assessment.fmDq) : null,
      lcDq: assessment.lcDq ? Number(assessment.lcDq) : null,
      cogDq: assessment.cogDq ? Number(assessment.cogDq) : null,
      seDq: assessment.seDq ? Number(assessment.seDq) : null,
      compositeDq: assessment.compositeDq ? Number(assessment.compositeDq) : null,
      autismRisk: assessment.autismRisk,
      numDelays: assessment.numDelays,
      nutritionScore: assessment.nutritionScore,
      underweight: assessment.underweight,
      stunting: assessment.stunting,
      wasting: assessment.wasting,
    };

    const alerts = await generateAlerts(alertInput);
    await persistAlerts(alerts);

    // Trigger notifications for critical alerts
    const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
    if (criticalAlerts.length > 0) {
      await notificationQueue.add('notify', {
        childId,
        alerts: criticalAlerts.map((a) => ({
          domain: a.domain,
          severity: a.severity,
          message: a.message,
        })),
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
      });
    }

    return { alertsGenerated: alerts.length, critical: criticalAlerts.length };
  }, { connection, concurrency: 5 });

  alertWorker.on('failed', (job, err) => {
    console.error(`Alert generation job ${job?.id} failed:`, err.message);
  });

  // Intervention Update Worker
  const interventionWorker = new Worker('intervention-update', async (job: Job) => {
    const { childId, assessmentId } = job.data as { childId: string; assessmentId: string };

    const assessment = await prisma.assessment.findUnique({
      where: { assessmentId },
    });

    if (!assessment) {
      throw new Error(`Assessment ${assessmentId} not found`);
    }

    const interventionInput: InterventionInput = {
      lcDq: assessment.lcDq ? Number(assessment.lcDq) : null,
      gmDq: assessment.gmDq ? Number(assessment.gmDq) : null,
      fmDq: assessment.fmDq ? Number(assessment.fmDq) : null,
      cogDq: assessment.cogDq ? Number(assessment.cogDq) : null,
      seDq: assessment.seDq ? Number(assessment.seDq) : null,
      behaviourRiskLevel: assessment.behaviorRisk,
      behaviourConcerns: null,
      behaviourScore: assessment.behaviourScore,
      nutritionRisk: assessment.nutritionRisk,
      nutritionScore: assessment.nutritionScore,
    };

    const activities = mapInterventions(interventionInput);

    if (activities.length > 0) {
      const plan = await prisma.interventionPlan.create({
        data: {
          childId,
          generatedFromAssessmentId: assessmentId,
          status: 'Active',
          startDate: new Date(),
          activities: {
            create: activities.map((a) => ({
              domain: a.domain,
              activityName: a.activityName,
              frequency: a.frequency,
              durationMinutes: a.durationMinutes,
              caregiverFormat: a.caregiverFormat,
              priority: a.priority,
              rationale: a.rationale,
            })),
          },
        },
      });

      return { planId: plan.planId, activitiesCreated: activities.length };
    }

    return { planId: null, activitiesCreated: 0 };
  }, { connection, concurrency: 5 });

  interventionWorker.on('failed', (job, err) => {
    console.error(`Intervention update job ${job?.id} failed:`, err.message);
  });

  // Notification Worker (logs for now; wire to SMS/push in production)
  const notifWorker = new Worker('notification', async (job: Job) => {
    const { childId, alerts } = job.data as {
      childId: string;
      alerts: Array<{ domain: string; severity: string; message: string }>;
    };

    // In production, this would send SMS via Twilio, push via FCM, etc.
    console.log(`[Notification] Child ${childId}: ${alerts.length} critical alert(s)`);
    for (const alert of alerts) {
      console.log(`  - [${alert.severity}] ${alert.domain}: ${alert.message}`);
    }

    return { notified: true, childId, alertCount: alerts.length };
  }, { connection, concurrency: 3 });

  notifWorker.on('failed', (job, err) => {
    console.error(`Notification job ${job?.id} failed:`, err.message);
  });

  console.log('All BullMQ workers started');
}

// ─── Cleanup ────────────────────────────────────────────────────────────────────

export async function closeQueues(): Promise<void> {
  if (riskScoringQueue) await riskScoringQueue.close();
  if (alertGenerationQueue) await alertGenerationQueue.close();
  if (interventionUpdateQueue) await interventionUpdateQueue.close();
  if (notificationQueue) await notificationQueue.close();
  if (redisConnection) await redisConnection.quit();
}
