import { describe, expect, it } from "vitest";
import { data } from "./data";
import {
  applyConfiguration,
  advanceWorld,
  createWorld,
  giveNote,
  MAX_EVENTS,
} from "./engine";
import { exportConfiguration, parseConfiguration } from "./configuration";
import { createSession, sessionReducer } from "./session";
import type { WorldState } from "./types";

const pair = (world: WorldState, a: string, b: string) =>
  world.relations.find(
    (r) => [r.a, r.b].includes(a) && [r.a, r.b].includes(b),
  )!;
const capacity = (value: number) => {
  const next = structuredClone(data);
  next.places.find((p) => p.id === "cafeteria")!.resource!.capacity = value;
  return next;
};
function rumorSession() {
  const input = structuredClone(data),
    ids = ["amin", "ake", "lin", "tang"];
  input.agents = input.agents.filter((a) => ids.includes(a.id));
  input.places.find((p) => p.id === "park")!.resource!.capacity = 4;
  for (const a of input.agents) {
    a.initialPlace = "park";
    a.needs = { energy: 80, social: 50, mood: 80 };
    a.schedule = [
      {
        start: "00:00",
        end: "23:59",
        action: a.id === "ake" ? "sketch" : "chat",
        place: "park",
      },
    ];
  }
  input.relations = [
    { a: "lin", b: "ake", label: "观众", value: 80 },
    { a: "lin", b: "tang", label: "熟人", value: 75 },
    { a: "tang", b: "amin", label: "熟人", value: 75 },
  ];
  let session = createSession(input);
  for (const a of session.world.agents)
    for (const b of session.world.agents)
      if (
        a.id !== b.id &&
        ![a.id, b.id].every((id) => ["ake", "lin"].includes(id))
      )
        session.world.pairCooldowns[[a.id, b.id].sort().join(":")] =
          session.world.time;
  session = sessionReducer(session, { type: "tick", minutes: 8 });
  expect(
    session.world.events
      .filter((e) => e.kind === "rumor")
      .map((e) => e.rumor!.path),
  ).toEqual([["lin", "tang"]]);
  return session;
}

describe("W3 当前世界热改", () => {
  it("容量热改立即释放等位，之后的 tick 读取新配置并减少冲突", () => {
    const before = advanceWorld(createWorld(data), data, 32),
      snapshot = structuredClone(before);
    const result = applyConfiguration(before, data, capacity(6));
    expect(result.world.time).toBe(before.time);
    expect(
      result.world.agents.filter(
        (a) => a.place === "cafeteria" && a.hasResource,
      ),
    ).toHaveLength(6);
    expect(
      result.world.agents.filter(
        (a) => a.place === "cafeteria" && a.waitingSince !== null,
      ),
    ).toHaveLength(0);
    expect(result.world.events.at(-1)).toMatchObject({
      kind: "meta",
      edit: { author: "本页策划" },
    });
    expect(result.world.events.at(-1)!.reason).toContain("食堂 · 容量：2 → 6");
    expect(before).toEqual(snapshot);
    const start = sessionReducer(createSession(data), {
      type: "tick",
      minutes: 19,
    });
    const edited = sessionReducer(start, {
      type: "apply",
      candidate: capacity(6),
    });
    const after = sessionReducer(edited, { type: "tick", minutes: 15 });
    const control = sessionReducer(start, { type: "tick", minutes: 15 });
    const conflicts = (w: WorldState) =>
      w.events.filter(
        (e) => e.time > start.world.time && e.conflict?.type === "resource",
      ).length;
    expect(conflicts(after.world)).toBeLessThan(conflicts(control.world));
  });
  it("缩容不超占，重复应用不会重复扣等位心情", () => {
    const expanded = capacity(6);
    const before = advanceWorld(createWorld(expanded), expanded, 32);
    const result = applyConfiguration(before, expanded, capacity(1));
    expect(
      result.world.agents.filter(
        (a) => a.place === "cafeteria" && a.hasResource,
      ),
    ).toHaveLength(1);
    const again = applyConfiguration(result.world, result.data, result.data);
    expect(again.world.agents.map((a) => a.needs)).toEqual(
      result.world.agents.map((a) => a.needs),
    );
    expect(again.world.events.filter((e) => e.kind === "conflict").length).toBe(
      result.world.events.filter((e) => e.kind === "conflict").length,
    );
  });
  it("作息、性格、偏好和需求热改生效，未编辑状态不重置", () => {
    const before = advanceWorld(createWorld(data), data, 5),
      next = structuredClone(data);
    next.agents[0].schedule[1] = {
      start: "10:30",
      end: "12:00",
      action: "walk",
      place: "park",
    };
    next.agents[0].tags = ["安静", "愿意散步"];
    next.agents[0].traits.sociability = 1;
    next.agents[0].favorite = { action: "walk", place: "park" };
    next.agents[0].needs.mood = 50;
    const result = applyConfiguration(before, data, next);
    expect(result.world.agents[0].needs.energy).toBe(
      before.agents[0].needs.energy,
    );
    expect(result.world.agents[0].needs.mood).toBe(50);
    expect(result.world.agents[0].place).toBe(before.agents[0].place);
    const after = advanceWorld(result.world, result.data, 1);
    expect(after.agents[0].goal).toMatchObject({
      action: "walk",
      place: "park",
    });
    expect(after.agents[0].travel).toMatchObject({
      from: "office",
      to: "park",
    });
    expect(after.agents[0].needs.social).toBeCloseTo(
      result.world.agents[0].needs.social - 0.14,
    );
  });
  it("关系 value 和描述热改单独记账，相同配置重应用保留自然变化", () => {
    let session = sessionReducer(createSession(data), {
      type: "tick",
      minutes: 120,
    });
    const changed = structuredClone(session.data);
    changed.relations[0].value = 90;
    changed.relations[0].label = "策划试验关系";
    const previous = pair(session.world, "amin", "zhou");
    session = sessionReducer(session, { type: "apply", candidate: changed });
    const current = pair(session.world, "amin", "zhou");
    expect(current.value).toBe(90);
    expect(current.label).toBe("策划试验关系");
    expect(current.manualDelta).toBeCloseTo(90 - previous.value);
    expect(current.value).toBeCloseTo(
      current.initialValue +
        current.interactionDelta +
        current.rumorDelta +
        current.manualDelta -
        current.decayTotal,
    );
    session = sessionReducer(session, { type: "tick", minutes: 100 });
    const evolved = structuredClone(session.world.relations);
    session = sessionReducer(session, { type: "apply", candidate: changed });
    expect(session.world.relations).toEqual(evolved);
  });
  it("热改衰减率后按新速率推进，计时器 reducer 无旧配置闭包", () => {
    const sleeping = structuredClone(data);
    for (const a of sleeping.agents) {
      a.initialPlace = a.home;
      a.schedule = [
        { start: "00:00", end: "23:59", action: "sleep", place: a.home },
      ];
    }
    let session = sessionReducer(createSession(sleeping), {
      type: "tick",
      minutes: 120,
    });
    const next = structuredClone(session.data);
    next.rules.relationships.decayPerHour = 6;
    next.rules.relationships.closeMultiplier = 1;
    session = sessionReducer(session, { type: "apply", candidate: next });
    const value = pair(session.world, "amin", "qiao").value;
    session = sessionReducer(session, { type: "tick", minutes: 60 });
    expect(pair(session.world, "amin", "qiao").value).toBeCloseTo(value - 6, 8);
  });
  it("热改传闻跳数与冷却约束现存消息，已有听闻不会撤回或重复加分", () => {
    const start = rumorSession(),
      oneHop = structuredClone(start.data);
    oneHop.rules.rumors.maxHops = 1;
    const applied = sessionReducer(start, { type: "apply", candidate: oneHop });
    expect(applied.world.rumors[0].receipts).toEqual(
      start.world.rumors[0].receipts,
    );
    const stopped = sessionReducer(applied, { type: "tick", minutes: 22 });
    const original = sessionReducer(start, { type: "tick", minutes: 22 });
    expect(stopped.world.events.filter((e) => e.kind === "rumor")).toHaveLength(
      1,
    );
    expect(
      original.world.events.some(
        (e) => e.rumor?.path.join(":") === "lin:tang:amin",
      ),
    ).toBe(true);
    const cooled = structuredClone(start.data);
    cooled.rules.rumors.broadcastCooldownMinutes = 60;
    const delayed = sessionReducer(
      sessionReducer(start, { type: "apply", candidate: cooled }),
      { type: "tick", minutes: 22 },
    );
    expect(delayed.world.events.filter((e) => e.kind === "rumor")).toHaveLength(
      1,
    );
    expect(pair(stopped.world, "tang", "ake").rumorDelta).toBe(1);
  });
  it("导出 JSON 可粘贴导入并再次应用，导出不夹带进度", () => {
    let session = sessionReducer(createSession(data), {
      type: "apply",
      candidate: capacity(6),
    });
    const serialized = exportConfiguration(session.data);
    const imported = parseConfiguration(serialized);
    expect(Object.keys(imported).sort()).toEqual([
      "agents",
      "places",
      "relations",
      "rules",
    ]);
    expect(imported).toEqual(session.data);
    const time = session.world.time;
    session = sessionReducer(session, { type: "apply", candidate: imported });
    expect(session.feedback?.kind).toBe("success");
    expect(session.revision).toBe(2);
    expect(session.world.time).toBe(time);
    expect(session.world.events.at(-1)!.kind).toBe("meta");
    const running = sessionReducer(session, { type: "tick", minutes: 45 });
    const reordered = JSON.parse(serialized, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    );
    const reapplied = applyConfiguration(
      running.world,
      running.data,
      reordered,
    );
    expect(reapplied.changes).toEqual([]);
    expect(reapplied.world.agents).toEqual(running.world.agents);
    expect(reapplied.world.relations).toEqual(running.world.relations);
  });
  it("非法 JSON、缺字段、负容量和错误类型明确拒绝，世界与配置原样保留", () => {
    const session = sessionReducer(createSession(data), {
      type: "tick",
      minutes: 20,
    });
    expect(() => parseConfiguration('{"agents":')).toThrow("JSON 格式错误");
    const missing = JSON.parse(exportConfiguration(data));
    delete missing.agents[0].needs.social;
    const wrongType = JSON.parse(exportConfiguration(data));
    wrongType.rules.rumors.maxHops = "1";
    const emptyPlaces = JSON.parse(exportConfiguration(data));
    emptyPlaces.places = {};
    const duplicateActions = JSON.parse(exportConfiguration(data));
    duplicateActions.places[0].actions.push(
      duplicateActions.places[0].actions[0],
    );
    for (const candidate of [
      null,
      {},
      missing,
      wrongType,
      emptyPlaces,
      duplicateActions,
      capacity(-1),
      capacity(1.5),
      capacity(100),
    ]) {
      const rejected = sessionReducer(session, { type: "apply", candidate });
      expect(rejected.feedback?.kind).toBe("error");
      expect(rejected.feedback!.message).not.toContain("TypeError");
      expect(rejected.world).toBe(session.world);
      expect(rejected.data).toBe(session.data);
      expect(rejected.revision).toBe(session.revision);
    }
    expect(() => parseConfiguration(JSON.stringify(missing))).toThrow(
      "needs.social",
    );
  });
  it("纸条途中热改不瞬移、不续期、不补额度，快进与逐 tick 一致", () => {
    let before = sessionReducer(createSession(data), {
      type: "note",
      agent: "amin",
      action: "chat",
      place: "park",
      message: "热改仍保留纸条",
    });
    before = sessionReducer(before, { type: "tick", minutes: 1 });
    const snapshot = structuredClone(before);
    const applied = sessionReducer(before, {
      type: "apply",
      candidate: capacity(6),
    });
    expect(applied.world.agents[0].travel).toEqual(
      before.world.agents[0].travel,
    );
    expect(applied.world.agents[0].note).toEqual(before.world.agents[0].note);
    expect(applied.world.notesRemaining).toBe(0);
    const batched = sessionReducer(applied, { type: "tick", minutes: 120 });
    let stepped = applied;
    for (let i = 0; i < 120; i++)
      stepped = sessionReducer(stepped, { type: "tick", minutes: 1 });
    expect(batched).toEqual(stepped);
    expect(batched.world.agents[0].note).toBeNull();
    expect(
      batched.world.events.some(
        (e) => e.kind === "note" && e.text.includes("收起纸条"),
      ),
    ).toBe(true);
    expect(before).toEqual(snapshot);
  });
  it("不兼容的实体 ID 或纸条能力变更被拒，合法重开沿用新配置", () => {
    const session = sessionReducer(createSession(data), {
      type: "note",
      agent: "amin",
      action: "chat",
      place: "store",
      message: "",
    });
    const changedId = structuredClone(data);
    changedId.agents[0].id = "renamed";
    const changedNote = structuredClone(data);
    changedNote.places.find((p) => p.id === "store")!.actions = [
      "shop",
      "rest",
    ];
    const rejected = sessionReducer(session, {
      type: "apply",
      candidate: changedNote,
    });
    expect(rejected.feedback!.message).toContain("纸条仍在生效");
    expect(rejected.world).toBe(session.world);
    expect(
      sessionReducer(session, { type: "apply", candidate: changedId }).feedback
        ?.kind,
    ).toBe("error");
    const applied = sessionReducer(session, {
      type: "apply",
      candidate: capacity(6),
    });
    const reset = sessionReducer(applied, { type: "reset" });
    expect(
      reset.data.places.find((p) => p.id === "cafeteria")!.resource!.capacity,
    ).toBe(6);
    expect(reset.world.notesRemaining).toBe(1);
    expect(reset.runId).toBe(applied.runId + 1);
  });
  it("候选草稿与世界隔离，多次热改仍保持事件有界和配置时间原子一致", () => {
    const draft = capacity(6),
      original = createSession(data);
    let session = sessionReducer(original, { type: "apply", candidate: draft });
    draft.places.find((p) => p.id === "cafeteria")!.resource!.capacity = 10;
    expect(
      session.data.places.find((p) => p.id === "cafeteria")!.resource!.capacity,
    ).toBe(6);
    for (let i = 0; i < 250; i++)
      session = sessionReducer(session, {
        type: "apply",
        candidate: session.data,
      });
    expect(session.world.events.length).toBe(MAX_EVENTS);
    expect(session.world.time).toBe(original.world.time);
    expect(session.world.agents).toHaveLength(8);
    expect(session.data.places).toHaveLength(6);
  });
});
