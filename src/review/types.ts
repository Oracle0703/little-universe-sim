import type {
  EventKind,
  WorldData,
  WorldEvent,
  WorldState,
} from "../sim/types";

export const REVIEW_VERSION = 1;
export const REVIEW_ENGINE = "little-universe-w4.2";
export const REVIEW_MINUTES = 1800;
export const SNAPSHOT_INTERVAL = 30;
export const RECORDING_SLICE = 15;
export const MAX_REVIEW_BYTES = 16 * 1024 * 1024;
export const MAX_REVIEW_EVENTS = 30000;
export const REPLAY_MINUTES_PER_SECOND = 10;

export interface RelationshipActivity {
  warmingCount: number;
  frictionCoolingCount: number;
  decayPairMinutes: number;
  warmingAmount: number;
  frictionCoolingAmount: number;
  decayAmount: number;
}
export interface ReviewSnapshot {
  offset: number;
  world: Omit<WorldState, "events">;
  relationships: RelationshipActivity;
}
export interface ReviewRun {
  schemaVersion: number;
  engineVersion: string;
  config: WorldData;
  durationMinutes: number;
  startTime: number;
  endTime: number;
  snapshotInterval: number;
  events: WorldEvent[];
  snapshots: ReviewSnapshot[];
}
export interface ReviewRecording {
  config: WorldData;
  targetMinutes: number;
  elapsedMinutes: number;
  world: WorldState;
  events: WorldEvent[];
  snapshots: ReviewSnapshot[];
  relationships: RelationshipActivity;
}
export interface InterestingChain {
  id: string;
  category: string;
  title: string;
  score: number;
  anchorId: number;
  time: number;
  actors: string[];
  place: string;
  eventIds: number[];
  reason: string;
}
export interface ReviewSummary {
  durationMinutes: number;
  gameDays: number;
  totalEvents: number;
  byKind: Record<EventKind, number>;
  eventsPerGameHour: number;
  storyEvents: number;
  storyEventsPerGameHour: number;
  relationships: RelationshipActivity & {
    netWarmedPairs: number;
    netCooledPairs: number;
  };
}
