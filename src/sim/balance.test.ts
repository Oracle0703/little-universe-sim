import { describe, expect, it } from "vitest";
import { data, validateData } from "./data";
import { parseConfiguration } from "./configuration";
import { advanceWorld, chooseGoal, createWorld, dayShift } from "./engine";
import type { WorldData, WorldState } from "./types";

const solo = (id: string) => {
  const config = structuredClone(data);
  config.agents = config.agents.filter((a) => a.id === id);
  config.relations = [];
  return config;
};
const run = (world: WorldState, config: WorldData, minutes: number) => {
  for (; minutes > 0; minutes -= 1440)
    world = advanceWorld(world, config, Math.min(1440, minutes));
  return world;
};

describe("作息衔接、关系下限、心情收益与每日变化", () => {
  it("下一段作息前连一半都做不完的差事不出门，时间充足时照常去", () => {
    const config = solo("amin");
    config.rules.variation.scheduleJitterMinutes = 0;
    config.agents[0].schedule = [
      { start: "10:30", end: "12:00", action: "work", place: "office" },
    ];
    const world = createWorld(config),
      def = config.agents[0],
      agent = world.agents[0];
    agent.place = "office";
    agent.needs = { energy: 90, social: 90, mood: 30 };
    world.time = 1440 + 10 * 60 + 24; // D2 10:24; work starts at the office at 10:30.
    expect(chooseGoal(agent, def, world, config)).toMatchObject({
      action: "rest",
      place: "office",
    });
    world.time = 1440 + 9 * 60; // 90 minutes ahead is enough for the store.
    expect(chooseGoal(agent, def, world, config)).toMatchObject({
      action: "shop",
      place: "store",
    });
  });

  it("久未联系的关系停在起点的固定比例，账本仍一致", () => {
    const config = structuredClone(data);
    config.rules.relationships.decayPerHour = 6;
    config.rules.relationships.closeMultiplier = 1;
    for (const a of config.agents) {
      a.initialPlace = a.home;
      a.schedule = [
        { start: "00:00", end: "23:59", action: "sleep", place: a.home },
      ];
    }
    const world = advanceWorld(createWorld(config), config, 600);
    const ratio = config.rules.relationships.decayFloorRatio;
    for (const r of world.relations) {
      expect(r.value).toBeCloseTo(r.initialValue * ratio, 8);
      expect(r.value).toBeCloseTo(
        r.initialValue +
          r.interactionDelta +
          r.rumorDelta +
          r.manualDelta -
          r.decayTotal,
        8,
      );
    }
  });

  it("活动带来的心情收益越接近满值越小，低落时恢复最快", () => {
    const config = solo("lin");
    const def = config.agents[0];
    def.initialPlace = "park";
    def.schedule = [
      { start: "00:00", end: "23:59", action: "walk", place: "park" },
    ];
    const gain = (mood: number) => {
      def.needs = { energy: 90, social: 90, mood };
      return (
        advanceWorld(createWorld(config), config, 1).agents[0].needs.mood - mood
      );
    };
    expect(gain(90)).toBeGreaterThan(0);
    expect(gain(10)).toBeGreaterThan(gain(90) * 5);
  });

  it("可选活动遇到满座会让位，不再反复排到等位者后面", () => {
    const world = createWorld(data);
    world.time = 21 * 60; // After 老陈's work, before sleep.
    const chen = world.agents.find((a) => a.id === "chen")!;
    chen.place = "park";
    chen.needs = { energy: 60, social: 90, mood: 70 };
    for (const id of ["zhou", "miao"]) {
      const other = world.agents.find((a) => a.id === id)!;
      other.place = "park";
      other.hasResource = true;
      other.goal = {
        action: "chat",
        place: "park",
        source: "favorite",
        score: 50,
        reason: "",
      };
    }
    const def = data.agents.find((a) => a.id === "chen")!;
    expect(chooseGoal(chen, def, world, data)).toMatchObject({
      action: "rest",
      place: def.home,
    });
    const relaxed = structuredClone(data);
    relaxed.rules.behavior.crowdedResourcePenalty = 0;
    expect(chooseGoal(chen, def, world, relaxed)).toMatchObject({
      action: "rest",
      place: "park",
    });
  });

  it("第 1 天作息不浮动；之后按种子浮动、同种子可复现", () => {
    const reseeded = structuredClone(data);
    reseeded.rules.variation.seed = data.rules.variation.seed + 1;
    const until2200 = 22 * 60 - createWorld(data).time;
    expect(advanceWorld(createWorld(reseeded), reseeded, until2200)).toEqual(
      advanceWorld(createWorld(data), data, until2200),
    );
    const d3 = 3 * 1440 - createWorld(data).time;
    const a = run(createWorld(data), data, d3);
    expect(run(createWorld(data), data, d3)).toEqual(a);
    expect(run(createWorld(reseeded), reseeded, d3)).not.toEqual(a);

    const jitter = data.rules.variation.scheduleJitterMinutes;
    const shifts = data.agents.flatMap((agent) =>
      Array.from({ length: 30 }, (_, day) => dayShift(data, agent.id, day)),
    );
    expect(
      data.agents.every((agent) => dayShift(data, agent.id, 0) === 0),
    ).toBe(true);
    expect(shifts.every((s) => Math.abs(s) <= jitter)).toBe(true);
    expect(new Set(shifts).size).toBeGreaterThan(10);
    const fixed = structuredClone(data);
    fixed.rules.variation.scheduleJitterMinutes = 0;
    expect(dayShift(fixed, "amin", 5)).toBe(0);
  });

  it("旧版导出 JSON 缺少新规则时用内置默认补齐，已有取值保留", () => {
    const legacy = structuredClone(data) as unknown as {
      rules: Record<string, Record<string, number> | undefined>;
    };
    delete legacy.rules.behavior;
    delete legacy.rules.activityMinutes;
    delete legacy.rules.variation;
    delete legacy.rules.relationships!.decayFloorRatio;
    legacy.rules.relationships!.decayPerHour = 1.2;
    expect(() => validateData(legacy)).toThrow("缺失");
    const parsed = parseConfiguration(JSON.stringify(legacy));
    expect(parsed.rules.behavior).toEqual(data.rules.behavior);
    expect(parsed.rules.variation).toEqual(data.rules.variation);
    expect(parsed.rules.relationships).toEqual({
      ...data.rules.relationships,
      decayPerHour: 1.2,
    });
  });
});
