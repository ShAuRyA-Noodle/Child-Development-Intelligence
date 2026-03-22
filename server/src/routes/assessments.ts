import { FastifyInstance } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { assessmentCreateSchema } from '../utils/validation.js';
import { enqueueRiskScoring } from '../jobs/queue.js';

const prisma = new PrismaClient();

export async function assessmentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/assessments?child_id= — list assessments for a child
  app.get('/api/v1/assessments', { preHandler: [authenticate] }, async (request, reply) => {
    const { child_id, page = '1', limit = '50' } = request.query as Record<string, string | undefined>;

    if (!child_id) {
      return reply.status(400).send({ error: 'Validation Error', message: 'child_id query parameter is required' });
    }

    const pageNum = Math.max(1, parseInt(page ?? '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10)));
    const skip = (pageNum - 1) * limitNum;

    const [assessments, total] = await Promise.all([
      prisma.assessment.findMany({
        where: { childId: child_id },
        include: {
          riskProfile: {
            select: {
              computedRiskScore: true,
              riskCategory: true,
              confidenceScore: true,
              contributingDomains: true,
            },
          },
          assessor: {
            select: { fullName: true, username: true },
          },
        },
        orderBy: { assessmentDate: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.assessment.count({ where: { childId: child_id } }),
    ]);

    return reply.send({
      data: assessments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  // GET /api/v1/assessments/:id — get single assessment
  app.get('/api/v1/assessments/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const assessment = await prisma.assessment.findUnique({
      where: { assessmentId: id },
      include: {
        riskProfile: true,
        assessor: { select: { fullName: true, username: true } },
        child: {
          select: { childId: true, firstName: true, lastName: true, dob: true, gender: true },
        },
      },
    });

    if (!assessment) {
      return reply.status(404).send({ error: 'Not Found', message: `Assessment ${id} not found` });
    }

    return reply.send({ data: assessment });
  });

  // POST /api/v1/assessments — create new assessment (AWW only), triggers risk scoring
  app.post(
    '/api/v1/assessments',
    { preHandler: [authenticate, requireRole('AWW')] },
    async (request, reply) => {
      const parsed = assessmentCreateSchema.safeParse(request.body);
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

      const assessment = await prisma.assessment.create({
        data: {
          childId: data.childId,
          assessorId: request.userContext.user_id,
          assessmentDate: new Date(data.assessmentDate),
          assessmentCycle: data.assessmentCycle,
          ageAtAssessmentMonths: data.ageAtAssessmentMonths,
          heightCm: data.heightCm,
          weightKg: data.weightKg,
          muacCm: data.muacCm,
          gmDq: data.gmDq,
          fmDq: data.fmDq,
          lcDq: data.lcDq,
          cogDq: data.cogDq,
          seDq: data.seDq,
          compositeDq: data.compositeDq,
          gmDelay: data.gmDelay,
          fmDelay: data.fmDelay,
          lcDelay: data.lcDelay,
          cogDelay: data.cogDelay,
          seDelay: data.seDelay,
          numDelays: data.numDelays,
          autismRisk: data.autismRisk,
          adhdRisk: data.adhdRisk,
          behaviorRisk: data.behaviorRisk,
          behaviourScore: data.behaviourScore,
          underweight: data.underweight,
          stunting: data.stunting,
          wasting: data.wasting,
          anemia: data.anemia,
          nutritionScore: data.nutritionScore,
          nutritionRisk: data.nutritionRisk,
          clinicalObservations: data.clinicalObservations,
        },
      });

      // Audit trail
      await prisma.auditTrail.create({
        data: {
          userId: request.userContext.user_id,
          action: 'CREATE',
          tableName: 'assessments',
          recordId: assessment.assessmentId,
          newValues: data as unknown as Prisma.InputJsonValue,
          ipAddress: request.ip,
        },
      });

      // Trigger async risk scoring job
      try {
        await enqueueRiskScoring(assessment.assessmentId, data.childId);
      } catch (err) {
        // If Redis is down, compute synchronously as fallback
        console.warn('BullMQ unavailable, risk scoring will be deferred:', (err as Error).message);
      }

      return reply.status(201).send({ data: assessment });
    }
  );
}
