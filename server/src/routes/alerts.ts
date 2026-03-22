import { FastifyInstance } from 'fastify';
import { PrismaClient, SeverityLevel } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { scopeByLocation } from '../middleware/rbac.js';
import { alertUpdateSchema } from '../utils/validation.js';

const prisma = new PrismaClient();

// Map P1/P2/P3 labels to severity enum values
const SEVERITY_PRIORITY_MAP: Record<string, SeverityLevel[]> = {
  P1: ['critical'],
  P2: ['high'],
  P3: ['moderate', 'low'],
};

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/alerts — list alerts scoped by role
  app.get('/api/v1/alerts', { preHandler: [authenticate] }, async (request, reply) => {
    const {
      priority,
      status = 'active',
      page = '1',
      limit = '50',
    } = request.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page ?? '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10)));
    const skip = (pageNum - 1) * limitNum;

    const { childFilter } = await scopeByLocation(request);

    // Get scoped child IDs
    let childIdFilter: string[] | undefined;
    if (Object.keys(childFilter).length > 0) {
      const scopedChildren = await prisma.child.findMany({
        where: { ...childFilter, isActive: true },
        select: { childId: true },
      });
      childIdFilter = scopedChildren.map((c) => c.childId);
    }

    const where: Record<string, unknown> = {};

    if (childIdFilter) {
      // Include alerts for scoped children plus cluster-level alerts (childId = null)
      where.OR = [
        { childId: { in: childIdFilter } },
        { childId: null },
      ];
    }

    if (status) {
      where.status = status;
    }

    // P1/P2/P3 filtering
    if (priority && SEVERITY_PRIORITY_MAP[priority]) {
      where.severity = { in: SEVERITY_PRIORITY_MAP[priority] };
    }

    const [alerts, total] = await Promise.all([
      prisma.intelligentAlert.findMany({
        where,
        include: {
          child: {
            select: { childId: true, firstName: true, lastName: true },
          },
        },
        orderBy: [
          { severity: 'asc' }, // critical first
          { generatedAt: 'desc' },
        ],
        skip,
        take: limitNum,
      }),
      prisma.intelligentAlert.count({ where }),
    ]);

    return reply.send({
      data: alerts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  // GET /api/v1/alerts/summary — alert count by severity
  app.get('/api/v1/alerts/summary', { preHandler: [authenticate] }, async (request, reply) => {
    const { childFilter } = await scopeByLocation(request);

    let childIdFilter: string[] | undefined;
    if (Object.keys(childFilter).length > 0) {
      const scopedChildren = await prisma.child.findMany({
        where: { ...childFilter, isActive: true },
        select: { childId: true },
      });
      childIdFilter = scopedChildren.map((c) => c.childId);
    }

    const baseWhere: Record<string, unknown> = { status: 'active' };
    if (childIdFilter) {
      baseWhere.OR = [
        { childId: { in: childIdFilter } },
        { childId: null },
      ];
    }

    const [critical, high, moderate, low, total] = await Promise.all([
      prisma.intelligentAlert.count({ where: { ...baseWhere, severity: 'critical' } }),
      prisma.intelligentAlert.count({ where: { ...baseWhere, severity: 'high' } }),
      prisma.intelligentAlert.count({ where: { ...baseWhere, severity: 'moderate' } }),
      prisma.intelligentAlert.count({ where: { ...baseWhere, severity: 'low' } }),
      prisma.intelligentAlert.count({ where: baseWhere }),
    ]);

    return reply.send({
      data: {
        total,
        by_severity: { critical, high, moderate, low },
        by_priority: {
          P1: critical,
          P2: high,
          P3: moderate + low,
        },
      },
    });
  });

  // PATCH /api/v1/alerts/:id — acknowledge/resolve alert
  app.patch('/api/v1/alerts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = alertUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const existing = await prisma.intelligentAlert.findUnique({ where: { alertId: id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Not Found', message: `Alert ${id} not found` });
    }

    const updateData: Record<string, unknown> = {
      status: parsed.data.status,
    };

    if (parsed.data.status === 'resolved') {
      updateData.resolvedAt = new Date();
      updateData.resolvedBy = request.userContext.user_id;
    }

    const alert = await prisma.intelligentAlert.update({
      where: { alertId: id },
      data: updateData,
    });

    // Audit trail
    await prisma.auditTrail.create({
      data: {
        userId: request.userContext.user_id,
        action: 'UPDATE',
        tableName: 'intelligent_alerts',
        recordId: id,
        oldValues: { status: existing.status },
        newValues: { status: parsed.data.status },
        ipAddress: request.ip,
      },
    });

    return reply.send({ data: alert });
  });
}
