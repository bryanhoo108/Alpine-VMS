import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth/session.js';

/** Server-Sent Events: screens refresh when plates, trips or alerts change. */
export const eventRoutes: FastifyPluginAsync<AppContext> = async (app, ctx) => {
  app.get('/api/events', { preHandler: requireRole() }, (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write('retry: 3000\n\n');
    const off = ctx.events.subscribe((event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      off();
    });
    reply.hijack();
  });
};
