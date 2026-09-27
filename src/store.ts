import { randomUUID } from 'node:crypto';
import type { Observation, QualityReport, Station } from './types.js';

export const stations: Station[] = [
  { id: 'st-001', code: 'QZ-A01', name: '青岚台站', region: '川西断裂带', elevationM: 1840, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-002', code: 'QZ-B07', name: '白石台站', region: '龙门山南段', elevationM: 920, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-003', code: 'QZ-C12', name: '岷江台站', region: '岷江河谷', elevationM: 2470, status: 'maintenance', lastSeenAt: new Date().toISOString() }
];
export const observations: Observation[] = [];
export const reports: QualityReport[] = [];

/**
 * 统一台站状态规则：实时、补传（迟到）、维护期间的观测都走同一套逻辑，
 * 保证台站档案、后续接入和质量报告看到一致结果。
 * - lastSeenAt 只随更新的观测单调前进，迟到的旧观测不回退；
 * - offline 台站仅在收到“最新”观测（不早于已知 lastSeenAt）时恢复 online；
 * - maintenance 是人工管理状态，观测接入不自动改变它。
 */
export function applyObservationToStation(station: Station, observedAt: string): void {
  const observedTs = Date.parse(observedAt);
  const lastSeenTs = Date.parse(station.lastSeenAt);
  const isLatest = observedTs >= lastSeenTs;
  if (observedTs > lastSeenTs) station.lastSeenAt = observedAt;
  if (isLatest && station.status === 'offline') station.status = 'online';
}

/** 重复观测判定：同台站、同一观测时刻（按时间戳比较，容忍 ISO 格式差异）视为重复。 */
export function findDuplicateObservation(stationId: string, observedAt: string): Observation | undefined {
  const observedTs = Date.parse(observedAt);
  return observations.find(item => item.stationId === stationId && Date.parse(item.observedAt) === observedTs);
}
export function createReport(stationId: string, start: string, end: string): QualityReport {
  const rows = observations.filter(item => item.stationId === stationId && item.observedAt >= start && item.observedAt <= end);
  const averageScore = rows.length ? Math.round(rows.reduce((sum, item) => sum + item.qualityScore, 0) / rows.length) : 0;
  const issues = [...new Set(rows.flatMap(item => item.issues))];
  const report = { id: randomUUID(), stationId, windowStart: start, windowEnd: end, observationCount: rows.length, averageScore, issues, generatedAt: new Date().toISOString() };
  reports.push(report); return report;
}
