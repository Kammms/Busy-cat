import { z } from 'zod';
import { moderators, botSettings, insertSettingSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  moderators: {
    list: {
      method: 'GET' as const,
      path: '/api/moderators',
      responses: {
        200: z.array(z.custom<typeof moderators.$inferSelect>()),
      },
    },
    updateManualPoints: {
      method: 'POST' as const,
      path: '/api/moderators/:id/manual-points',
      input: z.object({
        points: z.number(),
        reason: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof moderators.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    toggleIgnore: {
      method: 'POST' as const,
      path: '/api/moderators/:id/toggle-ignore',
      responses: {
        200: z.custom<typeof moderators.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  settings: {
    list: {
      method: 'GET' as const,
      path: '/api/settings',
      responses: {
        200: z.array(z.custom<typeof botSettings.$inferSelect>()),
      },
    },
    update: {
      method: 'POST' as const,
      path: '/api/settings',
      input: insertSettingSchema,
      responses: {
        200: z.custom<typeof botSettings.$inferSelect>(),
      },
    },
  },
  bot: {
    refreshCache: {
      method: 'POST' as const,
      path: '/api/bot/refresh-cache',
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
      },
    },
    generateLeaderboard: {
      method: 'POST' as const,
      path: '/api/bot/leaderboard',
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
