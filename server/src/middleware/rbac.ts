import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { JwtPayload } from './auth.js';

const prisma = new PrismaClient();

type UserRole = JwtPayload['role'];

export function requireRole(...roles: UserRole[]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const ctx = request.userContext;
    if (!ctx) {
      reply.status(401).send({ error: 'Unauthorized', message: 'No user context found' });
      return;
    }
    if (!roles.includes(ctx.role)) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `Role '${ctx.role}' is not permitted for this action. Required: ${roles.join(', ')}`,
      });
      return;
    }
  };
}

export interface LocationFilter {
  awcId?: number | { in: number[] };
  childId?: undefined;
}

export interface ReferralFilter {
  status?: { in: string[] };
}

/**
 * Resolve a location scope filter based on the user's role and assigned locations.
 *
 * - AWW: filter to children at user's assigned AWC locations
 * - Supervisor: filter to children at AWCs under the user's assigned sectors
 * - CDPO: filter to children at AWCs under the user's assigned district/project
 * - StateAdmin: no filter (full access)
 * - HealthWorker: returns a referral filter instead
 */
export async function scopeByLocation(
  req: FastifyRequest
): Promise<{ childFilter: Record<string, unknown>; referralFilter?: ReferralFilter }> {
  const ctx = req.userContext;

  if (ctx.role === 'StateAdmin') {
    return { childFilter: {} };
  }

  if (ctx.role === 'HealthWorker') {
    return {
      childFilter: {},
      referralFilter: { status: { in: ['Pending', 'Active', 'Treatment Active'] } },
    };
  }

  const locationIds = ctx.location_ids;

  if (ctx.role === 'AWW') {
    return {
      childFilter: { awcId: locationIds.length === 1 ? locationIds[0] : { in: locationIds } },
    };
  }

  // For Supervisor and CDPO, resolve child location IDs from the hierarchy
  const childLocationIds = await resolveChildLocations(locationIds);

  if (childLocationIds.length === 0) {
    return { childFilter: { awcId: { in: locationIds } } };
  }

  return {
    childFilter: { awcId: { in: childLocationIds } },
  };
}

/**
 * Recursively resolve all descendant AWC-level location IDs from a set of parent locations.
 */
async function resolveChildLocations(parentIds: number[]): Promise<number[]> {
  const awcIds: number[] = [];
  let currentIds = parentIds;

  // Walk down the hierarchy up to 5 levels deep (State > District > Project > Sector > AWC)
  for (let depth = 0; depth < 5; depth++) {
    if (currentIds.length === 0) break;

    const children = await prisma.location.findMany({
      where: { parentLocationId: { in: currentIds } },
      select: { locationId: true, level: true },
    });

    const nextIds: number[] = [];
    for (const child of children) {
      if (child.level === 'AWC') {
        awcIds.push(child.locationId);
      } else {
        nextIds.push(child.locationId);
      }
    }

    // Also check if any of the current IDs are themselves AWC-level
    const currentLocations = await prisma.location.findMany({
      where: { locationId: { in: currentIds }, level: 'AWC' },
      select: { locationId: true },
    });
    for (const loc of currentLocations) {
      if (!awcIds.includes(loc.locationId)) {
        awcIds.push(loc.locationId);
      }
    }

    currentIds = nextIds;
  }

  return awcIds;
}
