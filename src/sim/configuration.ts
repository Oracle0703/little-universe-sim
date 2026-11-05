import { validateData } from "./data";
import { initialRelation } from "./social";
import type { WorldData, WorldState } from "./types";

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const pairKey = (a: string, b: string) => [a, b].sort().join(":");

export function parseConfiguration(json: string): WorldData {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("JSON 格式错误，请检查引号、逗号和括号。");
  }
  validateData(value);
  return structuredClone(value);
}

export function exportConfiguration(data: WorldData): string {
  validateData(data);
  return JSON.stringify(data, null, 2);
}

export function describeChanges(
  previous: WorldData,
  next: WorldData,
): string[] {
  const changes: string[] = [];
  const short = (value: unknown) => {
    const json = JSON.stringify(value) ?? "无";
    return json.length > 55 ? `${json.slice(0, 52)}…` : json;
  };
  for (const nextAgent of next.agents) {
    const old = previous.agents.find((a) => a.id === nextAgent.id)!;
    for (const [key, label] of Object.entries({
      name: "姓名",
      role: "岗位",
      home: "住所",
      initialPlace: "初始位置",
      color: "标识色",
      bio: "简介",
      tags: "性格标签",
      needs: "需求初值",
      traits: "性格参数",
      favorite: "偏好",
      schedule: "作息",
    })) {
      const k = key as keyof typeof old;
      if (!equal(old[k], nextAgent[k]))
        changes.push(
          `${nextAgent.name} · ${label}：${short(old[k])} → ${short(nextAgent[k])}`,
        );
    }
  }
  for (const place of next.places) {
    const old = previous.places.find((p) => p.id === place.id)!;
    for (const key of [
      "name",
      "subtitle",
      "type",
      "x",
      "y",
      "actions",
    ] as const)
      if (!equal(old[key], place[key]))
        changes.push(
          `${place.name} · ${key}：${short(old[key])} → ${short(place[key])}`,
        );
    if (old.resource?.capacity !== place.resource?.capacity)
      changes.push(
        `${place.name} · 容量：${old.resource?.capacity ?? "无"} → ${place.resource?.capacity ?? "无"}`,
      );
    if (!equal(old.resource?.actions, place.resource?.actions))
      changes.push(
        `${place.name} · 占位行为：${short(old.resource?.actions)} → ${short(place.resource?.actions)}`,
      );
    if (old.resource?.name !== place.resource?.name)
      changes.push(
        `${place.name} · 资源名称：${old.resource?.name ?? "无"} → ${place.resource?.name ?? "无"}`,
      );
  }
  const oldRelations = new Map(
    previous.relations.map((r) => [pairKey(r.a, r.b), r]),
  );
  const nextRelations = new Map(
    next.relations.map((r) => [pairKey(r.a, r.b), r]),
  );
  for (const key of new Set([
    ...oldRelations.keys(),
    ...nextRelations.keys(),
  ])) {
    const old = oldRelations.get(key),
      current = nextRelations.get(key);
    if (!equal(old, current))
      changes.push(`关系 ${key}：${short(old)} → ${short(current)}`);
  }
  for (const group of [
    "behavior",
    "activityMinutes",
    "relationships",
    "plans",
    "rumors",
  ] as const) {
    for (const key of Object.keys(next.rules[group])) {
      const old = (previous.rules[group] as unknown as Record<string, number>)[
        key
      ];
      const current = (next.rules[group] as unknown as Record<string, number>)[
        key
      ];
      if (old !== current) changes.push(`${group}.${key}：${old} → ${current}`);
    }
  }
  return changes;
}

/** Reconcile only a validated fixed-topology configuration, without advancing time. */
export function reconcileConfiguration(
  previous: WorldState,
  oldData: WorldData,
  candidate: unknown,
) {
  validateData(candidate);
  for (const key of ["agents", "places"] as const) {
    const ids = new Set(oldData[key].map((item) => item.id));
    if (
      candidate[key].length !== ids.size ||
      candidate[key].some((item) => !ids.has(item.id))
    )
      throw new Error(
        `热改须保留现有 ${key === "agents" ? "居民" : "地点"} 的数量和 ID；本面板不增删实体。`,
      );
  }
  for (const agent of previous.agents) {
    if (
      agent.note &&
      agent.note.expiresAt > previous.time &&
      !candidate.places
        .find((p) => p.id === agent.note!.place)!
        .actions.includes(agent.note.action)
    )
      throw new Error(
        `${candidate.agents.find((a) => a.id === agent.id)!.name}的纸条仍在生效，不能移除其目标地点支持的行为。`,
      );
  }
  const data = structuredClone(candidate),
    world = structuredClone(previous);
  const changes = describeChanges(oldData, data);
  for (const agent of world.agents) {
    const old = oldData.agents.find((a) => a.id === agent.id)!;
    const next = data.agents.find((a) => a.id === agent.id)!;
    for (const need of ["energy", "social", "mood"] as const)
      if (old.needs[need] !== next.needs[need])
        agent.needs[need] = next.needs[need];
    if (!equal(old.schedule, next.schedule)) {
      agent.completedSchedules = [
        ...new Set(
          agent.completedSchedules.flatMap((key) => {
            const [day, index] = key.split(":");
            const newIndex = next.schedule.findIndex((s) =>
              equal(s, old.schedule[Number(index)]),
            );
            return newIndex < 0 ? [] : [`${day}:${newIndex}`];
          }),
        ),
      ];
    }
    const behaviorChanged = [
      "schedule",
      "traits",
      "favorite",
      "home",
      "needs",
    ].some(
      (key) =>
        !equal(old[key as keyof typeof old], next[key as keyof typeof next]),
    );
    const validGoal =
      agent.goal &&
      data.places
        .find((p) => p.id === agent.goal!.place)!
        .actions.includes(agent.goal.action);
    if (!agent.note && (behaviorChanged || (agent.goal && !validGoal))) {
      agent.goal = null;
      agent.activityMinutes = 0;
      agent.hasResource = false;
      agent.waitingSince = null;
    }
    // An already-started route and active note keep their original arrival/expiry clocks.
    const place = data.places.find((p) => p.id === agent.place)!;
    if (!agent.goal || !place.resource?.actions.includes(agent.goal.action)) {
      agent.hasResource = false;
      agent.waitingSince = null;
    }
  }
  const oldRelations = new Map(
    oldData.relations.map((r) => [pairKey(r.a, r.b), r]),
  );
  const nextKeys = new Set(data.relations.map((r) => pairKey(r.a, r.b)));
  world.relations = world.relations.filter(
    (r) =>
      !oldRelations.has(pairKey(r.a, r.b)) || nextKeys.has(pairKey(r.a, r.b)),
  );
  for (const definition of data.relations) {
    const key = pairKey(definition.a, definition.b),
      old = oldRelations.get(key);
    let relation = world.relations.find((r) => pairKey(r.a, r.b) === key);
    if (!relation) {
      relation = initialRelation(definition, world.time);
      world.relations.push(relation);
    } else {
      if (!old || old.value !== definition.value) {
        relation.manualDelta += definition.value - relation.value;
        relation.value = definition.value;
      }
      relation.label = definition.label;
    }
  }
  world.rumors = world.rumors
    .map((r) => ({
      ...r,
      expiresAt: r.createdAt + data.rules.rumors.lifetimeMinutes,
    }))
    .filter((r) => r.expiresAt > world.time)
    .slice(-data.rules.rumors.maxActive);
  return { data, world, changes };
}
