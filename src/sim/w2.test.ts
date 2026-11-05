import { describe, expect, it } from "vitest";
import { data, validateData } from "./data";
import {
  advanceTo,
  advanceWorld,
  createWorld,
  giveNote,
  MAX_EVENTS,
  tick,
} from "./engine";
import type { Action, WorldData, WorldState } from "./types";

function pair(world: WorldState, a: string, b: string) {
  return world.relations.find(
    (r) => [r.a, r.b].includes(a) && [r.a, r.b].includes(b),
  )!;
}
function fixture(
  ids: string[],
  place = "park",
  action: Action = "chat",
): WorldData {
  const input = structuredClone(data);
  input.agents = input.agents.filter((a) => ids.includes(a.id));
  input.relations = input.relations.filter(
    (r) => ids.includes(r.a) && ids.includes(r.b),
  );
  for (const agent of input.agents) {
    agent.initialPlace = place;
    agent.needs = { energy: 80, social: 50, mood: 80 };
    agent.schedule = [{ start: "00:00", end: "23:59", action, place }];
  }
  return input;
}
function rumorFixture() {
  const input = fixture(["amin", "ake", "lin", "tang"]);
  input.places.find((p) => p.id === "park")!.resource!.capacity = 4;
  input.agents.find((a) => a.id === "ake")!.schedule[0].action = "sketch";
  input.relations = [
    { a: "lin", b: "ake", label: "画的观众", value: 80 },
    { a: "lin", b: "tang", label: "熟人", value: 75 },
    { a: "tang", b: "amin", label: "熟人", value: 75 },
  ];
  const world = createWorld(input);
  // Existing pair cooldowns isolate one actual praise event as the source.
  for (const a of world.agents)
    for (const b of world.agents) {
      if (
        a.id !== b.id &&
        ![a.id, b.id].every((id) => ["ake", "lin"].includes(id))
      )
        world.pairCooldowns[[a.id, b.id].sort().join(":")] = world.time;
    }
  return { input, world };
}

describe("W2 关系、冲突与传闻", () => {
  it("未互动关系按 JSON 衰减，熟人更慢，账本与分数一致", () => {
    const input = structuredClone(data);
    for (const a of input.agents) {
      a.initialPlace = a.home;
      a.schedule = [
        { start: "00:00", end: "23:59", action: "sleep", place: a.home },
      ];
    }
    const original = createWorld(input);
    const next = advanceWorld(original, input, 360);
    expect(pair(next, "amin", "zhou").value).toBeCloseTo(25, 8);
    expect(pair(next, "amin", "qiao").value).toBeCloseTo(76.5, 8);
    for (const r of next.relations)
      expect(r.value).toBeCloseTo(
        r.initialValue + r.interactionDelta + r.rumorDelta - r.decayTotal,
        8,
      );
    expect(pair(original, "amin", "zhou").value).toBe(28);
    input.rules.relationships.decayPerHour = 0;
    expect(pair(advanceWorld(original, input, 360), "amin", "zhou").value).toBe(
      28,
    );
  });
  it("持续正面互动升温，性格摩擦降温，直接互动重置衰减宽限", () => {
    const friendly = fixture(["ake", "lin"]);
    const warm = advanceWorld(createWorld(friendly), friendly, 55);
    expect(pair(warm, "ake", "lin").value).toBeGreaterThan(74);
    expect(pair(warm, "ake", "lin").decayTotal).toBe(0);
    expect(pair(warm, "ake", "lin").lastInteractionAt).not.toBeNull();
    const strained = fixture(["amin", "zhou"]);
    const cold = advanceWorld(createWorld(strained), strained, 10);
    expect(pair(cold, "amin", "zhou").interactionDelta).toBeLessThan(0);
  });
  it("午饭计划冲突明确双方、资源、排队结果与心情代价", () => {
    const world = advanceWorld(createWorld(data), data, 32);
    const conflicts = world.events.filter(
      (e) => e.conflict?.type === "resource",
    );
    expect(conflicts.length).toBeGreaterThan(0);
    const event = conflicts.find((e) => e.place === "cafeteria")!;
    expect(event.conflict).toMatchObject({
      result: "wait",
      resource: "共享餐位",
    });
    expect(event.conflict!.others).toHaveLength(2);
    for (const id of [event.conflict!.initiator, ...event.conflict!.others]) {
      expect(event.actors).toContain(id);
      expect(event.text).toContain(data.agents.find((a) => a.id === id)!.name);
    }
    expect(event.reason).toContain("心情");
    expect(world.agents.some((a) => a.waitingSince !== null)).toBe(true);
  });
  it("纸条打断真实共同安排，双方失约后果只写一次且仍需移动", () => {
    const input = fixture(["ake", "lin"]);
    const before = advanceWorld(createWorld(input), input, 2);
    expect(before.jointPlans).toHaveLength(1);
    const noted = giveNote(
      before,
      input,
      "lin",
      "shop",
      "store",
      "临时去便利店",
    );
    expect(noted.jointPlans).toHaveLength(0);
    expect(noted.agents.find((a) => a.id === "lin")!.travel).toMatchObject({
      from: "park",
      to: "store",
    });
    expect(noted.agents.find((a) => a.id === "lin")!.place).toBe("park");
    expect(
      noted.events.filter((e) => e.conflict?.type === "interruption"),
    ).toHaveLength(1);
    expect(pair(noted, "ake", "lin").value).toBeCloseTo(
      pair(before, "ake", "lin").value - 1,
    );
    const expired = advanceWorld(noted, input, 60);
    expect(expired.agents.find((a) => a.id === "lin")!.note).toBeNull();
    expect(
      expired.events.filter((e) => e.conflict?.type === "interruption"),
    ).toHaveLength(1);
    expect(before.jointPlans).toHaveLength(1);
  });
  it("紧急补觉会打断共同安排，同目标纸条和已结束约定不会误报", () => {
    const input = fixture(["ake", "lin"]);
    const shared = advanceWorld(createWorld(input), input, 2);
    const same = giveNote(shared, input, "lin", "chat", "park");
    expect(same.events.some((e) => e.conflict?.type === "interruption")).toBe(
      false,
    );
    const exhausted = structuredClone(shared);
    exhausted.agents.find((a) => a.id === "lin")!.needs.energy = 1;
    const next = tick(exhausted, input);
    expect(
      next.events.find((e) => e.conflict?.type === "interruption")?.reason,
    ).toContain("紧急补觉");
    const ended = advanceWorld(
      shared,
      input,
      input.rules.plans.durationMinutes,
    );
    const noted = giveNote(ended, input, "lin", "shop", "store");
    expect(noted.events.some((e) => e.conflict?.type === "interruption")).toBe(
      false,
    );
  });
  it("真实夸稿沿已有边传播两跳，第三人轻微升温且保留完整路径", () => {
    const { input, world } = rumorFixture();
    const snapshot = structuredClone(world);
    const next = advanceWorld(world, input, 30);
    const events = next.events.filter((e) => e.kind === "rumor");
    expect(events.map((e) => e.rumor!.path)).toEqual([
      ["lin", "tang"],
      ["lin", "tang", "amin"],
    ]);
    const last = events[1];
    expect(last.reason).toContain("林叔→小唐→阿敏");
    expect(last.rumor).toMatchObject({
      moodDelta: 2,
      relationDelta: 1,
      subject: "ake",
    });
    expect(
      next.events.find((e) => e.id === last.rumor!.sourceEventId)?.text,
    ).toContain("这张的光线真好");
    expect(pair(next, "amin", "ake").rumorDelta).toBe(1);
    expect(world).toEqual(snapshot);
  });
  it("一跳配置阻止二次转述，断边、睡眠或不同地点不能传播", () => {
    const { input, world } = rumorFixture();
    input.rules.rumors.maxHops = 1;
    expect(
      advanceWorld(world, input, 30)
        .events.filter((e) => e.kind === "rumor")
        .map((e) => e.rumor!.path),
    ).toEqual([["lin", "tang"]]);
    input.rules.rumors.maxHops = 2;
    for (const condition of ["edge", "sleep", "place"]) {
      const isolated = structuredClone(world),
        modified = structuredClone(input);
      if (condition === "edge")
        isolated.relations = isolated.relations.filter(
          (r) => ![r.a, r.b].includes("tang"),
        );
      else {
        const target = modified.agents.find((a) => a.id === "tang")!;
        target.schedule[0] = {
          start: "00:00",
          end: "23:59",
          action: condition === "sleep" ? "sleep" : "work",
          place: condition === "sleep" ? target.home : "office",
        };
      }
      expect(
        advanceWorld(isolated, modified, 30).events.some(
          (e) => e.kind === "rumor",
        ),
      ).toBe(false);
    }
  });
  it("传闻有冷却、人数与存活上限，批量快进等于逐 tick", () => {
    const original = createWorld(data);
    const before = structuredClone(original);
    const batched = advanceWorld(original, data, 360);
    let stepped = original;
    for (let i = 0; i < 360; i++) stepped = tick(stepped, data);
    expect(batched).toEqual(stepped);
    expect(original).toEqual(before);
    expect(batched.rumors.length).toBeLessThanOrEqual(
      data.rules.rumors.maxActive,
    );
    for (const rumor of batched.rumors) {
      expect(rumor.receipts.length).toBeLessThanOrEqual(
        data.rules.rumors.maxRecipients + 1,
      );
      expect(new Set(rumor.receipts.map((r) => r.agent)).size).toBe(
        rumor.receipts.length,
      );
      expect(rumor.expiresAt).toBeGreaterThan(batched.time);
      expect(rumor.receipts.every((r) => r.path.length <= 3)).toBe(true);
    }
    const rumors = batched.events.filter((e) => e.kind === "rumor");
    expect(rumors.length).toBeGreaterThan(0);
    for (let i = 1; i < rumors.length; i++)
      expect(rumors[i].time - rumors[i - 1].time).toBeGreaterThanOrEqual(
        data.rules.rumors.broadcastCooldownMinutes,
      );
    expect(batched.events.length).toBeLessThanOrEqual(MAX_EVENTS);
  });
  it("无效传播配置拒绝启动，演示跳转不回退也不跨到次日", () => {
    const input = structuredClone(data);
    input.rules.rumors.maxHops = 3;
    expect(() => validateData(input)).toThrow("maxHops");
    const world = advanceWorld(createWorld(data), data, 800);
    expect(advanceTo(world, data, 732)).toBe(world);
  });
  it("传闻到期清理，人数上限生效，同一消息不反传或重复影响", () => {
    const { input, world } = rumorFixture();
    input.rules.rumors.maxRecipients = 1;
    const capped = advanceWorld(world, input, 30);
    expect(capped.events.filter((e) => e.kind === "rumor")).toHaveLength(1);
    expect(capped.rumors[0].receipts.map((r) => r.agent)).toEqual([
      "lin",
      "tang",
    ]);
    expect(pair(capped, "tang", "ake").rumorDelta).toBe(1);
    input.rules.rumors.lifetimeMinutes = 10;
    const expired = advanceWorld(world, input, 12);
    expect(expired.rumors).toHaveLength(0);
    expect(expired.events.filter((e) => e.kind === "rumor")).toHaveLength(1);
    const limited = structuredClone(data);
    limited.rules.rumors.maxActive = 1;
    let running = createWorld(limited);
    for (let minute = 0; minute < 600; minute++) {
      running = tick(running, limited);
      expect(running.rumors.length).toBeLessThanOrEqual(1);
    }
    expect(running.nextRumorId).toBeGreaterThan(2);
  });
  it("W2 五幕真实快进串起夸稿、两跳传闻、失约、降温与夜间相遇", () => {
    let world = advanceTo(createWorld(data), data, 732);
    expect(world.events.some((e) => e.conflict?.type === "resource")).toBe(
      true,
    );
    world = advanceTo(world, data, 836);
    expect(
      world.jointPlans.some(
        (p) =>
          p.participants.includes("ake") && p.participants.includes("tang"),
      ),
    ).toBe(true);
    expect(
      world.events.some((e) => e.rumor?.path.join(":") === "lin:tang"),
    ).toBe(true);
    world = giveNote(world, data, "tang", "shop", "store");
    expect(
      world.events.some(
        (e) =>
          e.conflict?.type === "interruption" &&
          e.conflict.initiator === "tang",
      ),
    ).toBe(true);
    world = advanceWorld(world, data, 60);
    expect(world.agents.find((a) => a.id === "tang")!.note).toBeNull();
    expect(
      world.events.some((e) => e.rumor?.path.join(":") === "lin:miao:zhou"),
    ).toBe(true);
    world = advanceTo(world, data, 1404);
    expect(pair(world, "amin", "qiao").value).toBeLessThan(78);
    expect(pair(world, "zhou", "miao").value).toBeGreaterThan(75);
    expect(
      world.events.some(
        (e) =>
          e.kind === "encounter" &&
          e.place === "store" &&
          e.actors.includes("amin") &&
          e.actors.includes("qiao"),
      ),
    ).toBe(true);
    expect(world.notesRemaining).toBe(0);
  });
});
