import agents from "../data/agents.json";
import places from "../data/places.json";
import relations from "../data/relations.json";
import rules from "../data/simulation.json";
import type { Action, WorldData } from "./types";
import { validateShape } from "./validation";

export const ACTIONS: Record<Action, string> = {
  sleep: "睡一觉",
  work: "专心工作",
  eat: "吃午饭",
  chat: "找人聊聊",
  sketch: "画一张速写",
  walk: "散散步",
  shop: "逛便利店",
  rest: "歇一会儿",
};
export const data = { agents, places, relations, rules } as WorldData;
const actions = new Set(Object.keys(ACTIONS));

export function validateData(input: unknown): asserts input is WorldData {
  validateShape(input);
  const fail = (message: string): never => {
    throw new Error(`居民数据错误：${message}`);
  };
  if (
    !input.rules?.relationships ||
    !input.rules?.plans ||
    !input.rules?.rumors
  )
    fail("缺少 simulation.json 规则配置");
  const bounded = (
    name: string,
    value: number,
    min: number,
    max: number,
    integer = false,
  ) => {
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      fail(`${name} 须在 ${min}–${max}${integer ? "（整数）" : ""}`);
  };
  const { relationships: rel, plans, rumors } = input.rules;
  const { behavior, activityMinutes } = input.rules;
  for (const key of [
    "favoriteMoodPerMinute",
    "restMoodPerMinute",
    "chatSocialPerMinute",
  ] as const)
    bounded(key, behavior[key], 0, 5);
  bounded("continuationBonus", behavior.continuationBonus, 0, 30);
  bounded("crowdedResourcePenalty", behavior.crowdedResourcePenalty, 0, 100);
  for (const key of [
    "maxQueueMinutes",
    "encounterIntervalMinutes",
    "pairCooldownMinutes",
  ] as const)
    bounded(key, behavior[key], 1, 180, true);
  for (const [action, minutes] of Object.entries(activityMinutes))
    bounded(`activityMinutes.${action}`, minutes, 1, 180, true);
  bounded("decayPerHour", rel.decayPerHour, 0, 10);
  bounded("graceMinutes", rel.graceMinutes, 0, 1440, true);
  bounded("closeThreshold", rel.closeThreshold, 0, 100);
  bounded("closeMultiplier", rel.closeMultiplier, 0, 1);
  bounded("decayFloorRatio", rel.decayFloorRatio, 0, 1);
  bounded("seed", input.rules.variation.seed, 0, 2147483647, true);
  bounded(
    "scheduleJitterMinutes",
    input.rules.variation.scheduleJitterMinutes,
    0,
    60,
    true,
  );
  bounded("durationMinutes", plans.durationMinutes, 1, 60, true);
  for (const name of [
    "queueMoodPenalty",
    "interruptionMoodPenalty",
    "interruptionRelationPenalty",
  ] as const)
    bounded(name, plans[name], 0, 10);
  bounded("maxHops", rumors.maxHops, 1, 2, true);
  bounded("minRelation", rumors.minRelation, 0, 100);
  for (const name of [
    "hopDelayMinutes",
    "broadcastCooldownMinutes",
    "recipientCooldownMinutes",
    "sourceCooldownMinutes",
    "lifetimeMinutes",
  ] as const)
    bounded(name, rumors[name], 1, 1440, true);
  bounded("maxActive", rumors.maxActive, 1, 20, true);
  bounded("maxRecipients", rumors.maxRecipients, 1, 20, true);
  bounded("moodBoost", rumors.moodBoost, 0, 5);
  bounded("familiarityBoost", rumors.familiarityBoost, 0, 5);
  const ids = new Set(input.agents.map((a) => a.id));
  const placeIds = new Set(input.places.map((p) => p.id));
  if (ids.size !== input.agents.length || placeIds.size !== input.places.length)
    fail("id 不可重复");
  if (!ids.size || !placeIds.size) fail("至少需要一位居民和一个地点");
  const validAction = (action: Action, place: string) =>
    placeIds.has(place) &&
    actions.has(action) &&
    input.places.find((p) => p.id === place)!.actions.includes(action);
  for (const p of input.places) {
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !p.actions.length ||
      p.actions.some((a) => !actions.has(a))
    )
      fail(`${p.id} 的坐标或行为无效`);
    if (
      p.resource &&
      (!Number.isInteger(p.resource.capacity) ||
        p.resource.capacity < 1 ||
        p.resource.actions.some((a) => !p.actions.includes(a)))
    )
      fail(`${p.id} 的资源配置无效`);
  }
  for (const a of input.agents) {
    if (
      !placeIds.has(a.home) ||
      !placeIds.has(a.initialPlace) ||
      !validAction("sleep", a.home) ||
      !validAction("rest", a.home)
    )
      fail(`${a.id} 的住所或初始地点无效`);
    if (
      Object.values(a.needs).length !== 3 ||
      Object.values(a.needs).some(
        (n) => !Number.isFinite(n) || n < 0 || n > 100,
      )
    )
      fail(`${a.id} 的需求须在 0–100`);
    if (
      Object.values(a.traits).length !== 3 ||
      Object.values(a.traits).some((n) => !Number.isFinite(n) || n < 0 || n > 1)
    )
      fail(`${a.id} 的性格参数须在 0–1`);
    if (!validAction(a.favorite.action, a.favorite.place))
      fail(`${a.id} 的偏好行为与地点不匹配`);
    for (const s of a.schedule) {
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) ||
        s.start === s.end ||
        !validAction(s.action, s.place)
      )
        fail(`${a.id} 的作息时间或地点行为无效`);
    }
  }
  const pairs = new Set<string>();
  for (const r of input.relations) {
    const key = [r.a, r.b].sort().join(":");
    if (
      !ids.has(r.a) ||
      !ids.has(r.b) ||
      r.a === r.b ||
      pairs.has(key) ||
      !Number.isFinite(r.value) ||
      r.value < 0 ||
      r.value > 100
    )
      fail(`关系 ${key} 无效或重复`);
    pairs.add(key);
  }
}
