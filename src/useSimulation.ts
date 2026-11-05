import { useEffect, useMemo, useReducer, useState } from "react";
import { data as initialData } from "./sim/data";
import { createSession, sessionReducer } from "./sim/session";
import type { Action } from "./sim/types";
import { reviewLocked } from "./review/state";
import { replayWorld } from "./review/replay";
import { REVIEW_MINUTES } from "./review/types";

export type Speed = 1 | 2 | 8;
export function useSimulation() {
  const [session, dispatch] = useReducer(
    sessionReducer,
    initialData,
    createSession,
  );
  const [speed, setSpeed] = useState<Speed>(1);
  const [paused, setPaused] = useState(false);
  const [clockVersion, setClockVersion] = useState(0);
  const locked = reviewLocked(session.review);
  useEffect(() => {
    if (paused || locked) return;
    let previous = performance.now(),
      accumulated = 0;
    const timer = window.setInterval(() => {
      const now = performance.now();
      accumulated += (now - previous) * speed;
      previous = now;
      const elapsed = Math.floor(accumulated / 1000);
      if (elapsed > 0) {
        accumulated -= elapsed * 1000;
        // Browser background throttling is reconciled on wake, bounded to 12 game hours.
        dispatch({ type: "tick", minutes: Math.min(elapsed, 720) });
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [speed, paused, clockVersion, locked]);
  useEffect(() => {
    if (!["recording", "importing"].includes(session.review.mode)) return;
    const timer = window.setTimeout(
      () => dispatch({ type: "review-step" }),
      40,
    );
    return () => window.clearTimeout(timer);
  }, [session.review.mode, session.review.job?.recording.elapsedMinutes]);
  useEffect(() => {
    if (session.review.mode !== "replay" || !session.review.playing) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      dispatch({ type: "review-tick", seconds: (now - previous) / 1000 });
      previous = now;
    }, 100);
    return () => window.clearInterval(timer);
  }, [session.review.mode, session.review.playing, session.review.speed]);
  const frame = Math.floor(session.review.cursor);
  const displayWorld = useMemo(
    () =>
      session.review.mode === "replay" && session.review.run
        ? replayWorld(session.review.run, frame)
        : session.world,
    [session.review.mode, session.review.run, frame, session.world],
  );
  const displayData =
    session.review.mode === "replay" && session.review.run
      ? session.review.run.config
      : ["recording", "recording-paused"].includes(session.review.mode) &&
          session.review.job
        ? session.review.job.recording.config
        : session.data;
  const reset = () => {
    dispatch({ type: "reset" });
    setSpeed(1);
    setPaused(false);
    setClockVersion((v) => v + 1);
  };
  const jumpTo = (target: number) => {
    setPaused(true);
    setClockVersion((v) => v + 1);
    dispatch({ type: "jump", target });
  };
  const note = (
    agentId: string,
    action: Action,
    place: string,
    message: string,
  ) => {
    dispatch({ type: "note", agent: agentId, action, place, message });
  };
  const applyData = (candidate: unknown) =>
    dispatch({ type: "apply", candidate });
  const startReview = (minutes = REVIEW_MINUTES) => {
    setPaused(true);
    dispatch({ type: "review-start", minutes });
  };
  const importReview = (text: string) => {
    setPaused(true);
    dispatch({ type: "review-import", text });
  };
  const seekReview = (offset: number, eventId?: number) => {
    setPaused(true);
    dispatch({ type: "review-seek", offset, eventId });
  };
  return {
    ...session,
    world: displayWorld,
    data: displayData,
    liveData: session.data,
    reviewLocked: locked,
    speed,
    setSpeed,
    paused,
    setPaused,
    reset,
    jumpTo,
    note,
    applyData,
    startReview,
    importReview,
    seekReview,
    pauseReviewRun: () => dispatch({ type: "review-pause-run" }),
    abortReview: () => dispatch({ type: "review-abort" }),
    playReview: () => {
      setPaused(true);
      dispatch({ type: "review-play" });
    },
    setReplaySpeed: (value: Speed) =>
      dispatch({ type: "review-speed", speed: value }),
    exitReview: () => {
      setPaused(true);
      dispatch({ type: "review-exit" });
    },
  };
}
