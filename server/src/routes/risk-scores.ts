import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { scopeByLocation } from '../middleware/rbac.js';

const prisma = new PrismaClient();

export async function riskScoreRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/risk-scores — list risk scores scoped by RBAC
  app.get('/api/v1/risk-scores', { preHandler: [authenticate] }, async (request, reply) => {
    const { risk_category, page = '1', limit = '50' } = request.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page ?? '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10)));
    const skip = (pageNum - 1) * limitNum;

    const { childFilter } = await scopeByLocation(request);

    // Build child filter for risk profiles
    const childWhere = { ...childFilter, isActive: true };

    // Get child IDs matching the location scope
    const scopedChildren = await prisma.child.findMany({
      where: childWhere,
      select: { childId: true },
    });
    const childIds = scopedChildren.map((c) => c.childId);

    const where: Record<string, unknown> = {
      childId: { in: childIds },
    };

    if (risk_category) {
      where.riskCategory = risk_category;
    }

    const [riskScores, total] = await Promise.all([
      prisma.riskProfile.findMany({
        where,
        include: {
          child: {
            select: { childId: true, firstName: true, lastName: true, dob: true, gender: true },
          },
        },
        orderBy: { calculationDate: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.riskProfile.count({ where }),
    ]);

    return reply.send({
      data: riskScores,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  // GET /api/v1/risk-scores/:child_id — risk score for a child with contributing domains
  app.get('/api/v1/risk-scores/:child_id', { preHandler: [authenticate] }, async (request, reply) => {
    const { child_id } = request.params as { child_id: string };

    const riskProfile = await prisma.riskProfile.findFirst({
      where: { childId: child_id },
      orderBy: { calculationDate: 'desc' },
      include: {
        child: {
          select: { childId: true, firstName: true, lastName: true, dob: true },
        },
        assessment: {
          select: {
            assessmentId: true,
            assessmentDate: true,
            compositeDq: true,
            assessmentCycle: true,
          },
        },
        decisions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!riskProfile) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `No risk profile found for child ${child_id}`,
      });
    }

    // Also get risk profile history
    const history = await prisma.riskProfile.findMany({
      where: { childId: child_id },
      orderBy: { calculationDate: 'asc' },
      select: {
        computedRiskScore: true,
        riskCategory: true,
        confidenceScore: true,
        calculationDate: true,
      },
    });

    return reply.send({
      data: {
        current: riskProfile,
        history,
      },
    });
  });
}
