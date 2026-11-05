import type { WorldData } from "./types";

/** Validate untrusted JSON shape before the existing semantic checks dereference it. */
export function validateShape(input: unknown): asserts input is WorldData {
  const fail = (path: string, message: string): never => {
    throw new Error(`数据校验失败：${path} ${message}`);
  };
  const object = (
    value: unknown,
    path: string,
    required: string[],
    optional: string[] = [],
  ): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail(path, "须为对象");
    const obj = value as Record<string, unknown>;
    for (const key of required)
      if (!Object.hasOwn(obj, key)) fail(`${path}.${key}`, "缺失");
    for (const key of Object.keys(obj))
      if (![...required, ...optional].includes(key))
        fail(`${path}.${key}`, "不是支持的字段");
    return obj;
  };
  const list = (
    value: unknown,
    path: string,
    min: number,
    max: number,
  ): unknown[] => {
    if (!Array.isArray(value) || value.length < min || value.length > max)
      return fail(path, `须为 ${min}–${max} 项的数组`);
    return value;
  };
  const text = (
    value: unknown,
    path: string,
    max = 200,
    allowEmpty = false,
  ) => {
    if (
      typeof value !== "string" ||
      (!allowEmpty && !value.trim()) ||
      value.length > max
    )
      fail(path, `须为${allowEmpty ? "" : "非空"}字符串（最多 ${max} 字）`);
  };
  const number = (value: unknown, path: string) => {
    if (typeof value !== "number" || !Number.isFinite(value))
      fail(path, "须为有限数字");
  };
  const strings = (value: unknown, path: string, min = 0, max = 16) => {
    const items = list(value, path, min, max);
    items.forEach((v, i) => text(v, `${path}[${i}]`, 60));
    if (new Set(items).size !== items.length) fail(path, "不可有重复项");
  };
  const root = object(input, "配置", [
    "agents",
    "places",
    "relations",
    "rules",
  ]);
  list(root.agents, "agents", 1, 32).forEach((value, i) => {
    const path = `agents[${i}]`,
      a = object(value, path, [
        "id",
        "name",
        "role",
        "home",
        "initialPlace",
        "color",
        "tags",
        "bio",
        "needs",
        "traits",
        "favorite",
        "schedule",
      ]);
    for (const key of ["id", "name", "role", "home", "initialPlace"])
      text(a[key], `${path}.${key}`, 60);
    text(a.bio, `${path}.bio`, 500, true);
    if (typeof a.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(a.color))
      fail(`${path}.color`, "须为 #RRGGBB 颜色");
    strings(a.tags, `${path}.tags`);
    const needs = object(a.needs, `${path}.needs`, [
      "energy",
      "social",
      "mood",
    ]);
    Object.entries(needs).forEach(([key, v]) =>
      number(v, `${path}.needs.${key}`),
    );
    const traits = object(a.traits, `${path}.traits`, [
      "sociability",
      "praiseSensitivity",
      "kindness",
    ]);
    Object.entries(traits).forEach(([key, v]) =>
      number(v, `${path}.traits.${key}`),
    );
    const favorite = object(a.favorite, `${path}.favorite`, [
      "action",
      "place",
    ]);
    text(favorite.action, `${path}.favorite.action`);
    text(favorite.place, `${path}.favorite.place`);
    list(a.schedule, `${path}.schedule`, 0, 32).forEach((s, j) => {
      const entry = object(s, `${path}.schedule[${j}]`, [
        "start",
        "end",
        "action",
        "place",
      ]);
      Object.entries(entry).forEach(([key, v]) =>
        text(v, `${path}.schedule[${j}].${key}`, 60),
      );
    });
  });
  list(root.places, "places", 1, 32).forEach((value, i) => {
    const path = `places[${i}]`,
      p = object(
        value,
        path,
        ["id", "name", "subtitle", "type", "x", "y", "actions"],
        ["resource"],
      );
    for (const key of ["id", "name", "subtitle", "type"])
      text(p[key], `${path}.${key}`, 100);
    number(p.x, `${path}.x`);
    number(p.y, `${path}.y`);
    if (Math.abs(p.x as number) > 20 || Math.abs(p.y as number) > 20)
      fail(path, "坐标须在 −20–20");
    strings(p.actions, `${path}.actions`, 1, 8);
    if (Object.hasOwn(p, "resource")) {
      const r = object(p.resource, `${path}.resource`, [
        "name",
        "capacity",
        "actions",
      ]);
      text(r.name, `${path}.resource.name`, 60);
      number(r.capacity, `${path}.resource.capacity`);
      if ((r.capacity as number) > 16)
        fail(`${path}.resource.capacity`, "最多 16 个");
      strings(r.actions, `${path}.resource.actions`, 1, 8);
    }
  });
  list(root.relations, "relations", 0, 496).forEach((value, i) => {
    const path = `relations[${i}]`,
      r = object(value, path, ["a", "b", "label", "value"]);
    for (const key of ["a", "b", "label"]) text(r[key], `${path}.${key}`, 60);
    number(r.value, `${path}.value`);
  });
  const rules = object(root.rules, "rules", [
    "behavior",
    "activityMinutes",
    "variation",
    "relationships",
    "plans",
    "rumors",
  ]);
  const groups = {
    behavior: [
      "favoriteMoodPerMinute",
      "restMoodPerMinute",
      "chatSocialPerMinute",
      "continuationBonus",
      "crowdedResourcePenalty",
      "maxQueueMinutes",
      "encounterIntervalMinutes",
      "pairCooldownMinutes",
    ],
    activityMinutes: [
      "sleep",
      "work",
      "eat",
      "chat",
      "sketch",
      "walk",
      "shop",
      "rest",
    ],
    variation: ["seed", "scheduleJitterMinutes"],
    relationships: [
      "decayPerHour",
      "graceMinutes",
      "closeThreshold",
      "closeMultiplier",
      "decayFloorRatio",
    ],
    plans: [
      "durationMinutes",
      "queueMoodPenalty",
      "interruptionMoodPenalty",
      "interruptionRelationPenalty",
    ],
    rumors: [
      "maxHops",
      "minRelation",
      "hopDelayMinutes",
      "broadcastCooldownMinutes",
      "recipientCooldownMinutes",
      "sourceCooldownMinutes",
      "lifetimeMinutes",
      "maxActive",
      "maxRecipients",
      "moodBoost",
      "familiarityBoost",
    ],
  };
  for (const [group, keys] of Object.entries(groups)) {
    const values = object(rules[group], `rules.${group}`, keys);
    for (const [key, value] of Object.entries(values))
      number(value, `rules.${group}.${key}`);
  }
}
