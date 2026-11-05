import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { data } from "../sim/data";
import {
  advanceWorld,
  createWorld,
  MAX_EVENTS,
  START_TIME,
} from "../sim/engine";
import {
  createSession,
  sessionReducer,
  type SimulationSession,
} from "../sim/session";
import type { WorldState } from "../sim/types";
import {
  decodeReviewFile,
  exportReviewRun,
  verifyRecordingSlice,
} from "./file";
import { advanceRecording, finishRecording, startRecording } from "./recorder";
import { advanceReplayCursor, clampCursor, replayWorld } from "./replay";
import {
  reportMarkdown,
  selectInterestingChains,
  summarizeRun,
} from "./report";
import { REVIEW_MINUTES, type ReviewRun } from "./types";

let fixture: ReviewRun, run: ReviewRun, finalWorld: WorldState;
function completeJob(session: SimulationSession) {
  for (
    let step = 0;
    step < 130 && ["recording", "importing"].includes(session.review.mode);
    step++
  )
    session = sessionReducer(session, { type: "review-step" });
  return session;
}
function makeRun(minutes: number, slice = 15) {
  let recording = startRecording(data, minutes);
  while (recording.elapsedMinutes < minutes)
    recording = advanceRecording(recording, slice);
  return finishRecording(recording);
}
beforeAll(() => {
  fixture = JSON.parse(
    readFileSync(
      new URL("../../public/fixtures/review-run.json", import.meta.url),
      "utf8",
    ),
  );
  let recording = startRecording(fixture.config);
  while (recording.elapsedMinutes < REVIEW_MINUTES)
    recording = advanceRecording(recording);
  run = finishRecording(recording);
  finalWorld = recording.world;
}, 20000);

describe("W4 评审长跑、回放与复盘", () => {
  it("1800 分钟长跑完整捕获事件，密度与 kind 计数一致", () => {
    const summary = summarizeRun(run);
    expect(run.durationMinutes).toBe(1800);
    expect(run.endTime).toBe(START_TIME + 1800);
    expect(run.snapshots).toHaveLength(61);
    expect(run.events.length).toBeGreaterThan(MAX_EVENTS);
    expect(run.events.length).toBe(finalWorld.totalEvents);
    expect(run.events.map((e) => e.id)).toEqual(
      Array.from({ length: run.events.length }, (_, i) => i + 1),
    );
    expect(summary.totalEvents).toBe(run.events.length);
    expect(Object.values(summary.byKind).reduce((a, b) => a + b, 0)).toBe(
      run.events.length,
    );
    expect(summary.byKind.conflict).toBe(
      run.events.filter((e) => e.kind === "conflict").length,
    );
    expect(summary.byKind.rumor).toBe(
      run.events.filter((e) => e.kind === "rumor").length,
    );
    expect(summary.eventsPerGameHour).toBeCloseTo(run.events.length / 30);
    expect(summary.storyEvents).toBe(
      run.events.filter((e) =>
        ["encounter", "conflict", "rumor", "note"].includes(e.kind),
      ).length,
    );
    expect(summary.storyEventsPerGameHour).toBeCloseTo(
      summary.storyEvents / 30,
    );
    expect(summary.byKind.note).toBe(0);
    expect(summary.byKind.meta).toBe(0);
  });
  it("分片大小不改变事件、快照和统计，输入状态不被修改", () => {
    expect(makeRun(120, 1)).toEqual(makeRun(120, 30));
    const original = startRecording(data, 45),
      before = structuredClone(original);
    const next = advanceRecording(original, 15);
    expect(original).toEqual(before);
    expect(next.elapsedMinutes).toBe(15);
    expect(() => finishRecording(next)).toThrow("尚未跑满");
  });
  it("回放游标还原任意分钟，样本演员与记录地点一致", { timeout: 15000 }, () => {
    for (const offset of [0, 1, 29, 30, 31, 97, 1440, 1800]) {
      let expected = createWorld(run.config),
        remaining = offset;
      while (remaining) {
        const count = Math.min(1440, remaining);
        expected = advanceWorld(expected, run.config, count);
        remaining -= count;
      }
      expect(replayWorld(run, offset)).toEqual(expected);
    }
    for (const sample of selectInterestingChains(run)) {
      const world = replayWorld(run, sample.time - run.startTime);
      expect(world.events.some((e) => e.id === sample.anchorId)).toBe(true);
      for (const id of sample.actors) {
        const actor = world.agents.find((a) => a.id === id)!;
        expect(actor.place, `#${sample.anchorId} ${id}`).toBe(sample.place);
        expect(actor.travel).toBeNull();
      }
    }
  });
  it("播放倍率和拖动边界正确，回放不改写当前世界", () => {
    expect(clampCursor(-10, 120)).toBe(0);
    expect(clampCursor(Infinity, 120)).toBe(0);
    expect(advanceReplayCursor(10, 1.5, 2, 120)).toBe(40);
    expect(advanceReplayCursor(110, 2, 8, 120)).toBe(120);
    let session = sessionReducer(createSession(data), {
      type: "tick",
      minutes: 10,
    });
    const live = session.world;
    session = completeJob(
      sessionReducer(session, {
        type: "review-import",
        text: exportReviewRun(makeRun(120)),
      }),
    );
    session = sessionReducer(session, { type: "review-seek", offset: 30 });
    session = sessionReducer(session, { type: "review-speed", speed: 2 });
    session = sessionReducer(session, { type: "review-play" });
    session = sessionReducer(session, { type: "review-tick", seconds: 1.5 });
    expect(session.review.cursor).toBe(60);
    session = sessionReducer(session, { type: "review-play" });
    const paused = session;
    expect(sessionReducer(session, { type: "review-tick", seconds: 10 })).toBe(
      paused,
    );
    session = sessionReducer(session, { type: "review-seek", offset: 99999 });
    expect(session.review.cursor).toBe(120);
    expect(session.world).toBe(live);
    expect(
      sessionReducer(session, {
        type: "note",
        agent: "amin",
        action: "chat",
        place: "park",
        message: "不能写入回放",
      }),
    ).toBe(session);
    session = sessionReducer(session, { type: "review-exit" });
    expect(session.world).toBe(live);
    expect(session.review.mode).toBe("live");
  });
  it(
    "样例局可重算复现，导出后重置导入保留全部记录与选样",
    { timeout: 20000 },
    () => {
      expect(run).toEqual(fixture);
      let session = sessionReducer(createSession(data), {
        type: "tick",
        minutes: 70,
      });
      session = sessionReducer(session, { type: "reset" });
      const live = session.world;
      session = completeJob(
        sessionReducer(session, {
          type: "review-import",
          text: exportReviewRun(run),
        }),
      );
      expect(session.review.mode).toBe("replay");
      expect(session.world).toBe(live);
      expect(session.review.run).toEqual(run);
      expect(selectInterestingChains(session.review.run!)).toEqual(
        selectInterestingChains(run),
      );
      expect(reportMarkdown(session.review.run!)).toBe(reportMarkdown(run));
      expect(replayWorld(session.review.run!, 700)).toEqual(
        replayWorld(run, 700),
      );
    },
  );
  it("错误版本、缺帧和篡改记录拒绝导入，原世界与档案保持", () => {
    const short = makeRun(60),
      valid = completeJob(
        sessionReducer(createSession(data), {
          type: "review-import",
          text: exportReviewRun(short),
        }),
      );
    const mutations: Array<(copy: ReviewRun) => void> = [
      (copy) => {
        copy.schemaVersion = 99;
      },
      (copy) => {
        copy.engineVersion = "future";
      },
      (copy) => {
        copy.snapshots.pop();
      },
      (copy) => {
        copy.events[3].reason = "伪造理由";
      },
      (copy) => {
        copy.snapshots[1].world.agents[0].needs.energy = 999;
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(short);
      mutate(copy);
      const rejected = completeJob(
        sessionReducer(valid, {
          type: "review-import",
          text: JSON.stringify(copy),
        }),
      );
      expect(rejected.world).toBe(valid.world);
      expect(rejected.data).toBe(valid.data);
      expect(rejected.review.run).toBe(valid.review.run);
      expect(rejected.review.feedback).toMatch(/不兼容|不完整|不一致/);
    }
    expect(() => decodeReviewFile("{bad")).toThrow("有效 JSON");
  });
  it("趣味样本确定性排序，链路来自真实事件并优先二跳传闻", () => {
    const selected = selectInterestingChains(run);
    expect(selected).toHaveLength(6);
    expect(
      selected.some(
        (s) =>
          run.events.find((e) => e.id === s.anchorId)?.rumor?.path.length === 3,
      ),
    ).toBe(true);
    expect(new Set(selected.map((s) => s.anchorId)).size).toBe(6);
    expect(
      selectInterestingChains({ ...run, events: [...run.events].reverse() }),
    ).toEqual(selected);
    expect(
      selectInterestingChains({
        ...run,
        events: run.events.map((e) => ({ ...e, text: "替换展示文案" })),
      }),
    ).toEqual(selected);
    for (const sample of selected)
      expect(
        sample.eventIds.every((id) => run.events.some((e) => e.id === id)),
      ).toBe(true);
    for (let i = 1; i < selected.length; i++)
      if (selected[i].score === selected[i - 1].score)
        expect(
          selected[i].time > selected[i - 1].time ||
            (selected[i].time === selected[i - 1].time &&
              selected[i].anchorId > selected[i - 1].anchorId),
        ).toBe(true);
    expect(selectInterestingChains(run, 0)).toHaveLength(0);
  });
  it("长跑暂停可续跑，模式锁阻止时钟、纸条、热改和 Demo 插队", () => {
    const hot = structuredClone(data);
    hot.places.find((p) => p.id === "cafeteria")!.resource!.capacity = 6;
    let session = sessionReducer(createSession(data), {
      type: "apply",
      candidate: hot,
    });
    session = sessionReducer(session, { type: "review-start", minutes: 60 });
    session = sessionReducer(session, { type: "review-step" });
    session = sessionReducer(session, { type: "review-pause-run" });
    expect(session.review.job!.recording.elapsedMinutes).toBe(15);
    expect(sessionReducer(session, { type: "review-step" })).toBe(session);
    expect(sessionReducer(session, { type: "tick", minutes: 8 })).toBe(session);
    expect(sessionReducer(session, { type: "jump", target: 1392 })).toBe(
      session,
    );
    expect(sessionReducer(session, { type: "apply", candidate: data })).toBe(
      session,
    );
    expect(sessionReducer(session, { type: "reset" })).toBe(session);
    session = completeJob(
      sessionReducer(session, { type: "review-pause-run" }),
    );
    expect(
      session.review.run?.config.places.find((p) => p.id === "cafeteria")!
        .resource!.capacity,
    ).toBe(6);
    expect(session.world.time).toBe(START_TIME + 60);
    expect(session.review.mode).toBe("live");
  });
  it("归档全量保留，回放时间线仍受 240 条窗口约束", () => {
    expect(run.events.length).toBeGreaterThan(240);
    expect(replayWorld(run, run.durationMinutes).events).toEqual(
      run.events.slice(-240),
    );
    expect(replayWorld(run, 0).events).toEqual(
      run.events.filter((e) => e.time === START_TIME),
    );
    const candidate = decodeReviewFile(exportReviewRun(run));
    expect(() =>
      verifyRecordingSlice(candidate, startRecording(candidate.config)),
    ).not.toThrow();
  });
  it("关系次数使用真实账本，累计增减与最终关系账本守恒", () => {
    const summary = summarizeRun(run),
      relations = finalWorld.relations;
    const signed = relations.reduce(
      (sum, r) => sum + r.interactionDelta + r.rumorDelta + r.manualDelta,
      0,
    );
    expect(
      summary.relationships.warmingAmount -
        summary.relationships.frictionCoolingAmount,
    ).toBeCloseTo(signed, 7);
    expect(summary.relationships.decayAmount).toBeCloseTo(
      relations.reduce((sum, r) => sum + r.decayTotal, 0),
      7,
    );
    expect(summary.relationships.warmingCount).toBeGreaterThan(0);
    expect(summary.relationships.decayPairMinutes).toBeGreaterThan(
      summary.relationships.frictionCoolingCount,
    );
  });
});
