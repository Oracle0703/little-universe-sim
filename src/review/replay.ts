import { advanceWorld, MAX_EVENTS } from "../sim/engine";
import type { WorldState } from "../sim/types";
import { REPLAY_MINUTES_PER_SECOND, type ReviewRun } from "./types";

export function clampCursor(offset: number, duration: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(duration, offset));
}
export function advanceReplayCursor(
  offset: number,
  seconds: number,
  speed: number,
  duration: number,
): number {
  if (!Number.isFinite(seconds) || seconds < 0 || ![1, 2, 8].includes(speed))
    return clampCursor(offset, duration);
  return clampCursor(
    offset + seconds * REPLAY_MINUTES_PER_SECOND * speed,
    duration,
  );
}
export function replayWorld(run: ReviewRun, cursor: number): WorldState {
  const offset = Math.floor(clampCursor(cursor, run.durationMinutes));
  let snapshot = run.snapshots[0];
  for (const next of run.snapshots) {
    if (next.offset > offset) break;
    snapshot = next;
  }
  const events = run.events
    .filter((e) => e.time <= snapshot.world.time)
    .slice(-MAX_EVENTS);
  const world: WorldState = {
    ...structuredClone(snapshot.world),
    events: structuredClone(events),
  };
  return advanceWorld(world, run.config, offset - snapshot.offset);
}
