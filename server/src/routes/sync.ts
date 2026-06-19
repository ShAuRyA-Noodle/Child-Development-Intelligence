import { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { scopeByLocation, isAwcInScope, assertChildInScope, ChildOutOfScopeError } from '../middleware/rbac.js';
import { syncMutationSchema, syncPullSchema } from '../utils/validation.js';

// Roles permitted to push offline mutations (write child PII). Mirrors the
// requireRole('AWW') guards on the REST write routes (children/assessments/interventions).
const SYNC_WRITE_ROLES = ['AWW'] as const;

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
        await applyMutation(request, mutation.tableName, mutation.operation, mutation.payload as Record<string, unknown>);

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
        // Reject (do not apply) out-of-scope / unauthorized or failed mutations.
        const isAuthz = err instanceof SyncAuthorizationError;
        if (isAuthz) {
          console.warn(`Rejected unauthorized mutation ${mutation.mutationId}:`, (err as Error).message);
        } else {
          console.error(`Failed to apply mutation ${mutation.mutationId}:`, (err as Error).message);
        }
        // Persist the rejection so the mutation is not silently re-attempted as applied.
        await prisma.syncMutation.upsert({
          where: { mutationId: mutation.mutationId },
          update: {
            applied: false,
            serverTs: new Date(),
            conflictResolution: isAuthz ? 'rejected_unauthorized' : 'error',
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
            conflictResolution: isAuthz ? 'rejected_unauthorized' : 'error',
          },
        });
        conflictDetails.push({
          mutationId: mutation.mutationId,
          reason: (err as Error).message,
        });
      }
    }

    // Pull server changes since lastSyncTs
    let serverChanges: Record<string, unknown[]> = {};
    if (lastSyncTs) {
      serverChanges = await pullChangesSince(new Date(lastSyncTs), request);
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
    const changes = await pullChangesSince(since, request, parsed.data.tables);

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

/** Authorization failure during sync (out-of-scope target or insufficient role). */
class SyncAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAuthorizationError';
  }
}

async function applyMutation(
  request: FastifyRequest,
  tableName: string,
  operation: string,
  payload: Record<string, unknown>
): Promise<void> {
  // (b) Only roles allowed to write child PII on the REST routes may push mutations.
  const role = request.userContext.role;
  if (!SYNC_WRITE_ROLES.includes(role as (typeof SYNC_WRITE_ROLES)[number])) {
    throw new SyncAuthorizationError(
      `Role '${role}' is not permitted to push offline mutations`
    );
  }

  // (a) Assert a child id is within the caller's scope; throws on out-of-scope/missing.
  const assertScoped = async (childId: string): Promise<void> => {
    try {
      await assertChildInScope(request, childId);
    } catch (err) {
      if (err instanceof ChildOutOfScopeError) {
        throw new SyncAuthorizationError(`Child ${childId} is outside caller scope`);
      }
      throw err;
    }
  };

  // (c) Resolve a target awcId for an INSERT: reject client-supplied out-of-scope
  // values, default to the caller's own location when none supplied.
  const resolveAwcId = async (suppliedAwcId: unknown): Promise<number | undefined> => {
    if (suppliedAwcId !== undefined && suppliedAwcId !== null) {
      const awcId = suppliedAwcId as number;
      if (!(await isAwcInScope(request, awcId))) {
        throw new SyncAuthorizationError(`awcId ${awcId} is outside caller scope`);
      }
      return awcId;
    }
    // Fall back to the caller's first assigned location (mirrors REST POST /children).
    return request.userContext.location_ids[0];
  };

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
            awcId: await resolveAwcId(payload.awcId),
          },
        });
      } else if (operation === 'UPDATE') {
        const { childId, awcId, ...updateData } = payload;
        await assertScoped(childId as string);
        // (c) reject moving the child to an out-of-scope AWC; otherwise keep the change.
        if (awcId !== undefined && awcId !== null) {
          if (!(await isAwcInScope(request, awcId as number))) {
            throw new SyncAuthorizationError(`awcId ${awcId} is outside caller scope`);
          }
          updateData.awcId = awcId;
        }
        if (updateData.dob && typeof updateData.dob === 'string') {
          updateData.dob = new Date(updateData.dob);
        }
        await prisma.child.update({
          where: { childId: childId as string },
          data: updateData,
        });
      } else if (operation === 'DELETE') {
        await assertScoped(payload.childId as string);
        await prisma.child.update({
          where: { childId: payload.childId as string },
          data: { isActive: false },
        });
      }
      break;
    }

    case 'assessments': {
      if (operation === 'INSERT') {
        await assertScoped(payload.childId as string);
        await prisma.assessment.create({
          data: {
            childId: payload.childId as string,
            // (c) never trust a client-supplied assessorId — bind to the caller.
            assessorId: request.userContext.user_id,
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
        await assertScoped(payload.childId as string);
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
        // Resolve the owning child and scope-check before mutating.
        const referral = await prisma.referral.findUnique({
          where: { referralId: referralId as string },
          select: { childId: true },
        });
        if (!referral || !referral.childId) {
          throw new SyncAuthorizationError(`Referral ${referralId} not found in scope`);
        }
        await assertScoped(referral.childId);
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
  request: FastifyRequest,
  tables?: string[]
): Promise<Record<string, unknown[]>> {
  const changes: Record<string, unknown[]> = {};

  // Resolve the caller's location scope. Every query below is constrained to it
  // so a user can never pull children/PII outside their assigned locations.
  const { childFilter } = await scopeByLocation(request);
  // Constrain child-owned records via their parent child relation.
  const childScope = { child: { is: { ...childFilter } } };

  const tablesToSync = tables ?? ['children', 'assessments', 'risk_profiles', 'intelligent_alerts', 'intervention_plans', 'referrals'];

  if (tablesToSync.includes('children')) {
    changes.children = await prisma.child.findMany({
      where: { ...childFilter, updatedAt: { gt: since } },
    });
  }

  if (tablesToSync.includes('assessments')) {
    changes.assessments = await prisma.assessment.findMany({
      where: { ...childScope, createdAt: { gt: since } },
    });
  }

  if (tablesToSync.includes('risk_profiles')) {
    changes.risk_profiles = await prisma.riskProfile.findMany({
      where: { ...childScope, calculationDate: { gt: since } },
    });
  }

  if (tablesToSync.includes('intelligent_alerts')) {
    changes.intelligent_alerts = await prisma.intelligentAlert.findMany({
      where: { ...childScope, generatedAt: { gt: since } },
    });
  }

  if (tablesToSync.includes('intervention_plans')) {
    changes.intervention_plans = await prisma.interventionPlan.findMany({
      where: { ...childScope, createdAt: { gt: since } },
      include: { activities: true },
    });
  }

  if (tablesToSync.includes('referrals')) {
    changes.referrals = await prisma.referral.findMany({
      where: { ...childScope, referralDate: { gt: since } },
    });
  }

  return changes;
}
