import type {
  AgentState,
  Goal,
  Relation,
  RelationState,
  Rumor,
  WorldData,
  WorldEvent,
  WorldState,
} from "./types";

// Internal helpers operate only on the private clone owned by engine.ts.
type Emit = (event: Omit<WorldEvent, "id" | "time">) => WorldEvent;
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const nameOf = (data: WorldData, id: string) =>
  data.agents.find((a) => a.id === id)!.name;
const idOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const signed = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
const timeLabel = (time: number) =>
  `D${Math.floor(time / 1440) + 1} ${String(Math.floor((time % 1440) / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;

export function initialRelation(
  relation: Relation,
  time: number,
): RelationState {
  return {
    ...relation,
    initialValue: relation.value,
    createdAt: time,
    lastInteractionAt: null,
    interactionDelta: 0,
    rumorDelta: 0,
    manualDelta: 0,
    decayTotal: 0,
  };
}

export function changeRelation(
  world: WorldState,
  a: string,
  b: string,
  delta: number,
  source: "interaction" | "rumor",
) {
  let relation = world.relations.find(
    (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a),
  );
  if (!relation) {
    relation = initialRelation(
      { a, b, label: source === "rumor" ? "听闻相识" : "偶遇相识", value: 40 },
      world.time,
    );
    world.relations.push(relation);
  }
  const before = relation.value;
  relation.value = clamp(before + delta);
  const actual = relation.value - before;
  if (source === "interaction") {
    relation.interactionDelta += actual;
    relation.lastInteractionAt = world.time;
  } else relation.rumorDelta += actual;
  return { before, after: relation.value, actual };
}

export function advanceSocialTime(world: WorldState, data: WorldData) {
  const rules = data.rules.relationships;
  for (const relation of world.relations) {
    const lastContact = relation.lastInteractionAt ?? relation.createdAt;
    if (world.time - lastContact <= rules.graceMinutes) continue;
    const rate =
      (rules.decayPerHour / 60) *
      (relation.value >= rules.closeThreshold ? rules.closeMultiplier : 1);
    // Long silence loosens a tie toward a floor; it does not erase it.
    const floor = relation.initialValue * rules.decayFloorRatio;
    const before = relation.value;
    if (before <= floor) continue;
    relation.value = Math.max(floor, clamp(before - rate));
    relation.decayTotal += before - relation.value;
  }
  world.rumors = world.rumors.filter((r) => world.time < r.expiresAt);
  pruneJointPlans(world);
}

export function pruneJointPlans(world: WorldState) {
  world.jointPlans = world.jointPlans.filter(
    (p) =>
      p.until > world.time &&
      p.participants.every((id, i) => {
        const agent = world.agents.find((a) => a.id === id)!;
        return (
          !agent.travel &&
          agent.waitingSince === null &&
          agent.place === p.place &&
          agent.goal?.action === p.actions[i]
        );
      }),
  );
}

/** A positive encounter can become a short, explicit shared arrangement. */
export function arrangeTogether(
  world: WorldState,
  data: WorldData,
  a: AgentState,
  b: AgentState,
): string {
  if (
    !a.goal ||
    !b.goal ||
    a.travel ||
    b.travel ||
    a.place !== b.place ||
    a.waitingSince !== null ||
    b.waitingSince !== null
  )
    return "";
  if (
    [a.goal.action, b.goal.action].some(
      (action) => action === "sleep" || action === "work",
    )
  )
    return "";
  if (
    world.jointPlans.some(
      (p) => p.participants.includes(a.id) || p.participants.includes(b.id),
    )
  )
    return "";
  const label =
    a.goal.action === "eat" && b.goal.action === "eat"
      ? "一起吃完这顿饭"
      : a.goal.action === "sketch" || b.goal.action === "sketch"
        ? "一起看稿聊聊"
        : "聊完这个话题";
  const until = world.time + data.rules.plans.durationMinutes;
  world.jointPlans.push({
    participants: [a.id, b.id],
    place: a.place,
    actions: [a.goal.action, b.goal.action],
    label,
    until,
  });
  return `；共同安排「${label}」至 ${timeLabel(until)}`;
}

export function interruptTogether(
  world: WorldState,
  data: WorldData,
  agent: AgentState,
  goal: Goal,
  emit: Emit,
) {
  if (
    goal.source !== "note" &&
    !(
      goal.source === "need" &&
      goal.action === "sleep" &&
      agent.needs.energy < 20
    )
  )
    return;
  if (agent.goal?.place === goal.place && agent.goal.action === goal.action)
    return;
  const plan = world.jointPlans.find(
    (p) =>
      p.until > world.time &&
      p.participants.includes(agent.id) &&
      p.participants.every((id, i) => {
        const participant = world.agents.find((a) => a.id === id)!;
        return (
          !participant.travel &&
          participant.waitingSince === null &&
          participant.place === p.place &&
          participant.goal?.action === p.actions[i]
        );
      }),
  );
  if (!plan) return;
  const otherId = plan.participants.find((id) => id !== agent.id)!;
  const other = world.agents.find((a) => a.id === otherId)!;
  const previousMood = other.needs.mood;
  other.needs.mood = clamp(
    other.needs.mood - data.rules.plans.interruptionMoodPenalty,
  );
  const change = changeRelation(
    world,
    agent.id,
    otherId,
    -data.rules.plans.interruptionRelationPenalty,
    "interaction",
  );
  const trigger =
    goal.source === "note"
      ? "纸条临时改目标"
      : `精力仅 ${agent.needs.energy.toFixed(1)}，紧急补觉`;
  emit({
    kind: "conflict",
    actors: [agent.id, otherId],
    place: plan.place,
    text: `${nameOf(data, agent.id)}临时改了打算，打断了与${nameOf(data, otherId)}「${plan.label}」的约定；共同安排取消。`,
    reason: `${trigger}；原约定至 ${timeLabel(plan.until)}。结果：${nameOf(data, otherId)}继续自己的安排，心情 ${signed(other.needs.mood - previousMood)}；双方熟悉度 ${change.before.toFixed(1)}→${change.after.toFixed(1)}（失约 ${signed(change.actual)}）`,
    conflict: {
      type: "interruption",
      initiator: agent.id,
      others: [otherId],
      result: "cancel",
    },
  });
  world.jointPlans = world.jointPlans.filter((p) => p !== plan);
}

/** Only actual praise / night-store encounters can seed a rumor; no rumor begets a new seed. */
export function seedRumor(
  world: WorldState,
  data: WorldData,
  event: WorldEvent,
  origin: string,
  subject: string,
  topic: Rumor["topic"],
) {
  const rules = data.rules.rumors;
  if (
    world.lastRumorCreatedAt !== null &&
    world.time - world.lastRumorCreatedAt < rules.sourceCooldownMinutes
  )
    return;
  const text =
    topic === "praise"
      ? `${nameOf(data, subject)}在${data.places.find((p) => p.id === event.place)!.name}的画被夸了，大家说光线画得很好。`
      : `${nameOf(data, subject)}深夜还在便利店，碰到了同样没睡的同事。`;
  const rumor: Rumor = {
    id: world.nextRumorId++,
    topic,
    text,
    subject,
    witnesses: [origin, subject],
    place: event.place,
    sourceEventId: event.id,
    createdAt: world.time,
    expiresAt: world.time + rules.lifetimeMinutes,
    receipts: [{ agent: origin, path: [origin], heardAt: world.time }],
  };
  world.rumors.push(rumor);
  if (world.rumors.length > rules.maxActive) world.rumors.shift();
  world.lastRumorCreatedAt = world.time;
  event.reason += `；这件事成为传闻 #${rumor.id} 的源头（最多 ${rules.maxHops} 跳）`;
}

export function spreadRumors(world: WorldState, data: WorldData, emit: Emit) {
  const rules = data.rules.rumors;
  if (
    world.lastRumorSharedAt !== null &&
    world.time - world.lastRumorSharedAt < rules.broadcastCooldownMinutes
  )
    return;
  for (const rumor of world.rumors) {
    if (rumor.receipts.length - 1 >= rules.maxRecipients) continue;
    // Snapshot: a newly informed resident cannot relay in the same tick.
    for (const receipt of [...rumor.receipts]) {
      if (
        receipt.path.length - 1 >= rules.maxHops ||
        world.time - receipt.heardAt < rules.hopDelayMinutes
      )
        continue;
      const sender = world.agents.find((a) => a.id === receipt.agent)!;
      if (sender.travel || sender.goal?.action === "sleep") continue;
      const candidates = world.relations
        .filter(
          (r) =>
            (r.a === sender.id || r.b === sender.id) &&
            r.value >= rules.minRelation,
        )
        .map((r) => ({ id: r.a === sender.id ? r.b : r.a, value: r.value }))
        .sort((a, b) => b.value - a.value || idOrder(a.id, b.id));
      for (const candidate of candidates) {
        if (
          rumor.witnesses.includes(candidate.id) ||
          rumor.receipts.some((r) => r.agent === candidate.id)
        )
          continue;
        const receiver = world.agents.find((a) => a.id === candidate.id)!;
        const lastHeard = world.rumorRecipientCooldowns[receiver.id];
        if (
          receiver.travel ||
          receiver.place !== sender.place ||
          receiver.goal?.action === "sleep" ||
          (lastHeard !== undefined &&
            world.time - lastHeard < rules.recipientCooldownMinutes)
        )
          continue;
        const beforeMood = receiver.needs.mood;
        receiver.needs.mood = clamp(receiver.needs.mood + rules.moodBoost);
        const change = changeRelation(
          world,
          receiver.id,
          rumor.subject,
          rules.familiarityBoost,
          "rumor",
        );
        const path = [...receipt.path, receiver.id];
        rumor.receipts.push({ agent: receiver.id, path, heardAt: world.time });
        world.rumorRecipientCooldowns[receiver.id] = world.time;
        world.lastRumorSharedAt = world.time;
        const moodDelta = receiver.needs.mood - beforeMood;
        emit({
          kind: "rumor",
          actors: [sender.id, receiver.id],
          place: receiver.place,
          text: `${nameOf(data, sender.id)}告诉${nameOf(data, receiver.id)}：「${rumor.text}」`,
          reason: `源头 #${rumor.sourceEventId} · ${timeLabel(rumor.createdAt)}；路径 ${path.map((id) => nameOf(data, id)).join("→")}（${path.length - 1}/${rules.maxHops} 跳），沿熟人关系在同地转述。${nameOf(data, receiver.id)}心情 ${signed(moodDelta)}；对${nameOf(data, rumor.subject)}熟悉度 ${change.before.toFixed(1)}→${change.after.toFixed(1)}（听闻 ${signed(change.actual)}），不是直接互动`,
          rumor: {
            id: rumor.id,
            path,
            sourceEventId: rumor.sourceEventId,
            subject: rumor.subject,
            moodDelta,
            relationDelta: change.actual,
          },
        });
        return;
      }
    }
  }
}
