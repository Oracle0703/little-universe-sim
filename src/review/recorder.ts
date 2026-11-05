import { advanceWorld, createWorld, START_TIME } from "../sim/engine";
import { validateData } from "../sim/data";
import type { WorldData, WorldState } from "../sim/types";
import {
  MAX_REVIEW_EVENTS,
  RECORDING_SLICE,
  REVIEW_ENGINE,
  REVIEW_MINUTES,
  REVIEW_VERSION,
  SNAPSHOT_INTERVAL,
  type RelationshipActivity,
  type ReviewRecording,
  type ReviewRun,
  type ReviewSnapshot,
} from "./types";

const zeroActivity = (): RelationshipActivity => ({
  warmingCount: 0,
  frictionCoolingCount: 0,
  decayPairMinutes: 0,
  warmingAmount: 0,
  frictionCoolingAmount: 0,
  decayAmount: 0,
});
const keyOf = (a: string, b: string) => [a, b].sort().join(":");
function capture(
  world: WorldState,
  offset: number,
  relationships: RelationshipActivity,
): ReviewSnapshot {
  const { events: _events, ...state } = world;
  return {
    offset,
    world: structuredClone(state),
    relationships: { ...relationships },
  };
}
function countRelationships(
  before: WorldState,
  after: WorldState,
  totals: RelationshipActivity,
) {
  const previous = new Map(before.relations.map((r) => [keyOf(r.a, r.b), r]));
  for (const r of after.relations) {
    const old = previous.get(keyOf(r.a, r.b));
    const interaction = r.interactionDelta - (old?.interactionDelta ?? 0);
    const rumor = r.rumorDelta - (old?.rumorDelta ?? 0);
    const manual = r.manualDelta - (old?.manualDelta ?? 0);
    const up =
      Math.max(0, interaction) + Math.max(0, rumor) + Math.max(0, manual);
    const down =
      Math.max(0, -interaction) + Math.max(0, -rumor) + Math.max(0, -manual);
    const decay = r.decayTotal - (old?.decayTotal ?? 0);
    if (up > 1e-9) {
      totals.warmingCount++;
      totals.warmingAmount += up;
    }
    if (down > 1e-9) {
      totals.frictionCoolingCount++;
      totals.frictionCoolingAmount += down;
    }
    if (decay > 1e-9) {
      totals.decayPairMinutes++;
      totals.decayAmount += decay;
    }
  }
}

export function startRecording(
  data: WorldData,
  targetMinutes = REVIEW_MINUTES,
): ReviewRecording {
  validateData(data);
  if (data.agents.length !== 8 || data.places.length !== 6)
    throw new Error("评审局使用 8 位居民、6 个地点。");
  if (
    !Number.isInteger(targetMinutes) ||
    targetMinutes < 1 ||
    targetMinutes > REVIEW_MINUTES
  )
    throw new Error("评审局时长须为 1–1800 游戏分钟。");
  const config = structuredClone(data),
    world = createWorld(config),
    relationships = zeroActivity();
  return {
    config,
    targetMinutes,
    elapsedMinutes: 0,
    world,
    events: [...world.events],
    snapshots: [capture(world, 0, relationships)],
    relationships,
  };
}

/** Each minute goes through the same advanceWorld; capture before its bounded log can roll away. */
export function advanceRecording(
  previous: ReviewRecording,
  minutes = RECORDING_SLICE,
): ReviewRecording {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > REVIEW_MINUTES)
    throw new Error("分片长度须为 1–1800 个整分钟。");
  const count = Math.min(
    minutes,
    previous.targetMinutes - previous.elapsedMinutes,
  );
  if (!count) return previous;
  let world = previous.world;
  const events = [...previous.events],
    snapshots = [...previous.snapshots],
    relationships = { ...previous.relationships };
  for (let i = 1; i <= count; i++) {
    const next = advanceWorld(world, previous.config, 1);
    const emitted = next.events.filter((e) => e.id >= world.nextEventId);
    if (emitted.length !== next.totalEvents - world.totalEvents)
      throw new Error("本分钟事件超过捕获窗口，已停止录制，避免不完整档案。");
    events.push(...emitted);
    if (events.length > MAX_REVIEW_EVENTS)
      throw new Error("本局事件达到归档上限，无法封存为完整局。");
    countRelationships(world, next, relationships);
    world = next;
    const offset = previous.elapsedMinutes + i;
    if (offset % SNAPSHOT_INTERVAL === 0 || offset === previous.targetMinutes)
      snapshots.push(capture(world, offset, relationships));
  }
  return {
    ...previous,
    elapsedMinutes: previous.elapsedMinutes + count,
    world,
    events,
    snapshots,
    relationships,
  };
}

export function finishRecording(recording: ReviewRecording): ReviewRun {
  if (recording.elapsedMinutes !== recording.targetMinutes)
    throw new Error("本局尚未跑满，不能导出完整评审局。");
  return {
    schemaVersion: REVIEW_VERSION,
    engineVersion: REVIEW_ENGINE,
    config: recording.config,
    durationMinutes: recording.targetMinutes,
    startTime: START_TIME,
    endTime: recording.world.time,
    snapshotInterval: SNAPSHOT_INTERVAL,
    events: recording.events,
    snapshots: recording.snapshots,
  };
}
