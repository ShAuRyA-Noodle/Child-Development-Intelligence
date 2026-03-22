import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { scopeByLocation } from '../middleware/rbac.js';

const prisma = new PrismaClient();

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/analytics — aggregated KPIs scoped by role
  app.get('/api/v1/analytics', { preHandler: [authenticate] }, async (request, reply) => {
    const { childFilter } = await scopeByLocation(request);
    const baseWhere = { ...childFilter, isActive: true };

    const children = await prisma.child.findMany({
      where: baseWhere,
      include: {
        riskProfiles: {
          orderBy: { calculationDate: 'desc' },
          take: 1,
          select: { riskCategory: true, improvementStatus: true },
        },
        interventionPlans: {
          where: { status: 'Active' },
          select: { planId: true },
          take: 1,
        },
        referrals: {
          where: { status: 'Pending' },
          select: { referralId: true },
          take: 1,
        },
      },
    });

    const total = children.length;
    let highRisk = 0;
    let mediumRisk = 0;
    let lowRisk = 0;
    let interventionActive = 0;
    let improved = 0;

    for (const child of children) {
      const latestRisk = child.riskProfiles[0];
      if (latestRisk) {
        if (latestRisk.riskCategory === 'High') highRisk++;
        else if (latestRisk.riskCategory === 'Medium') mediumRisk++;
        else lowRisk++;

        if (latestRisk.improvementStatus === 'Improved') improved++;
      } else {
        lowRisk++;
      }

      if (child.interventionPlans.length > 0) interventionActive++;
    }

    const kpi = {
      total_children: total,
      high_risk: highRisk,
      medium_risk: mediumRisk,
      low_risk: lowRisk,
      intervention_active: interventionActive,
      improved,
      high_risk_pct: total > 0 ? Math.round((highRisk / total) * 1000) / 10 : 0,
      medium_risk_pct: total > 0 ? Math.round((mediumRisk / total) * 1000) / 10 : 0,
      low_risk_pct: total > 0 ? Math.round((lowRisk / total) * 1000) / 10 : 0,
    };

    return reply.send({ data: kpi });
  });

  // GET /api/v1/analytics/mandals — mandal-level analytics
  app.get('/api/v1/analytics/mandals', { preHandler: [authenticate] }, async (request, reply) => {
    const { childFilter } = await scopeByLocation(request);
    const baseWhere = { ...childFilter, isActive: true };

    const children = await prisma.child.findMany({
      where: baseWhere,
      include: {
        awc: {
          include: {
            parent: { select: { name: true, parent: { select: { name: true } } } },
          },
        },
        riskProfiles: {
          orderBy: { calculationDate: 'desc' },
          take: 1,
          select: { riskCategory: true, improvementStatus: true },
        },
        assessments: {
          orderBy: { assessmentDate: 'desc' },
          take: 1,
          select: { compositeDq: true },
        },
        interventionPlans: {
          where: { status: 'Active' },
          select: { planId: true },
          take: 1,
        },
        referrals: {
          where: { status: 'Pending' },
          select: { referralId: true },
          take: 1,
        },
      },
    });

    // Group by mandal (sector-level parent name)
    const mandalStats: Record<string, {
      total: number;
      high_risk: number;
      medium_risk: number;
      low_risk: number;
      dq_sum: number;
      referral_pending: number;
      intervention_active: number;
      improved: number;
    }> = {};

    for (const child of children) {
      // Resolve mandal name from location hierarchy
      const mandalName = child.awc?.parent?.name ?? child.awc?.name ?? 'Unknown';

      if (!mandalStats[mandalName]) {
        mandalStats[mandalName] = {
          total: 0, high_risk: 0, medium_risk: 0, low_risk: 0,
          dq_sum: 0, referral_pending: 0, intervention_active: 0, improved: 0,
        };
      }

      const m = mandalStats[mandalName];
      m.total++;

      const latestRisk = child.riskProfiles[0];
      if (latestRisk) {
        if (latestRisk.riskCategory === 'High') m.high_risk++;
        else if (latestRisk.riskCategory === 'Medium') m.medium_risk++;
        else m.low_risk++;
        if (latestRisk.improvementStatus === 'Improved') m.improved++;
      } else {
        m.low_risk++;
      }

      const latestAssessment = child.assessments[0];
      if (latestAssessment?.compositeDq) {
        m.dq_sum += Number(latestAssessment.compositeDq);
      }

      if (child.referrals.length > 0) m.referral_pending++;
      if (child.interventionPlans.length > 0) m.intervention_active++;
    }

    const mandals = Object.entries(mandalStats).map(([mandal, stats]) => ({
      mandal,
      total: stats.total,
      high_risk: stats.high_risk,
      medium_risk: stats.medium_risk,
      low_risk: stats.low_risk,
      avg_composite_dq: stats.total > 0 ? Math.round((stats.dq_sum / stats.total) * 10) / 10 : 0,
      referral_pending: stats.referral_pending,
      intervention_active: stats.intervention_active,
      improved: stats.improved,
    })).sort((a, b) => a.mandal.localeCompare(b.mandal));

    return reply.send({ data: mandals });
  });

  // GET /api/v1/analytics/districts — district-level analytics
  app.get('/api/v1/analytics/districts', { preHandler: [authenticate] }, async (request, reply) => {
    const { childFilter } = await scopeByLocation(request);
    const baseWhere = { ...childFilter, isActive: true };

    const children = await prisma.child.findMany({
      where: baseWhere,
      include: {
        awc: {
          include: {
            parent: {
              select: {
                parent: { select: { name: true, parent: { select: { name: true } } } },
              },
            },
          },
        },
        riskProfiles: {
          orderBy: { calculationDate: 'desc' },
          take: 1,
          select: { riskCategory: true },
        },
      },
    });

    const districtStats: Record<string, {
      total: number; high_risk: number; medium_risk: number; low_risk: number;
    }> = {};

    for (const child of children) {
      // Resolve district name from location hierarchy
      const districtName =
        child.awc?.parent?.parent?.name ??
        child.awc?.parent?.parent?.parent?.name ??
        'Unknown';

      if (!districtStats[districtName]) {
        districtStats[districtName] = { total: 0, high_risk: 0, medium_risk: 0, low_risk: 0 };
      }

      const d = districtStats[districtName];
      d.total++;

      const latestRisk = child.riskProfiles[0];
      if (latestRisk) {
        if (latestRisk.riskCategory === 'High') d.high_risk++;
        else if (latestRisk.riskCategory === 'Medium') d.medium_risk++;
        else d.low_risk++;
      } else {
        d.low_risk++;
      }
    }

    const districts = Object.entries(districtStats).map(([district, stats]) => ({
      district,
      ...stats,
    })).sort((a, b) => a.district.localeCompare(b.district));

    return reply.send({ data: districts });
  });

  // GET /api/v1/analytics/longitudinal — longitudinal trend data
  app.get('/api/v1/analytics/longitudinal', { preHandler: [authenticate] }, async (request, reply) => {
    const { childFilter } = await scopeByLocation(request);
    const { months = '6' } = request.query as Record<string, string | undefined>;
    const monthCount = Math.min(24, Math.max(1, parseInt(months ?? '6', 10)));

    // Get risk profiles over time
    const now = new Date();
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - monthCount);

    // Get scoped child IDs
    const scopedChildren = await prisma.child.findMany({
      where: { ...childFilter, isActive: true },
      select: { childId: true },
    });
    const childIds = scopedChildren.map((c) => c.childId);

    const riskProfiles = await prisma.riskProfile.findMany({
      where: {
        childId: { in: childIds },
        calculationDate: { gte: startDate },
      },
      orderBy: { calculationDate: 'asc' },
      select: {
        riskCategory: true,
        calculationDate: true,
        improvementStatus: true,
      },
    });

    // Group by month
    const monthlyData: Record<string, { high: number; medium: number; low: number; total: number }> = {};

    for (const rp of riskProfiles) {
      const monthKey = `${rp.calculationDate.getFullYear()}-${String(rp.calculationDate.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { high: 0, medium: 0, low: 0, total: 0 };
      }
      monthlyData[monthKey].total++;
      if (rp.riskCategory === 'High') monthlyData[monthKey].high++;
      else if (rp.riskCategory === 'Medium') monthlyData[monthKey].medium++;
      else monthlyData[monthKey].low++;
    }

    const riskTrend = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, stats]) => ({
        month,
        high_risk_pct: stats.total > 0 ? Math.round((stats.high / stats.total) * 1000) / 10 : 0,
        medium_risk_pct: stats.total > 0 ? Math.round((stats.medium / stats.total) * 1000) / 10 : 0,
        low_risk_pct: stats.total > 0 ? Math.round((stats.low / stats.total) * 1000) / 10 : 0,
      }));

    // Domain trajectory - average DQ over time from assessments
    const assessments = await prisma.assessment.findMany({
      where: {
        childId: { in: childIds },
        assessmentDate: { gte: startDate },
      },
      orderBy: { assessmentDate: 'asc' },
      select: {
        assessmentDate: true,
        gmDq: true,
        fmDq: true,
        lcDq: true,
        cogDq: true,
        seDq: true,
      },
    });

    const domainMonthly: Record<string, {
      gm: number[]; fm: number[]; lc: number[]; cog: number[]; se: number[];
    }> = {};

    for (const a of assessments) {
      const monthKey = `${a.assessmentDate.getFullYear()}-${String(a.assessmentDate.getMonth() + 1).padStart(2, '0')}`;
      if (!domainMonthly[monthKey]) {
        domainMonthly[monthKey] = { gm: [], fm: [], lc: [], cog: [], se: [] };
      }
      if (a.gmDq) domainMonthly[monthKey].gm.push(Number(a.gmDq));
      if (a.fmDq) domainMonthly[monthKey].fm.push(Number(a.fmDq));
      if (a.lcDq) domainMonthly[monthKey].lc.push(Number(a.lcDq));
      if (a.cogDq) domainMonthly[monthKey].cog.push(Number(a.cogDq));
      if (a.seDq) domainMonthly[monthKey].se.push(Number(a.seDq));
    }

    const avg = (arr: number[]) => arr.length > 0 ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : 0;

    const domainTrajectory = Object.entries(domainMonthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        'Gross Motor': avg(d.gm),
        'Fine Motor': avg(d.fm),
        Language: avg(d.lc),
        Cognitive: avg(d.cog),
        'Socio-Emotional': avg(d.se),
      }));

    // Intervention comparison
    const withIntervention = await prisma.child.findMany({
      where: {
        childId: { in: childIds },
        interventionPlans: { some: { status: 'Active' } },
      },
      include: {
        assessments: {
          orderBy: { assessmentDate: 'desc' },
          take: 1,
          select: { compositeDq: true },
        },
      },
    });

    const withoutIntervention = await prisma.child.findMany({
      where: {
        childId: { in: childIds },
        interventionPlans: { none: {} },
      },
      include: {
        assessments: {
          orderBy: { assessmentDate: 'desc' },
          take: 1,
          select: { compositeDq: true },
        },
      },
    });

    const avgDqWith = avg(
      withIntervention
        .filter((c) => c.assessments[0]?.compositeDq)
        .map((c) => Number(c.assessments[0].compositeDq))
    );
    const avgDqWithout = avg(
      withoutIntervention
        .filter((c) => c.assessments[0]?.compositeDq)
        .map((c) => Number(c.assessments[0].compositeDq))
    );

    // Cohort analytics
    const latestRiskProfiles = await prisma.riskProfile.findMany({
      where: { childId: { in: childIds } },
      orderBy: { calculationDate: 'desc' },
      distinct: ['childId'],
    });

    const totalWithRisk = latestRiskProfiles.length;
    const improvedCount = latestRiskProfiles.filter((r) => r.improvementStatus === 'Improved').length;
    const sameCount = latestRiskProfiles.filter((r) => r.improvementStatus === 'Same').length;
    const worsenedCount = latestRiskProfiles.filter((r) => r.improvementStatus === 'Worsened').length;
    const avgDelayReduction = totalWithRisk > 0
      ? Math.round((latestRiskProfiles.reduce((s, r) => s + r.reductionInDelayMonths, 0) / totalWithRisk) * 10) / 10
      : 0;

    return reply.send({
      data: {
        risk_trend: riskTrend,
        domain_trajectory: domainTrajectory,
        intervention_comparison: {
          with_intervention_avg_dq: avgDqWith,
          without_intervention_avg_dq: avgDqWithout,
          with_count: withIntervention.length,
          without_count: withoutIntervention.length,
        },
        cohort_analytics: {
          improved_pct: totalWithRisk > 0 ? Math.round((improvedCount / totalWithRisk) * 1000) / 10 : 0,
          same_pct: totalWithRisk > 0 ? Math.round((sameCount / totalWithRisk) * 1000) / 10 : 0,
          worsened_pct: totalWithRisk > 0 ? Math.round((worsenedCount / totalWithRisk) * 1000) / 10 : 0,
          avg_delay_reduction_months: avgDelayReduction,
        },
      },
    });
  });
}
