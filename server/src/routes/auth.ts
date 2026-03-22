import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { loginSchema, refreshTokenSchema } from '../utils/validation.js';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';

const prisma = new PrismaClient();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/login
  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { username, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        locations: { select: { locationId: true } },
      },
    });

    if (!user || !user.isActive) {
      return reply.status(401).send({
        error: 'Authentication Failed',
        message: 'Invalid username or password',
      });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return reply.status(401).send({
        error: 'Authentication Failed',
        message: 'Invalid username or password',
      });
    }

    const locationIds = user.locations.map((l) => l.locationId);

    // Generate JWT
    const accessToken = app.jwt.sign(
      {
        user_id: user.userId,
        role: user.role,
        location_ids: locationIds,
        username: user.username,
      },
      { expiresIn: env.JWT_EXPIRY }
    );

    // Generate refresh token
    const refreshToken = crypto.randomBytes(48).toString('hex');

    // Store refresh token
    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        refreshToken,
        lastLogin: new Date(),
      },
    });

    return reply.send({
      accessToken,
      refreshToken,
      user: {
        userId: user.userId,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        email: user.email,
        locationIds,
      },
    });
  });

  // POST /api/v1/auth/refresh
  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const parsed = refreshTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { refreshToken } = parsed.data;

    const user = await prisma.user.findFirst({
      where: { refreshToken, isActive: true },
      include: {
        locations: { select: { locationId: true } },
      },
    });

    if (!user) {
      return reply.status(401).send({
        error: 'Invalid Refresh Token',
        message: 'Refresh token is invalid or expired',
      });
    }

    const locationIds = user.locations.map((l) => l.locationId);

    // Issue new access token
    const accessToken = app.jwt.sign(
      {
        user_id: user.userId,
        role: user.role,
        location_ids: locationIds,
        username: user.username,
      },
      { expiresIn: env.JWT_EXPIRY }
    );

    // Rotate refresh token
    const newRefreshToken = crypto.randomBytes(48).toString('hex');
    await prisma.user.update({
      where: { userId: user.userId },
      data: { refreshToken: newRefreshToken },
    });

    return reply.send({
      accessToken,
      refreshToken: newRefreshToken,
    });
  });

  // POST /api/v1/auth/logout
  app.post('/api/v1/auth/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.userContext.user_id;

    await prisma.user.update({
      where: { userId },
      data: { refreshToken: null },
    });

    return reply.send({ message: 'Logged out successfully' });
  });
}
