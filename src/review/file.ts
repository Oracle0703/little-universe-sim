import { validateData } from "../sim/data";
import { START_TIME } from "../sim/engine";
import type { WorldData } from "../sim/types";
import {
  MAX_REVIEW_BYTES,
  MAX_REVIEW_EVENTS,
  REVIEW_ENGINE,
  REVIEW_MINUTES,
  REVIEW_VERSION,
  SNAPSHOT_INTERVAL,
  type ReviewRecording,
  type ReviewRun,
} from "./types";

export interface ReviewCandidate {
  config: WorldData;
  durationMinutes: number;
  events: unknown[];
  snapshots: unknown[];
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Imported runtime snapshots are never trusted or rendered before regeneration matches them. */
export function decodeReviewFile(text: string): ReviewCandidate {
  if (new TextEncoder().encode(text).byteLength > MAX_REVIEW_BYTES)
    throw new Error("局文件超过 16 MB 上限。");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("局文件不是有效 JSON。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("局文件须为对象。");
  const root = value as Record<string, unknown>;
  if (
    root.schemaVersion !== REVIEW_VERSION ||
    root.engineVersion !== REVIEW_ENGINE
  )
    throw new Error(
      `局文件版本不兼容，需要 schema ${REVIEW_VERSION} / ${REVIEW_ENGINE}。`,
    );
  const keys = [
    "schemaVersion",
    "engineVersion",
    "config",
    "durationMinutes",
    "startTime",
    "endTime",
    "snapshotInterval",
    "events",
    "snapshots",
  ];
  if (
    Object.keys(root).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(root, key))
  )
    throw new Error("局文件字段缺失或包含未知字段。");
  validateData(root.config);
  const minutes = root.durationMinutes;
  if (
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > REVIEW_MINUTES
  )
    throw new Error("局时长须为 1–1800 游戏分钟。");
  if (
    root.startTime !== START_TIME ||
    root.endTime !== START_TIME + minutes ||
    root.snapshotInterval !== SNAPSHOT_INTERVAL
  )
    throw new Error("局文件的起止时间或快照间隔不正确。");
  if (
    !Array.isArray(root.events) ||
    root.events.length < 1 ||
    root.events.length > MAX_REVIEW_EVENTS
  )
    throw new Error("局文件事件数量无效。");
  if (
    !Array.isArray(root.snapshots) ||
    root.snapshots.length !== Math.ceil(minutes / SNAPSHOT_INTERVAL) + 1
  )
    throw new Error("局文件快照数量不完整。");
  return {
    config: structuredClone(root.config),
    durationMinutes: minutes,
    events: root.events,
    snapshots: root.snapshots,
  };
}

export function verifyRecordingSlice(
  candidate: ReviewCandidate,
  after: ReviewRecording,
  beforeEvents = 0,
  beforeSnapshots = 0,
) {
  if (
    !equal(
      candidate.events.slice(beforeEvents, after.events.length),
      after.events.slice(beforeEvents),
    )
  )
    throw new Error(
      `局文件事件与真实模拟不一致（第 ${after.elapsedMinutes} 分钟）。`,
    );
  if (
    !equal(
      candidate.snapshots.slice(beforeSnapshots, after.snapshots.length),
      after.snapshots.slice(beforeSnapshots),
    )
  )
    throw new Error(
      `局文件快照与真实模拟不一致（第 ${after.elapsedMinutes} 分钟）。`,
    );
  if (
    after.elapsedMinutes === after.targetMinutes &&
    (candidate.events.length !== after.events.length ||
      candidate.snapshots.length !== after.snapshots.length)
  )
    throw new Error("局文件包含遗漏或多余记录。");
}
export function exportReviewRun(run: ReviewRun): string {
  const text = JSON.stringify(run);
  if (new TextEncoder().encode(text).byteLength > MAX_REVIEW_BYTES)
    throw new Error("局文件超过 16 MB 上限。");
  return text;
}
