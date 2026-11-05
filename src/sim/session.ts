import {
  advanceTo,
  advanceWorld,
  applyConfiguration,
  createWorld,
  giveNote,
} from "./engine";
import type { Action, WorldData, WorldState } from "./types";
import {
  emptyReview,
  isReviewAction,
  reduceReview,
  reviewLocked,
  type ReviewAction,
  type ReviewState,
} from "../review/state";

export interface SimulationSession {
  data: WorldData;
  world: WorldState;
  revision: number;
  runId: number;
  feedback: { kind: "success" | "error"; message: string } | null;
  review: ReviewState;
}
export type SessionAction =
  | { type: "tick"; minutes: number }
  | { type: "jump"; target: number }
  | {
      type: "note";
      agent: string;
      action: Action;
      place: string;
      message: string;
    }
  | { type: "reset" }
  | { type: "apply"; candidate: unknown }
  | ReviewAction;

export function createSession(data: WorldData): SimulationSession {
  const current = structuredClone(data);
  return {
    data: current,
    world: createWorld(current),
    revision: 0,
    runId: 0,
    feedback: null,
    review: emptyReview(),
  };
}

/** Clock, notes and hot edits all transition the same atomic data/world pair. */
export function sessionReducer(
  session: SimulationSession,
  action: SessionAction,
): SimulationSession {
  if (isReviewAction(action)) return reduceReview(session, action);
  if (reviewLocked(session.review)) return session;
  try {
    switch (action.type) {
      case "tick":
        return {
          ...session,
          world: advanceWorld(session.world, session.data, action.minutes),
        };
      case "jump":
        return {
          ...session,
          feedback: null,
          world: advanceTo(session.world, session.data, action.target),
        };
      case "note":
        return {
          ...session,
          feedback: null,
          world: giveNote(
            session.world,
            session.data,
            action.agent,
            action.action,
            action.place,
            action.message,
          ),
        };
      case "reset":
        return {
          ...session,
          world: createWorld(session.data),
          runId: session.runId + 1,
          feedback: null,
        };
      case "apply":
        try {
          const result = applyConfiguration(
            session.world,
            session.data,
            action.candidate,
          );
          return {
            ...session,
            data: result.data,
            world: result.world,
            revision: session.revision + 1,
            feedback: {
              kind: "success",
              message: `已应用版本 ${session.revision + 1}：${result.changes.length} 项变更。时间、纸条及未修改的运行状态已保留。`,
            },
          };
        } catch (error) {
          return {
            ...session,
            feedback: {
              kind: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "配置应用失败，世界未改变。",
            },
          };
        }
    }
  } catch (error) {
    return {
      ...session,
      feedback: {
        kind: "error",
        message: `操作未生效，世界保持原状：${error instanceof Error ? error.message : "模拟操作失败"}`,
      },
    };
  }
}
