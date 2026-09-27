import { randomUUID } from 'node:crypto';
import type { Observation, QualityReport, Station } from './types.js';

export const stations: Station[] = [
  { id: 'st-001', code: 'QZ-A01', name: '青岚台站', region: '川西断裂带', elevationM: 1840, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-002', code: 'QZ-B07', name: '白石台站', region: '龙门山南段', elevationM: 920, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-003', code: 'QZ-C12', name: '岷江台站', region: '岷江河谷', elevationM: 2470, status: 'maintenance', lastSeenAt: new Date().toISOString() }
];
export const observations: Observation[] = [];
export const reports: QualityReport[] = [];

export type ObservationInput = {
  stationId: string;
  observedAt?: string;
  samples: number;
  sampleRateHz: number;
  peakAmplitude: number;
  timingOffsetMs: number;
};

// 实时观测与断网补传观测统一走 ingestObservation，结果区分：
// - duplicate：重复观测（同站同观测时刻），未重复入库，台站状态不变
// - fresh：新观测且时刻更新，已推进 lastSeenAt（非维护台站同时转 online）
// - late：迟到/补传的旧观测，已入库但不回滚 lastSeenAt、不改在线状态
// - maintained：维护期间收到的新观测，数据入库且 lastSeenAt 照常推进，但维持 maintenance
export type IngestResult =
  | { kind: 'duplicate'; observation: Observation }
  | { kind: 'fresh'; observation: Observation }
  | { kind: 'late'; observation: Observation }
  | { kind: 'maintained'; observation: Observation };

function evaluateQuality(input: ObservationInput) {
  const issues: string[] = [];
  if (input.samples < input.sampleRateHz * 30) issues.push('采样窗口不足');
  if (input.peakAmplitude > 0.95) issues.push('波形削顶风险');
  if (Math.abs(input.timingOffsetMs) > 5) issues.push('时间同步偏差');
  const qualityScore = Math.max(0, Math.round(100 - issues.length * 22 - Math.min(Math.abs(input.timingOffsetMs), 20)));
  return { qualityScore, issues };
}

export function ingestObservation(input: ObservationInput): IngestResult {
  // 归一化为 UTC ISO，避免同一时刻因时区写法不同（如 +08:00 与 Z）被判成两条记录。
  const observedAt = new Date(input.observedAt ?? Date.now()).toISOString();
  const observedAtMs = Date.parse(observedAt);

  // 规则一：同一台站 + 同一观测时刻视为同一观测，幂等返回，不重复入库、不动台站状态。
  // 实时流与断网补传交错到达时，先到的记录为准。
  const existing = observations.find(
    item => item.stationId === input.stationId && Date.parse(item.observedAt) === observedAtMs
  );
  if (existing) return { kind: 'duplicate', observation: existing };

  const station = stations.find(item => item.id === input.stationId);
  if (!station) throw new Error(`台站不存在: ${input.stationId}`);

  const { qualityScore, issues } = evaluateQuality(input);
  const observation: Observation = {
    id: randomUUID(),
    stationId: input.stationId,
    observedAt,
    samples: input.samples,
    sampleRateHz: input.sampleRateHz,
    peakAmplitude: input.peakAmplitude,
    timingOffsetMs: input.timingOffsetMs,
    qualityScore,
    issues
  };
  observations.push(observation);

  // 规则二：lastSeenAt 单调推进，只有更新的 observedAt 才能覆盖；迟到/补传旧数据不回滚。
  const isFresh = observedAtMs > Date.parse(station.lastSeenAt);
  if (isFresh) station.lastSeenAt = observedAt;

  // 规则三：maintenance 是管理态，维护期收到观测只记录数据，不自动转 online。
  if (station.status === 'maintenance') return { kind: 'maintained', observation };

  // 规则四：非维护台站只有收到更新的观测才证明存活，转 online；迟到旧数据不改状态。
  if (isFresh) {
    station.status = 'online';
    return { kind: 'fresh', observation };
  }
  return { kind: 'late', observation };
}

export function createReport(stationId: string, start: string, end: string): QualityReport {
  // 数值比较窗口边界，与观测入库时的 UTC 归一化保持一致，不受时区写法影响。
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const rows = observations.filter(item => {
    if (item.stationId !== stationId) return false;
    const t = Date.parse(item.observedAt);
    return t >= startMs && t <= endMs;
  });
  const averageScore = rows.length ? Math.round(rows.reduce((sum, item) => sum + item.qualityScore, 0) / rows.length) : 0;
  const issues = [...new Set(rows.flatMap(item => item.issues))];
  const report = { id: randomUUID(), stationId, windowStart: start, windowEnd: end, observationCount: rows.length, averageScore, issues, generatedAt: new Date().toISOString() };
  reports.push(report); return report;
}
