import { FastifyRequest, FastifyReply } from 'fastify';

export interface JwtPayload {
  user_id: string;
  role: 'AWW' | 'Supervisor' | 'CDPO' | 'StateAdmin' | 'HealthWorker';
  location_ids: number[];
  username: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    userContext: JwtPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const decoded = await request.jwtVerify<JwtPayload>();
    request.userContext = decoded;
  } catch (err) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token',
    });
  }
}
