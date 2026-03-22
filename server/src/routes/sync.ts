import { FastifyInstance } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { syncMutationSchema, syncPullSchema } from '../utils/validation.js';

const prisma = new PrismaClient();

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/sync — receive offline mutations, apply LWW, return server changes
  app.post('/api/v1/sync', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = syncMutationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { mutations, lastSyncTs } = parsed.data;
    const userId = request.userContext.user_id;

    // Create sync log entry
    const syncLog = await prisma.syncLog.create({
      data: {
        userId,
        syncType: 'full',
        syncStart: new Date(),
        status: 'in_progress',
      },
    });

    let recordsPushed = 0;
    let conflicts = 0;
    const conflictDetails: Array<{ mutationId: string; reason: string }> = [];

    // Process each mutation using Last-Write-Wins (LWW)
    for (const mutation of mutations) {
      const clientTs = new Date(mutation.clientTs);

      // Check for existing mutation with same ID (idempotency)
      const existingMutation = await prisma.syncMutation.findUnique({
        where: { mutationId: mutation.mutationId },
      });

      if (existingMutation?.applied) {
        // Already applied — skip
        continue;
      }

      // LWW conflict resolution: check server timestamp vs client timestamp
      let conflictResolution: string | null = null;

      if (mutation.operation === 'UPDATE' && mutation.childId) {
        const serverRecord = await prisma.child.findUnique({
          where: { childId: mutation.childId },
          select: { updatedAt: true },
        });

        if (serverRecord && serverRecord.updatedAt > clientTs) {
          // Server has newer data — client loses
          conflicts++;
          conflictResolution = 'server_wins';
          conflictDetails.push({
            mutationId: mutation.mutationId,
            reason: `Server record updated at ${serverRecord.updatedAt.toISOString()}, client at ${clientTs.toISOString()}`,
          });

          // Store the mutation but mark as conflict
          await prisma.syncMutation.upsert({
            where: { mutationId: mutation.mutationId },
            update: {
              applied: false,
              conflictResolution,
              serverTs: new Date(),
            },
            create: {
              mutationId: mutation.mutationId,
              childId: mutation.childId,
              tableName: mutation.tableName,
              operation: mutation.operation,
              payload: mutation.payload as Prisma.InputJsonValue,
              clientTs,
              serverTs: new Date(),
              applied: false,
              conflictResolution,
            },
          });

          continue;
        }
      }

      // Apply mutation
      try {
        await applyMutation(mutation.tableName, mutation.operation, mutation.payload as Record<string, unknown>);

        await prisma.syncMutation.upsert({
          where: { mutationId: mutation.mutationId },
          update: {
            applied: true,
            serverTs: new Date(),
            conflictResolution: 'client_wins',
          },
          create: {
            mutationId: mutation.mutationId,
            childId: mutation.childId,
            tableName: mutation.tableName,
            operation: mutation.operation,
            payload: mutation.payload as Prisma.InputJsonValue,
            clientTs,
            serverTs: new Date(),
            applied: true,
            conflictResolution: 'client_wins',
          },
        });

        recordsPushed++;
      } catch (err) {
        console.error(`Failed to apply mutation ${mutation.mutationId}:`, (err as Error).message);
        conflictDetails.push({
          mutationId: mutation.mutationId,
          reason: (err as Error).message,
        });
      }
    }

    // Pull server changes since lastSyncTs
    let serverChanges: Record<string, unknown[]> = {};
    if (lastSyncTs) {
      serverChanges = await pullChangesSince(new Date(lastSyncTs), request.userContext.user_id);
    }

    const recordsPulled = Object.values(serverChanges).reduce((sum, arr) => sum + arr.length, 0);

    // Complete sync log
    await prisma.syncLog.update({
      where: { syncId: syncLog.syncId },
      data: {
        syncEnd: new Date(),
        recordsPushed,
        recordsPulled,
        conflicts,
        status: 'completed',
      },
    });

    return reply.send({
      data: {
        syncId: syncLog.syncId,
        recordsPushed,
        recordsPulled,
        conflicts,
        conflictDetails,
        serverChanges,
      },
    });
  });

  // POST /api/v1/sync/pull — pull server changes since timestamp
  app.post('/api/v1/sync/pull', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = syncPullSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const since = new Date(parsed.data.since);
    const changes = await pullChangesSince(since, request.userContext.user_id, parsed.data.tables);

    const totalRecords = Object.values(changes).reduce((sum, arr) => sum + arr.length, 0);

    return reply.send({
      data: {
        since: since.toISOString(),
        totalRecords,
        changes,
      },
    });
  });

  // GET /api/v1/sync/status — get last sync info for user
  app.get('/api/v1/sync/status', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.userContext.user_id;

    const lastSync = await prisma.syncLog.findFirst({
      where: { userId, status: 'completed' },
      orderBy: { syncEnd: 'desc' },
    });

    const pendingMutations = await prisma.syncMutation.count({
      where: { applied: false },
    });

    return reply.send({
      data: {
        lastSync: lastSync
          ? {
              syncId: lastSync.syncId,
              syncType: lastSync.syncType,
              syncEnd: lastSync.syncEnd,
              recordsPushed: lastSync.recordsPushed,
              recordsPulled: lastSync.recordsPulled,
              conflicts: lastSync.conflicts,
            }
          : null,
        pendingMutations,
      },
    });
  });
}

// ─── Apply a single mutation to the database ────────────────────────────────────

async function applyMutation(
  tableName: string,
  operation: string,
  payload: Record<string, unknown>
): Promise<void> {
  switch (tableName) {
    case 'children': {
      if (operation === 'INSERT') {
        const dob = payload.dob ? new Date(payload.dob as string) : new Date();
        await prisma.child.create({
          data: {
            childId: payload.childId as string,
            firstName: payload.firstName as string | undefined,
            lastName: payload.lastName as string | undefined,
            gender: payload.gender as string | undefined,
            dob,
            birthWeightKg: payload.birthWeightKg as number | undefined,
            birthStatus: payload.birthStatus as string | undefined,
            caregiverId: payload.caregiverId as string | undefined,
            awcId: payload.awcId as number | undefined,
          },
        });
      } else if (operation === 'UPDATE') {
        const { childId, ...updateData } = payload;
        if (updateData.dob && typeof updateData.dob === 'string') {
          updateData.dob = new Date(updateData.dob);
        }
        await prisma.child.update({
          where: { childId: childId as string },
          data: updateData,
        });
      } else if (operation === 'DELETE') {
        await prisma.child.update({
          where: { childId: payload.childId as string },
          data: { isActive: false },
        });
      }
      break;
    }

    case 'assessments': {
      if (operation === 'INSERT') {
        await prisma.assessment.create({
          data: {
            childId: payload.childId as string,
            assessorId: payload.assessorId as string | undefined,
            assessmentDate: new Date(payload.assessmentDate as string),
            assessmentCycle: payload.assessmentCycle as string | undefined,
            ageAtAssessmentMonths: payload.ageAtAssessmentMonths as number,
            heightCm: payload.heightCm as number | undefined,
            weightKg: payload.weightKg as number | undefined,
            muacCm: payload.muacCm as number | undefined,
            gmDq: payload.gmDq as number | undefined,
            fmDq: payload.fmDq as number | undefined,
            lcDq: payload.lcDq as number | undefined,
            cogDq: payload.cogDq as number | undefined,
            seDq: payload.seDq as number | undefined,
            compositeDq: payload.compositeDq as number | undefined,
            gmDelay: (payload.gmDelay as number) ?? 0,
            fmDelay: (payload.fmDelay as number) ?? 0,
            lcDelay: (payload.lcDelay as number) ?? 0,
            cogDelay: (payload.cogDelay as number) ?? 0,
            seDelay: (payload.seDelay as number) ?? 0,
            numDelays: (payload.numDelays as number) ?? 0,
            autismRisk: payload.autismRisk as string | undefined,
            adhdRisk: payload.adhdRisk as string | undefined,
            behaviorRisk: payload.behaviorRisk as string | undefined,
            behaviourScore: (payload.behaviourScore as number) ?? 0,
            nutritionScore: (payload.nutritionScore as number) ?? 0,
            clinicalObservations: payload.clinicalObservations as string | undefined,
          },
        });
      }
      break;
    }

    case 'referrals': {
      if (operation === 'INSERT') {
        await prisma.referral.create({
          data: {
            childId: payload.childId as string,
            referredBy: payload.referredBy as string | undefined,
            referralType: payload.referralType as string | undefined,
            reason: payload.reason as string,
            status: (payload.status as string) ?? 'Pending',
          },
        });
      } else if (operation === 'UPDATE') {
        const { referralId, ...updateData } = payload;
        await prisma.referral.update({
          where: { referralId: referralId as string },
          data: updateData,
        });
      }
      break;
    }

    default:
      throw new Error(`Unsupported table for sync: ${tableName}`);
  }
}

// ─── Pull changes from server since a given timestamp ───────────────────────────

async function pullChangesSince(
  since: Date,
  _userId: string,
  tables?: string[]
): Promise<Record<string, unknown[]>> {
  const changes: Record<string, unknown[]> = {};

  const tablesToSync = tables ?? ['children', 'assessments', 'risk_profiles', 'intelligent_alerts', 'intervention_plans', 'referrals'];

  if (tablesToSync.includes('children')) {
    changes.children = await prisma.child.findMany({
      where: { updatedAt: { gt: since } },
    });
  }

  if (tablesToSync.includes('assessments')) {
    changes.assessments = await prisma.assessment.findMany({
      where: { createdAt: { gt: since } },
    });
  }

  if (tablesToSync.includes('risk_profiles')) {
    changes.risk_profiles = await prisma.riskProfile.findMany({
      where: { calculationDate: { gt: since } },
    });
  }

  if (tablesToSync.includes('intelligent_alerts')) {
    changes.intelligent_alerts = await prisma.intelligentAlert.findMany({
      where: { generatedAt: { gt: since } },
    });
  }

  if (tablesToSync.includes('intervention_plans')) {
    changes.intervention_plans = await prisma.interventionPlan.findMany({
      where: { createdAt: { gt: since } },
      include: { activities: true },
    });
  }

  if (tablesToSync.includes('referrals')) {
    changes.referrals = await prisma.referral.findMany({
      where: { referralDate: { gt: since } },
    });
  }

  return changes;
}
