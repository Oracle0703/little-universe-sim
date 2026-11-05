import { describe, expect, it } from "vitest";
import { data, validateData } from "./data";
import {
  advanceWorld,
  chooseGoal,
  createWorld,
  giveNote,
  MAX_EVENTS,
  tick,
} from "./engine";

describe("自主生活模拟", () => {
  it("tick 更新需求，且不修改传入状态", () => {
    const original = createWorld(data);
    const before = structuredClone(original);
    const next = tick(original, data);
    expect(next.time).toBe(original.time + 1);
    expect(next.agents[0].needs.energy).toBeLessThan(
      original.agents[0].needs.energy,
    );
    expect(next.agents[0].needs.social).toBeLessThan(
      original.agents[0].needs.social,
    );
    expect(original).toEqual(before);
  });
  it("作息、低精力与 JSON 偏好会改变目标选择", () => {
    const world = createWorld(data),
      agent = world.agents[0],
      def = data.agents[0];
    expect(chooseGoal(agent, def, world, data).action).toBe("work");
    agent.needs.energy = 5;
    expect(chooseGoal(agent, def, world, data)).toMatchObject({
      action: "sleep",
      place: def.home,
    });
    agent.needs = { energy: 90, social: 90, mood: 0 };
    world.time = 21 * 60;
    const modified = {
      ...def,
      favorite: { action: "walk" as const, place: "park" },
    };
    expect(chooseGoal(agent, modified, world, data)).toMatchObject({
      action: "walk",
      place: "park",
    });
  });
  it("午饭产生资源冲突、移动、偶遇与有原因的事件", () => {
    const world = advanceWorld(createWorld(data), data, 95);
    for (const kind of ["goal", "move", "conflict", "encounter"])
      expect(world.events.some((e) => e.kind === kind)).toBe(true);
    expect(
      world.events.every(
        (e) => e.text && e.reason && data.places.some((p) => p.id === e.place),
      ),
    ).toBe(true);
    expect(
      world.relations.some(
        (r) =>
          r.value !==
          data.relations.find((old) => old.a === r.a && old.b === r.b)?.value,
      ),
    ).toBe(true);
  });
  it("每轮一次纸条，立即改目标，60 分钟后恢复自主决策", () => {
    const before = createWorld(data);
    const world = giveNote(before, data, "amin", "walk", "park", "出去透口气");
    expect(world.notesRemaining).toBe(0);
    expect(before.notesRemaining).toBe(1);
    expect(world.agents[0].goal).toMatchObject({
      source: "note",
      action: "walk",
      place: "park",
    });
    expect(
      world.events.some(
        (e) => e.kind === "note" && e.text.includes("出去透口气"),
      ),
    ).toBe(true);
    expect(() => giveNote(world, data, "zhou", "walk", "park")).toThrow(
      "已经用过",
    );
    const expired = advanceWorld(world, data, 60);
    expect(expired.agents[0].note).toBeNull();
    expect(expired.agents[0].goal?.source).not.toBe("note");
    expect(expired.events.some((e) => e.text.includes("收起纸条"))).toBe(true);
  });
  it("路途中收到纸条不瞬移，抵达后改道", () => {
    let world = advanceWorld(createWorld(data), data, 11);
    const agent = world.agents.find((a) => a.travel)!;
    expect(agent).toBeDefined();
    const route = structuredClone(agent.travel);
    world = giveNote(world, data, agent.id, "shop", "store");
    expect(world.agents.find((a) => a.id === agent.id)!.travel).toEqual(route);
    world = advanceWorld(world, data, 20);
    expect(world.agents.find((a) => a.id === agent.id)!.place).toBe("store");
  });
  it("跨午夜作息生效，阿敏与乔乔在深夜便利店相遇", () => {
    const night = advanceWorld(createWorld(data), data, 710);
    expect(
      night.events.some(
        (e) =>
          e.place === "store" &&
          e.actors.includes("amin") &&
          e.actors.includes("qiao"),
      ),
      JSON.stringify(
        night.agents.filter((a) => ["amin", "qiao"].includes(a.id)),
      ),
    ).toBe(true);
    const world = createWorld(data);
    world.time = 1440 + 10;
    expect(
      chooseGoal(world.agents[0], data.agents[0], world, data),
    ).toMatchObject({ action: "shop", place: "store", source: "schedule" });
  });
  it("五分钟演示场景由真实规则产生，干预后夜间作息仍会恢复", () => {
    let world = advanceWorld(createWorld(data), data, 32);
    expect(
      world.agents.filter(
        (a) => a.place === "cafeteria" && a.waitingSince !== null,
      ).length,
    ).toBeGreaterThan(0);
    world = advanceWorld(world, data, 66);
    expect(world.events.some((e) => e.text.includes("这张的光线真好"))).toBe(
      true,
    );
    world = advanceWorld(world, data, 2);
    world = giveNote(world, data, "amin", "chat", "park", "出去透口气");
    world = advanceWorld(world, data, 604);
    expect(world.time).toBe(23 * 60 + 24);
    expect(world.agents.find((a) => a.id === "amin")!.note).toBeNull();
    expect(
      world.events.some(
        (e) =>
          e.place === "store" &&
          e.actors.includes("amin") &&
          e.actors.includes("qiao"),
      ),
    ).toBe(true);
    expect(world.agents.find((a) => a.id === "lin")!.goal?.action).toBe(
      "sleep",
    );
  });
  // This deliberately checks all 4,320 ticks; allow slower shared Windows hosts.
  it(
    "连续运行三天保持需求范围、资源容量、确定性与有界日志",
    { timeout: 15000 },
    () => {
      let world = createWorld(data);
      for (let i = 0; i < 3 * 1440; i++) {
        world = tick(world, data);
        for (const a of world.agents) {
          for (const value of Object.values(a.needs)) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(100);
          }
        }
        for (const p of data.places.filter((p) => p.resource))
          expect(
            world.agents.filter(
              (a) => a.place === p.id && a.hasResource && !a.travel,
            ).length,
          ).toBeLessThanOrEqual(p.resource!.capacity);
      }
      expect(world.events.length).toBeLessThanOrEqual(MAX_EVENTS);
      expect(advanceWorld(createWorld(data), data, 120)).toEqual(
        advanceWorld(createWorld(data), data, 120),
      );
    },
  );
  it("第九位 NPC 只需数据就能进入世界，无效数据清楚报错", () => {
    const expanded = structuredClone(data);
    expanded.agents.push({
      ...structuredClone(data.agents[0]),
      id: "new-person",
      name: "新同事",
    });
    const world = advanceWorld(createWorld(expanded), expanded, 20);
    expect(world.agents).toHaveLength(9);
    expect(world.events.some((e) => e.actors.includes("new-person"))).toBe(
      true,
    );
    expanded.places[2].resource!.capacity = 0;
    expect(() => validateData(expanded)).toThrow("资源配置");
  });
});
