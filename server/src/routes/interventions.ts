import { FastifyInstance } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import {
  interventionCreateSchema,
  interventionUpdateSchema,
  complianceCreateSchema,
} from '../utils/validation.js';

const prisma = new PrismaClient();

export async function interventionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/interventions?child_id= — get intervention plans for a child
  app.get('/api/v1/interventions', { preHandler: [authenticate] }, async (request, reply) => {
    const { child_id, status, page = '1', limit = '50' } = request.query as Record<string, string | undefined>;

    if (!child_id) {
      return reply.status(400).send({ error: 'Validation Error', message: 'child_id query parameter is required' });
    }

    const pageNum = Math.max(1, parseInt(page ?? '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = { childId: child_id };
    if (status) {
      where.status = status;
    }

    const [plans, total] = await Promise.all([
      prisma.interventionPlan.findMany({
        where,
        include: {
          activities: {
            orderBy: { priority: 'asc' },
          },
          compliance: {
            orderBy: { activityDate: 'desc' },
            take: 10,
          },
          assessment: {
            select: { assessmentId: true, assessmentDate: true, assessmentCycle: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.interventionPlan.count({ where }),
    ]);

    return reply.send({
      data: plans,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  // POST /api/v1/interventions — create intervention plan
  app.post('/api/v1/interventions', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = interventionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;

    // Verify child exists
    const child = await prisma.child.findUnique({ where: { childId: data.childId } });
    if (!child) {
      return reply.status(404).send({ error: 'Not Found', message: `Child ${data.childId} not found` });
    }

    const plan = await prisma.interventionPlan.create({
      data: {
        childId: data.childId,
        generatedFromAssessmentId: data.assessmentId,
        status: data.status,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        activities: data.activities
          ? {
              create: data.activities.map((a) => ({
                domain: a.domain,
                activityName: a.activityName,
                frequency: a.frequency,
                durationMinutes: a.durationMinutes,
                caregiverFormat: a.caregiverFormat,
                priority: a.priority,
                rationale: a.rationale,
              })),
            }
          : undefined,
      },
      include: { activities: true },
    });

    // Audit trail
    await prisma.auditTrail.create({
      data: {
        userId: request.userContext.user_id,
        action: 'CREATE',
        tableName: 'intervention_plans',
        recordId: plan.planId,
        newValues: data as unknown as Prisma.InputJsonValue,
        ipAddress: request.ip,
      },
    });

    return reply.status(201).send({ data: plan });
  });

  // PATCH /api/v1/interventions/:id — update plan status
  app.patch('/api/v1/interventions/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = interventionUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const existing = await prisma.interventionPlan.findUnique({ where: { planId: id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Not Found', message: `Intervention plan ${id} not found` });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.status) updateData.status = parsed.data.status;
    if (parsed.data.startDate) updateData.startDate = new Date(parsed.data.startDate);
    if (parsed.data.endDate) updateData.endDate = new Date(parsed.data.endDate);

    const plan = await prisma.interventionPlan.update({
      where: { planId: id },
      data: updateData,
      include: { activities: true },
    });

    // Audit trail
    await prisma.auditTrail.create({
      data: {
        userId: request.userContext.user_id,
        action: 'UPDATE',
        tableName: 'intervention_plans',
        recordId: id,
        oldValues: { status: existing.status } as Prisma.InputJsonValue,
        newValues: parsed.data as unknown as Prisma.InputJsonValue,
        ipAddress: request.ip,
      },
    });

    return reply.send({ data: plan });
  });

  // POST /api/v1/interventions/:id/compliance — log activity compliance
  app.post('/api/v1/interventions/:id/compliance', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = complianceCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // Verify plan exists
    const plan = await prisma.interventionPlan.findUnique({ where: { planId: id } });
    if (!plan) {
      return reply.status(404).send({ error: 'Not Found', message: `Intervention plan ${id} not found` });
    }

    const compliance = await prisma.interventionCompliance.create({
      data: {
        planId: id,
        activityDate: new Date(parsed.data.activityDate),
        completed: parsed.data.completed,
        duration: parsed.data.duration,
        notes: parsed.data.notes,
      },
    });

    return reply.status(201).send({ data: compliance });
  });
}
