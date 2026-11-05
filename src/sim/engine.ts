import { ACTIONS, validateData } from "./data";
import { reconcileConfiguration } from "./configuration";
import {
  advanceSocialTime,
  arrangeTogether,
  changeRelation,
  initialRelation,
  interruptTogether,
  pruneJointPlans,
  seedRumor,
  spreadRumors,
} from "./social";
import type {
  AgentDefinition,
  AgentState,
  Goal,
  Action,
  WorldData,
  WorldEvent,
  WorldState,
} from "./types";

export const START_TIME = 11 * 60 + 40;
export const MAX_EVENTS = 240;
export const NOTE_MINUTES = 60;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
export const minuteOfDay = (time: number) => ((time % 1440) + 1440) % 1440;
export function formatTime(time: number): string {
  const m = minuteOfDay(time);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export const dayOf = (time: number) => Math.floor(time / 1440) + 1;
const parseTime = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/** Stable hash in [0, 1): the same seed and key always give the same value, no Math.random. */
function hash01(seed: number, key: string) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A resident's whole day runs a little early or late. Day index 0 (D1) stays fixed so the
 * guided demo and its checkpoints are stable; later days vary by seed.
 */
export function dayShift(data: WorldData, agentId: string, day: number) {
  const { seed, scheduleJitterMinutes } = data.rules.variation;
  if (day <= 0 || scheduleJitterMinutes === 0) return 0;
  return Math.round(
    (hash01(seed, `${agentId}:${day}`) * 2 - 1) * scheduleJitterMinutes,
  );
}

/** Absolute [start, end) of every schedule block that starts on `day`, after that day's shift. */
function blocksOn(def: AgentDefinition, data: WorldData, day: number) {
  const shift = dayShift(data, def.id, day);
  return def.schedule.map((schedule, index) => {
    const start = parseTime(schedule.start),
      end = parseTime(schedule.end);
    return {
      schedule,
      index,
      day,
      start: day * 1440 + start + shift,
      end: day * 1440 + end + (end <= start ? 1440 : 0) + shift,
    };
  });
}

function activeSchedule(def: AgentDefinition, data: WorldData, time: number) {
  const today = Math.floor(time / 1440);
  const blocks = [today - 1, today, today + 1].flatMap((day) =>
    blocksOn(def, data, day),
  );
  // JSON order still wins overlaps; the earlier start day wins for the same entry.
  const active = blocks
    .filter((b) => b.start <= time && time < b.end)
    .sort((a, b) => a.index - b.index || a.day - b.day)[0];
  if (!active) return null;
  return { ...active.schedule, key: `${active.day}:${active.index}` };
}

/** The next block that has not started yet, so autonomous errands can avoid running into it. */
function upcomingSchedule(def: AgentDefinition, data: WorldData, time: number) {
  const today = Math.floor(time / 1440);
  return [today, today + 1]
    .flatMap((day) => blocksOn(def, data, day))
    .filter((b) => b.start > time)
    .sort((a, b) => a.start - b.start)[0];
}

function travelMinutes(data: WorldData, from: string, to: string) {
  if (from === to) return 0;
  const a = data.places.find((p) => p.id === from)!;
  const b = data.places.find((p) => p.id === to)!;
  return 2 + Math.abs(a.x - b.x) * 2 + Math.abs(a.y - b.y) * 2;
}

function chatPartners(agent: AgentState, world: WorldState, place: string) {
  return world.agents.filter(
    (other) =>
      other.id !== agent.id &&
      !other.travel &&
      other.place === place &&
      other.goal?.action !== "sleep",
  );
}

/** Pure utility decision: schedules, satisfaction, personality and a temporary note. */
export function chooseGoal(
  agent: AgentState,
  def: AgentDefinition,
  world: WorldState,
  data: WorldData,
): Goal {
  if (agent.note && agent.note.expiresAt > world.time)
    return {
      action: agent.note.action,
      place: agent.note.place,
      score: 1000,
      source: "note",
      reason: `收到你的纸条，临时改道至 ${formatTime(agent.note.expiresAt)}`,
    };
  const schedule = activeSchedule(def, data, world.time);
  const candidates: Goal[] = [];
  if (
    schedule &&
    !agent.completedSchedules.includes(schedule.key) &&
    (schedule.action !== "chat" ||
      chatPartners(agent, world, schedule.place).length > 0)
  )
    candidates.push({
      action: schedule.action,
      place: schedule.place,
      source: "schedule",
      scheduleKey: schedule.key,
      score: schedule.action === "sleep" ? 120 : 76,
      reason: `作息安排：${schedule.start}–${schedule.end} ${ACTIONS[schedule.action]}`,
    });
  candidates.push({
    action: "rest",
    place: def.home,
    source: "need",
    score: 18 + (100 - agent.needs.energy) * 0.55,
    reason: `精力 ${Math.round(agent.needs.energy)}，想回家缓一缓`,
  });
  if (agent.needs.energy < 20)
    candidates.push({
      action: "sleep",
      place: def.home,
      source: "need",
      score: 160,
      reason: `精力仅 ${Math.round(agent.needs.energy)}，优先补觉`,
    });
  const chatPlace = data.places
    .filter((p) => p.actions.includes("chat"))
    .map((p) => {
      const people = chatPartners(agent, world, p.id);
      const affinity = people.reduce(
        (sum, other) =>
          sum +
          (world.relations.find(
            (r) =>
              (r.a === agent.id && r.b === other.id) ||
              (r.b === agent.id && r.a === other.id),
          )?.value ?? 35),
        0,
      );
      return {
        id: p.id,
        people: people.length,
        score:
          people.length * 10 + affinity / 20 + (p.id === agent.place ? 2 : 0),
      };
    })
    .filter((p) => p.people > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
  if (chatPlace)
    candidates.push({
      action: "chat",
      place: chatPlace.id,
      source: "need",
      score: (100 - agent.needs.social) * (0.5 + def.traits.sociability * 0.7),
      reason: `社交满足 ${Math.round(agent.needs.social)}，想找熟人说说话`,
    });
  const favorite =
    def.favorite.action !== "chat"
      ? def.favorite
      : {
          action: (chatPlace ? "chat" : "rest") as Action,
          place: chatPartners(agent, world, def.favorite.place).length
            ? def.favorite.place
            : (chatPlace?.id ?? def.home),
        };
  candidates.push({
    ...favorite,
    source: "favorite",
    score: 24 + (100 - agent.needs.mood) * 0.65,
    reason:
      def.favorite.action === "chat" && !chatPlace
        ? "暂时没有醒着的聊天伙伴，先回家休息调整心情"
        : `心情 ${Math.round(agent.needs.mood)}，做点自己喜欢的事`,
  });
  for (const candidate of candidates) {
    if (
      candidate.action === agent.goal?.action &&
      candidate.place === agent.goal.place
    )
      candidate.score += data.rules.behavior.continuationBonus;
    // Optional plans give way to a full seat instead of re-queuing behind people already waiting.
    const resource = data.places.find(
      (p) => p.id === candidate.place,
    )!.resource;
    if (
      candidate.source !== "schedule" &&
      resource?.actions.includes(candidate.action) &&
      world.agents.filter(
        (o) =>
          o.id !== agent.id &&
          !o.travel &&
          o.place === candidate.place &&
          o.goal &&
          resource.actions.includes(o.goal.action),
      ).length >= resource.capacity
    )
      candidate.score -= data.rules.behavior.crowdedResourcePenalty;
  }
  // Do not set off on an errand when not even half of it fits before the next schedule block.
  const upcoming = upcomingSchedule(def, data, world.time);
  const feasible = upcoming
    ? candidates.filter(
        (c) =>
          c.source === "schedule" ||
          c.score >= 150 ||
          c.place === agent.place ||
          c.place === upcoming.schedule.place ||
          travelMinutes(data, agent.place, c.place) +
            Math.ceil(data.rules.activityMinutes[c.action] / 2) <=
            upcoming.start - world.time,
      )
    : candidates;
  if (feasible.length < candidates.length) {
    const here = data.places.find((p) => p.id === agent.place)!;
    if (here.actions.includes("rest"))
      feasible.push({
        action: "rest",
        place: here.id,
        source: "need",
        score: 10,
        reason: `${formatTime(upcoming!.start)} 起要${ACTIONS[upcoming!.schedule.action]}，来不及出门，就近歇一会儿`,
      });
  }
  return (feasible.length ? feasible : candidates).sort(
    (a, b) => b.score - a.score,
  )[0];
}

function log(world: WorldState, event: Omit<WorldEvent, "id" | "time">) {
  const entry = { ...event, id: world.nextEventId++, time: world.time };
  world.events.push(entry);
  world.totalEvents++;
  if (world.events.length > MAX_EVENTS)
    world.events.splice(0, world.events.length - MAX_EVENTS);
  return entry;
}

export function createWorld(data: WorldData): WorldState {
  validateData(data);
  const world: WorldState = {
    time: START_TIME,
    agents: data.agents.map((a) => ({
      id: a.id,
      place: a.initialPlace,
      needs: { ...a.needs },
      goal: null,
      goalSince: START_TIME,
      activityMinutes: 0,
      travel: null,
      waitingSince: null,
      hasResource: false,
      completedSchedules: [],
      note: null,
    })),
    relations: data.relations.map((r) => initialRelation(r, START_TIME)),
    jointPlans: [],
    rumors: [],
    nextRumorId: 1,
    lastRumorCreatedAt: null,
    lastRumorSharedAt: null,
    rumorRecipientCooldowns: {},
    events: [],
    nextEventId: 1,
    notesRemaining: 1,
    pairCooldowns: {},
    totalEvents: 0,
  };
  log(world, {
    actors: [],
    place:
      data.places.find((p) => p.type === "office")?.id ?? data.places[0].id,
    kind: "system",
    text: "新的一天，生活已经开始。",
    reason: `${data.agents.length} 位居民按作息与需求自主行动。你可以只做一个旁观者。`,
  });
  return world;
}

function setGoal(
  world: WorldState,
  agent: AgentState,
  goal: Goal,
  data: WorldData,
) {
  interruptTogether(world, data, agent, goal, (event) => log(world, event));
  agent.goal = goal;
  agent.goalSince = world.time;
  agent.activityMinutes = 0;
  agent.hasResource = false;
  agent.waitingSince = null;
  const name = data.agents.find((a) => a.id === agent.id)!.name;
  const previousDecision = [...world.events]
    .reverse()
    .find((e) => e.kind === "goal" && e.actors[0] === agent.id);
  if (
    previousDecision?.decision?.action !== goal.action ||
    previousDecision?.place !== goal.place
  )
    log(world, {
      actors: [agent.id],
      place: goal.place,
      kind: "goal",
      text: `${name}决定${ACTIONS[goal.action]}。`,
      reason: goal.reason,
      decision: { action: goal.action, source: goal.source },
    });
  startTravel(agent, data);
}

/** Starting the remaining leg of a note's detour is not a second decision. */
function startTravel(agent: AgentState, data: WorldData) {
  if (agent.goal && agent.place !== agent.goal.place && !agent.travel) {
    const minutes = travelMinutes(data, agent.place, agent.goal.place);
    agent.travel = {
      from: agent.place,
      to: agent.goal.place,
      remaining: minutes,
      total: minutes,
    };
  }
}

function allocateResources(world: WorldState, data: WorldData) {
  for (const place of data.places) {
    if (!place.resource) continue;
    const resource = place.resource;
    const candidates = world.agents.filter(
      (a) =>
        !a.travel &&
        a.place === place.id &&
        a.goal &&
        resource.actions.includes(a.goal.action),
    );
    // Occupants finish their activity; everyone else queues by arrival, then stable id.
    candidates.sort(
      (a, b) =>
        Number(b.hasResource) - Number(a.hasResource) ||
        (a.waitingSince ?? world.time) - (b.waitingSince ?? world.time) ||
        a.id.localeCompare(b.id),
    );
    candidates.forEach((agent, i) => {
      const hadSeat = agent.hasResource;
      agent.hasResource = i < resource.capacity;
      if (agent.hasResource) {
        if (agent.waitingSince !== null)
          log(world, {
            actors: [agent.id],
            place: place.id,
            kind: "encounter",
            text: `${data.agents.find((a) => a.id === agent.id)!.name}终于等到了${resource.name}。`,
            reason: `按到达顺序排队，等待了 ${world.time - agent.waitingSince} 分钟`,
          });
        agent.waitingSince = null;
      } else if (agent.waitingSince === null || hadSeat) {
        agent.waitingSince = world.time;
        const previousMood = agent.needs.mood;
        agent.needs.mood = clamp(
          agent.needs.mood - data.rules.plans.queueMoodPenalty,
        );
        const holders = candidates.slice(0, resource.capacity);
        const name = data.agents.find((a) => a.id === agent.id)!.name;
        const holderNames = holders
          .map((a) => data.agents.find((d) => d.id === a.id)!.name)
          .join("、");
        const holderPlans = holders
          .map(
            (a) =>
              `${data.agents.find((d) => d.id === a.id)!.name}「${ACTIONS[a.goal!.action]}」`,
          )
          .join("、");
        log(world, {
          actors: [agent.id, ...holders.map((a) => a.id)],
          place: place.id,
          kind: "conflict",
          text: `${name}想${ACTIONS[agent.goal!.action]}，却与${holderNames}争用${resource.name}；先到者继续，${name}排队等位。`,
          reason: `${name}「${ACTIONS[agent.goal!.action]}」与 ${holderPlans} 的计划冲突：${resource.name}只有 ${resource.capacity} 个。结果：先到者保留位置，${name}延后计划，心情 ${previousMood.toFixed(1)}→${agent.needs.mood.toFixed(1)}（等待 −${(previousMood - agent.needs.mood).toFixed(1)}）`,
          conflict: {
            type: "resource",
            initiator: agent.id,
            others: holders.map((a) => a.id),
            result: "wait",
            resource: resource.name,
          },
        });
      }
    });
  }
}

function interact(world: WorldState, data: WorldData) {
  const { encounterIntervalMinutes, pairCooldownMinutes } = data.rules.behavior;
  if (world.time % encounterIntervalMinutes !== 0) return;
  for (const place of data.places) {
    const residents = world.agents.filter(
      (a) => a.place === place.id && !a.travel && a.goal?.action !== "sleep",
    );
    if (residents.length < 2) continue;
    const offset =
      Math.floor(world.time / encounterIntervalMinutes) % residents.length;
    const ordered = [...residents.slice(offset), ...residents.slice(0, offset)];
    let found = false;
    for (let i = 0; i < ordered.length && !found; i++) {
      for (let j = i + 1; j < ordered.length && !found; j++) {
        const a = ordered[i],
          b = ordered[j];
        const key = [a.id, b.id].sort().join(":");
        if (
          (world.pairCooldowns[key] ?? -1000) >
          world.time - pairCooldownMinutes
        )
          continue;
        const nightStore =
          place.type === "shop" && minuteOfDay(world.time) >= 22 * 60;
        if (
          !place.resource &&
          !nightStore &&
          a.goal?.action !== "chat" &&
          b.goal?.action !== "chat" &&
          a.needs.social > 60 &&
          b.needs.social > 60
        )
          continue;
        const da = data.agents.find((d) => d.id === a.id)!,
          db = data.agents.find((d) => d.id === b.id)!;
        let text = `${da.name}和${db.name}聊了几句，气氛轻松了一点。`;
        let reason = "同处一个地点，遇见彼此；社交 +10，关系 +2";
        let delta = 2;
        let rumorSeed: {
          origin: string;
          subject: string;
          topic: "praise" | "night";
        } | null = null;
        const artist =
          da.traits.praiseSensitivity > 0 &&
          a.goal?.action === "sketch" &&
          a.waitingSince === null
            ? { agent: a, def: da, other: db }
            : db.traits.praiseSensitivity > 0 &&
                b.goal?.action === "sketch" &&
                b.waitingSince === null
              ? { agent: b, def: db, other: da }
              : null;
        if (artist && artist.other.traits.kindness >= 0.65) {
          const boost = Math.round(14 * artist.def.traits.praiseSensitivity);
          artist.agent.needs.mood = clamp(artist.agent.needs.mood + boost);
          text = `${artist.other.name}看了看${artist.def.name}的画：「这张的光线真好。」`;
          reason = `正在写生 + 热心的同行者；${artist.def.name}被肯定，心情 +${boost}，关系 +2`;
          rumorSeed = {
            origin: artist.other.id,
            subject: artist.def.id,
            topic: "praise",
          };
        } else if (
          (da.traits.sociability < 0.4 && db.traits.sociability > 0.9) ||
          (db.traits.sociability < 0.4 && da.traits.sociability > 0.9)
        ) {
          const introvert = da.traits.sociability < 0.4 ? a : b;
          const quiet = da.traits.sociability < 0.4 ? da : db,
            talkative = quiet === da ? db : da;
          introvert.needs.mood = clamp(introvert.needs.mood - 4);
          text = `${talkative.name}提议「就聊五分钟」，${quiet.name}默默往旁边挪了挪。`;
          reason = "外向与慢热的节奏不合；被打扰者心情 −4，关系 −2";
          delta = -2;
        } else if (
          place.type === "food" &&
          (da.tags.includes("电话不停") || db.tags.includes("电话不停"))
        ) {
          const caller = da.tags.includes("电话不停") ? da : db;
          text = `${caller.name}边吃边接电话，同桌指了指快凉的饭。`;
          reason = "忙碌作息在共享餐桌相遇；一次日常关照，关系 +2";
        } else if (
          place.type === "shop" &&
          minuteOfDay(world.time) >= 22 * 60
        ) {
          text = `${da.name}和${db.name}在便利店相视一笑：「你也还没睡。」`;
          reason = "互补作息在深夜重叠；社交 +10，关系 +2";
          rumorSeed = { origin: a.id, subject: b.id, topic: "night" };
        }
        a.needs.social = clamp(a.needs.social + 10);
        b.needs.social = clamp(b.needs.social + 10);
        const change = changeRelation(world, a.id, b.id, delta, "interaction");
        reason += `；实际熟悉度 ${change.before.toFixed(1)}→${change.after.toFixed(1)}`;
        if (delta > 0) reason += arrangeTogether(world, data, a, b);
        world.pairCooldowns[key] = world.time;
        const event = log(world, {
          actors: [a.id, b.id],
          place: place.id,
          kind: delta < 0 ? "conflict" : "encounter",
          text,
          reason,
          ...(rumorSeed ? { encounterTopic: rumorSeed.topic } : {}),
        });
        if (rumorSeed)
          seedRumor(
            world,
            data,
            event,
            rumorSeed.origin,
            rumorSeed.subject,
            rumorSeed.topic,
          );
        found = true;
      }
    }
  }
}

/** One tick = one in-game minute. Never reads wall time, the DOM or network. */
function tickMutable(world: WorldState, data: WorldData) {
  world.time++;
  advanceSocialTime(world, data);
  for (const agent of world.agents) {
    const def = data.agents.find((d) => d.id === agent.id)!;
    agent.needs.energy = clamp(
      agent.needs.energy - (agent.travel ? 0.14 : 0.08),
    );
    agent.needs.social = clamp(
      agent.needs.social - (0.04 + def.traits.sociability * 0.1),
    );
    agent.needs.mood = clamp(
      agent.needs.mood - (0.025 + def.traits.praiseSensitivity * 0.045),
    );
    if (agent.note && world.time >= agent.note.expiresAt) {
      log(world, {
        actors: [agent.id],
        place: agent.place,
        kind: "note",
        text: `${def.name}收起纸条，重新安排自己的生活。`,
        reason: "临时目标已满 60 分钟，恢复作息与需求决策",
      });
      agent.note = null;
      agent.goal = null;
    }
    agent.completedSchedules = agent.completedSchedules.filter(
      (key) => Number(key.split(":")[0]) >= Math.floor(world.time / 1440) - 1,
    );
    if (agent.travel) {
      agent.travel.remaining--;
      if (agent.travel.remaining > 0) continue;
      agent.place = agent.travel.to;
      agent.travel = null;
      log(world, {
        actors: [agent.id],
        place: agent.place,
        kind: "move",
        text: `${def.name}到了${data.places.find((p) => p.id === agent.place)!.name}。`,
        reason: agent.goal?.reason ?? "走完当前路段，再重新选择目标",
      });
    }
    const next = chooseGoal(agent, def, world, data);
    const current = agent.goal;
    const scheduleChanged =
      current?.source === "schedule" &&
      current.scheduleKey !== activeSchedule(def, data, world.time)?.key;
    const changed =
      !current ||
      current.action !== next.action ||
      current.place !== next.place ||
      current.scheduleKey !== next.scheduleKey ||
      current.source !== next.source;
    const canChange =
      !current ||
      next.source === "note" ||
      next.score >= 150 ||
      scheduleChanged ||
      (next.source === "schedule" && current.source !== "schedule") ||
      (current.action === "chat" &&
        chatPartners(agent, world, agent.place).length === 0) ||
      (agent.waitingSince !== null &&
        world.time - agent.waitingSince >=
          data.rules.behavior.maxQueueMinutes) ||
      agent.activityMinutes >= data.rules.activityMinutes[current.action];
    if (changed && canChange) {
      if (
        current &&
        current.action === next.action &&
        current.place === next.place
      )
        agent.goal = next; // Same activity: preserve progress and resources when only its motive changes.
      else setGoal(world, agent, next, data);
    }
    startTravel(agent, data);
    if (
      agent.goal &&
      !["sleep", "work"].includes(agent.goal.action) &&
      agent.activityMinutes >= data.rules.activityMinutes[agent.goal.action]
    )
      agent.activityMinutes = 0;
  }
  allocateResources(world, data);
  for (const agent of world.agents) {
    if (agent.travel || !agent.goal) continue;
    const place = data.places.find((p) => p.id === agent.place)!;
    if (
      place.resource?.actions.includes(agent.goal.action) &&
      !agent.hasResource
    )
      continue;
    agent.activityMinutes++;
    const action = agent.goal.action;
    const def = data.agents.find((d) => d.id === agent.id)!;
    const hasPartner =
      action !== "chat" || chatPartners(agent, world, agent.place).length > 0;
    if (!hasPartner) {
      agent.activityMinutes--;
      continue;
    }
    if (action === "sleep")
      agent.needs.energy = clamp(agent.needs.energy + 0.7);
    if (action === "rest")
      agent.needs.energy = clamp(agent.needs.energy + 0.35);
    if (action === "eat") agent.needs.energy = clamp(agent.needs.energy + 0.65);
    // Activity mood gains taper toward 100: full effect when low, little when already content.
    let moodGain = 0;
    if (["sketch", "walk", "shop"].includes(action)) moodGain += 0.14;
    if (action === "rest") moodGain += data.rules.behavior.restMoodPerMinute;
    if (action === def.favorite.action)
      moodGain += data.rules.behavior.favoriteMoodPerMinute;
    agent.needs.mood = clamp(
      agent.needs.mood + moodGain * (1 - agent.needs.mood / 100),
    );
    if (action === "chat")
      agent.needs.social = clamp(
        agent.needs.social + data.rules.behavior.chatSocialPerMinute,
      );
    if (
      agent.activityMinutes >= data.rules.activityMinutes[action] &&
      agent.goal.source !== "note" &&
      !["work", "sleep"].includes(action)
    ) {
      if (agent.goal.scheduleKey) {
        agent.completedSchedules.push(agent.goal.scheduleKey);
        agent.goal = null;
      }
      agent.hasResource = false;
      agent.waitingSince = null;
    }
  }
  pruneJointPlans(world);
  interact(world, data);
  spreadRumors(world, data, (event) => log(world, event));
}

/** Demo checkpoints are absolute game minutes, never a next-day clock rollover. */
export function advanceTo(
  world: WorldState,
  data: WorldData,
  target: number,
): WorldState {
  if (!Number.isInteger(target) || target < 0)
    throw new Error("演示时刻须为非负整分钟");
  return advanceWorld(
    world,
    data,
    Math.max(0, Math.min(1440, target - world.time)),
  );
}

export function advanceWorld(
  previous: WorldState,
  data: WorldData,
  minutes = 1,
): WorldState {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
    throw new Error("单次推进须为 0–1440 个整分钟");
  if (minutes === 0) return previous;
  const world = structuredClone(previous);
  for (let i = 0; i < minutes; i++) tickMutable(world, data);
  return world;
}

export function applyConfiguration(
  previous: WorldState,
  oldData: WorldData,
  candidate: unknown,
) {
  const result = reconcileConfiguration(previous, oldData, candidate);
  if (result.changes.length > 0) {
    allocateResources(result.world, result.data);
    pruneJointPlans(result.world);
  }
  const summary = result.changes.length
    ? result.changes.slice(0, 8).join("；") +
      (result.changes.length > 8 ? `；另 ${result.changes.length - 8} 项` : "")
    : "相同配置再次应用，无字段变更";
  log(result.world, {
    kind: "meta",
    actors: [],
    place:
      result.data.places.find((p) => p.type === "office")?.id ??
      result.data.places[0].id,
    text: `本页策划应用热改：${result.changes.length} 项配置变更。`,
    reason: `${summary}。保留当前时刻、纸条额度与未到期纸条；下一 tick 使用新配置。`,
    edit: { author: "本页策划", changes: result.changes },
  });
  return result;
}
export const tick = (world: WorldState, data: WorldData) =>
  advanceWorld(world, data, 1);

export function giveNote(
  previous: WorldState,
  data: WorldData,
  agentId: string,
  action: Action,
  place: string,
  message = "",
): WorldState {
  if (previous.notesRemaining < 1)
    throw new Error("这轮的纸条已经用过了；重新开始可恢复。");
  if (!data.places.find((p) => p.id === place)?.actions.includes(action))
    throw new Error("这个地点不支持该目标。");
  const world = structuredClone(previous);
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("找不到这位居民。");
  agent.note = {
    action,
    place,
    message: message.trim().slice(0, 80),
    expiresAt: world.time + NOTE_MINUTES,
  };
  world.notesRemaining--;
  log(world, {
    actors: [agentId],
    place,
    kind: "note",
    text: `你给${data.agents.find((a) => a.id === agentId)!.name}塞了一张纸条：「${agent.note.message || ACTIONS[action]}」`,
    reason: `临时目标：${data.places.find((p) => p.id === place)!.name} · ${ACTIONS[action]}，持续 60 分钟；路途中会先走完当前路段`,
  });
  // Preserve an in-progress route: no teleportation, then reroute on arrival.
  setGoal(
    world,
    agent,
    chooseGoal(agent, data.agents.find((a) => a.id === agentId)!, world, data),
    data,
  );
  return world;
}
