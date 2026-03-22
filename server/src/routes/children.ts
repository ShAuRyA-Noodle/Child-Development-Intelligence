import { FastifyInstance } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { requireRole, scopeByLocation } from '../middleware/rbac.js';
import { childCreateSchema, childUpdateSchema } from '../utils/validation.js';

const prisma = new PrismaClient();

export async function childrenRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/children — list children scoped by RBAC
  app.get('/api/v1/children', { preHandler: [authenticate] }, async (request, reply) => {
    const { mandal, risk_category, search, page = '1', limit = '50' } = request.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page ?? '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10)));
    const skip = (pageNum - 1) * limitNum;

    const { childFilter } = await scopeByLocation(request);

    const where: Record<string, unknown> = {
      ...childFilter,
      isActive: true,
    };

    // Mandal filter — resolve via location name
    if (mandal) {
      const locations = await prisma.location.findMany({
        where: { name: mandal, level: 'AWC' },
        select: { locationId: true },
      });
      if (locations.length > 0) {
        where.awcId = { in: locations.map((l) => l.locationId) };
      }
    }

    // Search filter (child_id or name)
    if (search) {
      where.OR = [
        { childId: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Risk category filter — need to join through risk profiles
    let childIdFilter: string[] | undefined;
    if (risk_category) {
      const riskProfiles = await prisma.riskProfile.findMany({
        where: { riskCategory: risk_category },
        select: { childId: true },
        distinct: ['childId'],
      });
      childIdFilter = riskProfiles.map((r) => r.childId);
      where.childId = { in: childIdFilter };
    }

    const [children, total] = await Promise.all([
      prisma.child.findMany({
        where,
        include: {
          awc: { select: { name: true, code: true } },
          caregiver: { select: { primaryName: true, contactNumber: true } },
          riskProfiles: {
            orderBy: { calculationDate: 'desc' },
            take: 1,
            select: {
              computedRiskScore: true,
              riskCategory: true,
              confidenceScore: true,
              numDelays: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.child.count({ where }),
    ]);

    return reply.send({
      data: children,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  // GET /api/v1/children/:id — single child with latest assessment + risk profile
  app.get('/api/v1/children/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const child = await prisma.child.findUnique({
      where: { childId: id },
      include: {
        awc: true,
        caregiver: true,
        assessments: {
          orderBy: { assessmentDate: 'desc' },
          take: 1,
        },
        riskProfiles: {
          orderBy: { calculationDate: 'desc' },
          take: 1,
        },
        referrals: {
          orderBy: { referralDate: 'desc' },
          take: 5,
        },
        interventionPlans: {
          where: { status: { in: ['Active', 'Draft'] } },
          include: { activities: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        alerts: {
          where: { status: 'active' },
          orderBy: { generatedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!child) {
      return reply.status(404).send({ error: 'Not Found', message: `Child ${id} not found` });
    }

    return reply.send({ data: child });
  });

  // POST /api/v1/children — register new child (AWW only)
  app.post(
    '/api/v1/children',
    { preHandler: [authenticate, requireRole('AWW')] },
    async (request, reply) => {
      const parsed = childCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const data = parsed.data;

      // Check if child_id already exists
      const existing = await prisma.child.findUnique({ where: { childId: data.childId } });
      if (existing) {
        return reply.status(409).send({ error: 'Conflict', message: `Child ${data.childId} already exists` });
      }

      const child = await prisma.child.create({
        data: {
          childId: data.childId,
          firstName: data.firstName,
          lastName: data.lastName,
          gender: data.gender,
          dob: new Date(data.dob),
          birthWeightKg: data.birthWeightKg,
          birthStatus: data.birthStatus,
          caregiverId: data.caregiverId,
          awcId: data.awcId ?? request.userContext.location_ids[0],
          socialCategory: data.socialCategory,
          maternalEducation: data.maternalEducation,
          paternalEducation: data.paternalEducation,
          householdIncomeBand: data.householdIncomeBand,
          rationCardType: data.rationCardType,
        },
      });

      // Audit trail
      await prisma.auditTrail.create({
        data: {
          userId: request.userContext.user_id,
          action: 'CREATE',
          tableName: 'children',
          recordId: child.childId,
          newValues: data as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      });

      return reply.status(201).send({ data: child });
    }
  );

  // PATCH /api/v1/children/:id — update child record
  app.patch(
    '/api/v1/children/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = childUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const existing = await prisma.child.findUnique({ where: { childId: id } });
      if (!existing) {
        return reply.status(404).send({ error: 'Not Found', message: `Child ${id} not found` });
      }

      const updateData: Record<string, unknown> = { ...parsed.data };
      if (updateData.dob && typeof updateData.dob === 'string') {
        updateData.dob = new Date(updateData.dob as string);
      }

      const child = await prisma.child.update({
        where: { childId: id },
        data: updateData,
      });

      // Audit trail
      await prisma.auditTrail.create({
        data: {
          userId: request.userContext.user_id,
          action: 'UPDATE',
          tableName: 'children',
          recordId: id,
          oldValues: existing as unknown as Prisma.InputJsonValue,
          newValues: parsed.data as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      });

      return reply.send({ data: child });
    }
  );
}
