import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createReport, ingestObservation, observations, reports, stations } from './store.js';

const ingestSchema = z.object({ stationId: z.string(), observedAt: z.string().datetime({ offset: true }).optional(), samples: z.number().int().nonnegative(), sampleRateHz: z.number().positive(), peakAmplitude: z.number().nonnegative(), timingOffsetMs: z.number() });
const reportSchema = z.object({ stationId: z.string(), windowStart: z.string().datetime({ offset: true }), windowEnd: z.string().datetime({ offset: true }) });
export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'seismic-station-quality-service', workflow: '接收台站数据 → 检测完整性 → 计算质量分 → 生成质量报告' }));
  app.get('/api/stations', async () => stations);
  app.post('/api/stations', async (request, reply) => { const body = request.body as Partial<(typeof stations)[number]>; const station = { id: randomUUID(), code: body.code ?? `QZ-${stations.length + 1}`, name: body.name ?? '未命名台站', region: body.region ?? '未设置', elevationM: body.elevationM ?? 0, status: body.status ?? 'offline', lastSeenAt: new Date().toISOString() } as (typeof stations)[number]; stations.push(station); return reply.code(201).send(station); });
  app.post('/api/observations/ingest', async (request, reply) => {
    const parsed = ingestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数校验失败', details: parsed.error.flatten() });
    const input = parsed.data;
    if (!stations.some(item => item.id === input.stationId)) return reply.code(404).send({ error: '台站不存在' });
    // 实时观测与断网补传交错到达时，迟到、重复和维护期间的观测统一按 store 层规则处理，
    // 保证 lastSeenAt 单调推进、maintenance 不被观测冲掉、重复观测不污染质量报告。
    const result = ingestObservation(input);
    // duplicate 表示命中已有观测，未产生新记录；其余结果均已入库。
    reply.header('x-ingest-result', result.kind);
    return reply.code(result.kind === 'duplicate' ? 200 : 201).send(result.observation);
  });
  app.get('/api/observations', async (request) => { const query = request.query as { stationId?: string; minScore?: string }; return observations.filter(item => (!query.stationId || item.stationId === query.stationId) && (!query.minScore || item.qualityScore >= Number(query.minScore))); });
  app.post('/api/quality/reports/run', async (request, reply) => { const parsed = reportSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: '参数校验失败', details: parsed.error.flatten() }); if (!stations.some(item => item.id === parsed.data.stationId)) return reply.code(404).send({ error: '台站不存在' }); return reply.code(201).send(createReport(parsed.data.stationId, parsed.data.windowStart, parsed.data.windowEnd)); });
  app.get('/api/quality/reports', async (request) => { const query = request.query as { stationId?: string }; return reports.filter(item => !query.stationId || item.stationId === query.stationId); });
}
