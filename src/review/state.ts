import type { SimulationSession } from "../sim/session";
import {
  decodeReviewFile,
  verifyRecordingSlice,
  type ReviewCandidate,
} from "./file";
import { advanceRecording, finishRecording, startRecording } from "./recorder";
import { advanceReplayCursor, clampCursor } from "./replay";
import type { ReviewRecording, ReviewRun } from "./types";

export interface ReviewState {
  mode: "live" | "recording" | "recording-paused" | "importing" | "replay";
  job: {
    recording: ReviewRecording;
    candidate: ReviewCandidate | null;
    returnTo: "live" | "replay";
  } | null;
  run: ReviewRun | null;
  cursor: number;
  playing: boolean;
  speed: 1 | 2 | 8;
  serial: number;
  focusEventId: number | null;
  feedback: string;
}
export type ReviewAction =
  | { type: "review-start"; minutes: number }
  | { type: "review-step" }
  | { type: "review-pause-run" }
  | { type: "review-abort" }
  | { type: "review-import"; text: string }
  | { type: "review-seek"; offset: number; eventId?: number }
  | { type: "review-play" }
  | { type: "review-speed"; speed: 1 | 2 | 8 }
  | { type: "review-tick"; seconds: number }
  | { type: "review-exit" };
export const emptyReview = (): ReviewState => ({
  mode: "live",
  job: null,
  run: null,
  cursor: 0,
  playing: false,
  speed: 1,
  serial: 0,
  focusEventId: null,
  feedback: "",
});
export function isReviewAction(action: {
  type: string;
}): action is ReviewAction {
  return action.type.startsWith("review-");
}
export const reviewLocked = (review: ReviewState) => review.mode !== "live";

export function reduceReview(
  session: SimulationSession,
  action: ReviewAction,
): SimulationSession {
  const r = session.review;
  const update = (review: ReviewState) => ({ ...session, review });
  const busy = ["recording", "recording-paused", "importing"].includes(r.mode);
  switch (action.type) {
    case "review-start": {
      if (r.mode !== "live")
        return update({
          ...r,
          feedback: "请先结束当前操作或退出回放，再开始新局。",
        });
      try {
        const recording = startRecording(session.data, action.minutes);
        return {
          ...session,
          world: recording.world,
          runId: session.runId + 1,
          feedback: null,
          review: {
            ...emptyReview(),
            serial: r.serial,
            mode: "recording",
            job: { recording, candidate: null, returnTo: "live" },
            feedback: "已锁定开始时的配置，新局正在按真实 tick 推进。",
          },
        };
      } catch (error) {
        return update({
          ...r,
          feedback: error instanceof Error ? error.message : "无法开始评审局。",
        });
      }
    }
    case "review-import": {
      if (busy)
        return update({
          ...r,
          feedback: "请先完成或放弃正在进行的长跑，再导入局文件。",
        });
      try {
        const candidate = decodeReviewFile(action.text),
          recording = startRecording(
            candidate.config,
            candidate.durationMinutes,
          );
        verifyRecordingSlice(candidate, recording);
        return update({
          ...r,
          mode: "importing",
          playing: false,
          job: {
            recording,
            candidate,
            returnTo: r.mode === "replay" ? "replay" : "live",
          },
          feedback: "正在分片重算，核对事件和快照；不会覆盖当前世界。",
        });
      } catch (error) {
        return update({
          ...r,
          playing: false,
          feedback:
            error instanceof Error
              ? error.message
              : "局文件导入失败，原世界和档案保持不变。",
        });
      }
    }
    case "review-step": {
      if (!r.job || !["recording", "importing"].includes(r.mode))
        return session;
      try {
        const before = r.job.recording,
          recording = advanceRecording(before);
        if (r.job.candidate)
          verifyRecordingSlice(
            r.job.candidate,
            recording,
            before.events.length,
            before.snapshots.length,
          );
        const next = r.job.candidate
          ? session
          : { ...session, world: recording.world };
        if (recording.elapsedMinutes < recording.targetMinutes)
          return { ...next, review: { ...r, job: { ...r.job, recording } } };
        const run = finishRecording(recording);
        return {
          ...next,
          review: {
            ...r,
            mode: r.job.candidate ? "replay" : "live",
            job: null,
            run,
            cursor: 0,
            playing: false,
            serial: r.serial + 1,
            focusEventId: null,
            feedback: r.job.candidate
              ? "局文件已通过真实模拟核对，可完整回放。退出回放会回到导入前的世界。"
              : "长跑完成，世界已停在终点。本局已封存；继续旁观不会修改本局记录。",
          },
        };
      } catch (error) {
        return update({
          ...r,
          mode: r.job.returnTo,
          job: null,
          playing: false,
          feedback:
            error instanceof Error
              ? error.message
              : "评审处理失败，未发布不完整档案。",
        });
      }
    }
    case "review-pause-run":
      if (r.mode !== "recording" && r.mode !== "recording-paused")
        return session;
      return update({
        ...r,
        mode: r.mode === "recording" ? "recording-paused" : "recording",
      });
    case "review-abort":
      if (!busy) return session;
      return update({
        ...r,
        mode: r.job?.returnTo ?? "live",
        job: null,
        playing: false,
        feedback: "已停止本次处理，未导出不完整记录。",
      });
    case "review-seek": {
      if (!r.run || busy) return session;
      const event = r.run.events.find((e) => e.id === action.eventId);
      const cursor = event ? event.time - r.run.startTime : action.offset;
      return update({
        ...r,
        mode: "replay",
        playing: false,
        cursor: Math.floor(clampCursor(cursor, r.run.durationMinutes)),
        focusEventId: event?.id ?? null,
      });
    }
    case "review-play":
      if (!r.run || busy) return session;
      return update({
        ...r,
        mode: "replay",
        playing: !r.playing,
        cursor: r.cursor >= r.run.durationMinutes ? 0 : r.cursor,
      });
    case "review-speed":
      return [1, 2, 8].includes(action.speed)
        ? update({ ...r, speed: action.speed })
        : session;
    case "review-tick": {
      if (r.mode !== "replay" || !r.playing || !r.run) return session;
      const cursor = advanceReplayCursor(
        r.cursor,
        action.seconds,
        r.speed,
        r.run.durationMinutes,
      );
      return update({
        ...r,
        cursor,
        playing: cursor < r.run.durationMinutes,
        focusEventId: null,
      });
    }
    case "review-exit":
      return r.mode === "replay"
        ? update({ ...r, mode: "live", playing: false, focusEventId: null })
        : session;
  }
}
