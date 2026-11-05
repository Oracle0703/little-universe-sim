import { EVENT_LABELS } from "../sim/eventKinds";
import { dayOf, formatTime } from "../sim/engine";
import type { EventKind, WorldEvent } from "../sim/types";
import type { InterestingChain, ReviewRun, ReviewSummary } from "./types";

export const eventOrder = (a: WorldEvent, b: WorldEvent) =>
  a.time - b.time || a.id - b.id;
export function summarizeRun(run: ReviewRun): ReviewSummary {
  const byKind = Object.fromEntries(
    Object.keys(EVENT_LABELS).map((kind) => [kind, 0]),
  ) as Record<EventKind, number>;
  for (const event of run.events) byKind[event.kind]++;
  const storyEvents =
    byKind.encounter + byKind.conflict + byKind.rumor + byKind.note;
  const final = run.snapshots.at(-1)!;
  return {
    durationMinutes: run.durationMinutes,
    gameDays: run.durationMinutes / 1440,
    totalEvents: run.events.length,
    byKind,
    eventsPerGameHour: run.events.length / (run.durationMinutes / 60),
    storyEvents,
    storyEventsPerGameHour: storyEvents / (run.durationMinutes / 60),
    relationships: {
      ...final.relationships,
      netWarmedPairs: final.world.relations.filter(
        (r) => r.value - r.initialValue > 1e-9,
      ).length,
      netCooledPairs: final.world.relations.filter(
        (r) => r.value - r.initialValue < -1e-9,
      ).length,
    },
  };
}

export function selectInterestingChains(
  run: ReviewRun,
  limit = 6,
): InterestingChain[] {
  limit = Number.isFinite(limit)
    ? Math.max(0, Math.min(8, Math.floor(limit)))
    : 6;
  if (!limit) return [];
  const events = [...run.events].sort(eventOrder),
    candidates: InterestingChain[] = [];
  const byId = new Map(events.map((event) => [event.id, event]));
  const groups = new Set<string>();
  const add = (
    anchor: WorldEvent,
    id: string,
    category: string,
    title: string,
    score: number,
    chain?: WorldEvent[],
  ) => {
    if (groups.has(id)) return;
    groups.add(id);
    const related = events.filter(
      (e) =>
        e.id !== anchor.id &&
        e.time >= anchor.time - 6 &&
        e.time <= anchor.time + 25 &&
        e.actors.some((actor) => anchor.actors.includes(actor)) &&
        (e.place === anchor.place || e.kind === "move"),
    );
    const context = chain ?? [
      ...related.filter((e) => eventOrder(e, anchor) < 0).slice(-2),
      anchor,
      ...related.filter((e) => eventOrder(e, anchor) > 0).slice(0, 3),
    ];
    const unique = [...new Map(context.map((e) => [e.id, e])).values()].sort(
      eventOrder,
    );
    candidates.push({
      id,
      category,
      title,
      score,
      anchorId: anchor.id,
      time: anchor.time,
      actors: [...anchor.actors],
      place: anchor.place,
      eventIds: unique.map((e) => e.id),
      reason: anchor.reason,
    });
  };
  const rumors = new Map<number, WorldEvent[]>();
  for (const event of events)
    if (event.rumor)
      rumors.set(event.rumor.id, [
        ...(rumors.get(event.rumor.id) ?? []),
        event,
      ]);
  for (const [id, chain] of rumors) {
    const anchor = [...chain].sort(
      (a, b) => b.rumor!.path.length - a.rumor!.path.length || eventOrder(a, b),
    )[0];
    const source = byId.get(anchor.rumor!.sourceEventId);
    add(
      anchor,
      `rumor-${id}`,
      "传闻",
      anchor.rumor!.path.length >= 3
        ? "一句话，传到了第三个人"
        : "有人听说了这件小事",
      anchor.rumor!.path.length >= 3 ? 100 : 65,
      [...(source ? [source] : []), ...chain],
    );
  }
  for (const event of events) {
    if (event.kind === "note")
      add(
        event,
        `note-${event.actors[0]}-${Math.floor(event.time / 60)}`,
        "干预",
        "一张纸条之后的连锁反应",
        110,
      );
    else if (event.conflict?.type === "interruption")
      add(
        event,
        `interruption-${event.id}`,
        "失约",
        "一个人的改道，打断两个人的约定",
        95,
      );
    else if (event.conflict?.type === "resource") {
      const food =
        run.config.places.find((p) => p.id === event.place)?.type === "food";
      add(
        event,
        `resource-${event.place}-${Math.floor((event.time - run.startTime) / 30)}`,
        "资源冲突",
        food ? "午饭到了，座位却不够" : "长椅上的先来后到",
        70 + (food ? 15 : 0) + Math.min(event.conflict.others.length, 3),
      );
    } else if (event.kind === "conflict")
      add(
        event,
        `friction-${[...event.actors].sort().join(":")}-${dayOf(event.time)}`,
        "性格摩擦",
        "「就聊五分钟」也会有摩擦",
        55,
      );
    else if (event.kind === "encounter" && event.encounterTopic)
      add(
        event,
        `encounter-${event.place}-${dayOf(event.time)}`,
        "偶遇",
        event.encounterTopic === "night"
          ? "深夜便利店里的同路人"
          : "一张画，收获了一句夸奖",
        45,
      );
  }
  // A peaceful custom configuration still uses real records; never fabricate missing stories.
  for (const event of events)
    if (event.kind === "move" || event.kind === "encounter")
      add(event, `daily-${event.id}`, "日常", "一个平凡的生活片段", 10);
  const sorted = candidates.sort(
    (a, b) => b.score - a.score || a.time - b.time || a.anchorId - b.anchorId,
  );
  const selected: InterestingChain[] = [],
    categoryCount = new Map<string, number>(),
    used = new Set<number>();
  for (const item of sorted) {
    if (
      (categoryCount.get(item.category) ?? 0) >= 2 ||
      item.eventIds.some((id) => used.has(id))
    )
      continue;
    selected.push(item);
    item.eventIds.forEach((id) => used.add(id));
    categoryCount.set(
      item.category,
      (categoryCount.get(item.category) ?? 0) + 1,
    );
    if (selected.length >= limit) break;
  }
  for (const item of sorted) {
    if (selected.length >= limit) break;
    if (!selected.some((chosen) => chosen.anchorId === item.anchorId))
      selected.push(item);
  }
  return selected.sort(
    (a, b) => b.score - a.score || a.time - b.time || a.anchorId - b.anchorId,
  );
}

const escapeMarkdown = (text: string) =>
  text
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_[\]<>|]/g, (char) => `\\${char}`);
export function reportMarkdown(run: ReviewRun): string {
  const summary = summarizeRun(run),
    samples = selectInterestingChains(run);
  const names = (actors: string[]) =>
    actors
      .map((id) => run.config.agents.find((a) => a.id === id)!.name)
      .join("、") || "世界";
  const when = (time: number) => `D${dayOf(time)} ${formatTime(time)}`;
  return [
    "# 小宇宙 · 创新评审一页纸",
    "",
    "仅供内部评审。所有记录来自真实模拟；不使用 LLM，不生成假事件。",
    "",
    `- 范围：${when(run.startTime)} → ${when(run.endTime)}，${summary.durationMinutes} 游戏分钟 / ${summary.gameDays.toFixed(2)} 游戏天。`,
    `- 换算：×1 时现实 1 秒 = 游戏 1 分钟；本局等价现实 ${(summary.durationMinutes / 60).toFixed(1)} 分钟旁观。`,
    `- 全量日志：${summary.totalEvents}；日志密度：${summary.eventsPerGameHour.toFixed(2)} 条 / 游戏小时。`,
    `- 生活事件：${summary.storyEvents}；生活事件密度：${summary.storyEventsPerGameHour.toFixed(2)} 条 / 游戏小时（偶遇/入座、冲突、传闻、纸条；不含目标、移动、热改、system）。`,
    `- 冲突：${summary.byKind.conflict}；传闻：${summary.byKind.rumor}；纸条：${summary.byKind.note}；热改：${summary.byKind.meta}。`,
    `- 关系升温 ${summary.relationships.warmingCount} 次，摩擦等降温 ${summary.relationships.frictionCoolingCount} 次；自然疏远 ${summary.relationships.decayPairMinutes} 对分钟。`,
    `- 关系增量 +${summary.relationships.warmingAmount.toFixed(2)}，摩擦等减量 −${summary.relationships.frictionCoolingAmount.toFixed(2)}，自然衰减 −${summary.relationships.decayAmount.toFixed(2)}；净升温 ${summary.relationships.netWarmedPairs} 对、净降温 ${summary.relationships.netCooledPairs} 对。`,
    "",
    "| kind | 数量 |",
    "| --- | ---: |",
    ...Object.entries(summary.byKind).map(
      ([kind, count]) =>
        `| ${kind} / ${EVENT_LABELS[kind as EventKind]} | ${count} |`,
    ),
    "",
    "## 趣味样本",
    "",
    ...samples.flatMap((sample, i) => [
      `${i + 1}. **${escapeMarkdown(sample.title)}** · ${when(sample.time)} · 回放 +${sample.time - run.startTime} 分钟 · 事件 #${sample.anchorId}`,
      `   - 谁 / 在哪：${escapeMarkdown(names(sample.actors))} / ${escapeMarkdown(run.config.places.find((p) => p.id === sample.place)!.name)}`,
      `   - 原因 / 路径：${escapeMarkdown(sample.reason)}`,
      `   - 事件链：${sample.eventIds.map((id) => `#${id}`).join(" → ")}`,
      "",
    ]),
    "## 统计口径",
    "",
    "全量日志包含开局 system；生活事件仍是事件条数，不等于独立故事链或内容质量分。升温与摩擦降温按每关系对每游戏分钟的账本增减计一次；自然疏远按发生衰减的关系对×分钟计数，不等同于独立故事数量。新关系以建立时 initialValue 为基线。",
    "",
    "同一配置可复现；趣味分数来自固定规则，同分按时间、事件 id 排序。默认无人干预，note/meta 为 0 是正常结果。普通时间线只展示当前窗口，评审局保留完整事件。",
    "",
  ].join("\n");
}
