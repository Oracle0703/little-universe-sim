import { describe, expect, it } from "vitest";
import { data } from "./data";
import {
  advanceWorld,
  chooseGoal,
  createWorld,
  giveNote,
  tick,
} from "./engine";
import { createSession, sessionReducer } from "./session";

describe("持续生活的行为回归", () => {
  it("非法纸条和跳转反馈错误，reducer 保留原世界而不是抛错", () => {
    const original = createSession(data);
    for (const action of [
      { type: "jump", target: -1 } as const,
      {
        type: "note",
        agent: "missing",
        action: "walk",
        place: "park",
        message: "",
      } as const,
    ]) {
      const rejected = sessionReducer(original, action);
      expect(rejected.world).toBe(original.world);
      expect(rejected.data).toBe(original.data);
      expect(rejected.feedback?.kind).toBe("error");
    }
  });
  it(
    "连续四天不长期零心情，每个完整日仍工作吃饭且无连续空跑",
    { timeout: 20000 },
    () => {
      let world = createWorld(data);
      const stats = Object.fromEntries(
        data.agents.map((a) => [
          a.id,
          {
            zero: 0,
            longestZero: 0,
            streak: 0,
            returns: 0,
            repeated: 0,
            lastGoal: "",
            arrivals: [] as { place: string; time: number }[],
            days: {} as Record<number, { work: number; eat: number }>,
          },
        ]),
      );
      for (let minute = 0; minute < 5760; minute++) {
        const previous = world;
        world = tick(world, data);
        for (const a of world.agents) {
          const s = stats[a.id];
          s.streak = a.needs.mood < 1 ? s.streak + 1 : 0;
          if (a.needs.mood < 1) s.zero++;
          s.longestZero = Math.max(s.longestZero, s.streak);
          const day = (s.days[Math.floor(world.time / 1440)] ??= {
            work: 0,
            eat: 0,
          });
          if (!a.travel && a.goal?.action === "work") day.work++;
          if (!a.travel && a.goal?.action === "eat" && a.hasResource) day.eat++;
        }
        for (const event of world.events.filter(
          (e) => e.id >= previous.nextEventId,
        )) {
          if (event.actors.length !== 1) continue;
          const s = stats[event.actors[0]];
          if (event.kind === "goal") {
            const key = `${event.place}:${event.decision?.action}`;
            if (key === s.lastGoal) s.repeated++;
            s.lastGoal = key;
          }
          if (event.kind === "move") {
            s.arrivals.push({ place: event.place, time: event.time });
            const [a, b, c] = s.arrivals.slice(-3);
            if (
              c &&
              a.place === c.place &&
              a.place !== b.place &&
              c.time - a.time <= 40
            )
              s.returns++;
          }
        }
      }
      for (const [id, s] of Object.entries(stats)) {
        expect(s.longestZero, `${id} 连续近零心情分钟`).toBeLessThan(120);
        expect(s.zero, `${id} 近零心情占比`).toBeLessThan(5760 * 0.05);
        for (const day of [1, 2, 3]) {
          // D2–D4 are complete days, unlike the endpoints.
          expect(s.days[day].work, `${id} D${day + 1} 工作`).toBeGreaterThan(
            180,
          );
          expect(
            s.days[day].eat,
            `${id} D${day + 1} 用餐`,
          ).toBeGreaterThanOrEqual(8);
        }
        expect(s.repeated, `${id} 连续重复决定`).toBe(0);
        // A completed errand followed by sleep can legitimately return home; forbid sustained shuttling.
        expect(s.returns, `${id} 40 分钟内折返`).toBeLessThanOrEqual(4);
      }
    },
  );

  it("零心情的聊天与休息偏好都能恢复，独处时有可行退路", () => {
    for (const id of ["zhou", "miao", "chen"]) {
      const config = structuredClone(data);
      config.agents = config.agents.filter((a) => a.id === id);
      config.relations = [];
      const def = config.agents[0];
      def.schedule = [];
      def.initialPlace = def.home;
      def.needs = { energy: 90, social: 90, mood: 0 };
      const after = advanceWorld(createWorld(config), config, 240);
      expect(after.agents[0].needs.mood, id).toBeGreaterThan(20);
      expect(after.agents[0].goal?.action).not.toBe("chat");
    }
  });

  it("到站后的活动时长不含路途，便利店目标完成前不因小幅效用差折返", () => {
    const config = structuredClone(data);
    config.agents = [config.agents[0]];
    config.relations = [];
    const def = config.agents[0];
    def.schedule = [];
    def.initialPlace = def.home;
    def.needs = { energy: 44, social: 90, mood: 60 };
    let world = createWorld(config);
    world = tick(world, config);
    expect(world.agents[0].goal?.action).toBe("shop");
    expect(world.agents[0].travel).not.toBeNull();
    while (world.agents[0].travel) world = tick(world, config);
    const arrived = world.time;
    for (let i = 1; i < config.rules.activityMinutes.shop; i++) {
      expect(world.agents[0].place).toBe(def.favorite.place);
      expect(world.agents[0].travel).toBeNull();
      expect(world.agents[0].goal?.action).toBe("shop");
      world = tick(world, config);
    }
    expect(world.time - arrived + 1).toBe(config.rules.activityMinutes.shop);
    expect(world.agents[0].activityMinutes).toBe(
      config.rules.activityMinutes.shop,
    );
  });

  it("聊天只选有醒着伙伴的地点，实际聊天提高社交，独处不凭空加分", () => {
    const config = structuredClone(data);
    config.agents = config.agents.filter((a) =>
      ["zhou", "miao"].includes(a.id),
    );
    config.relations = config.relations.filter((r) =>
      [r.a, r.b].every((id) => ["zhou", "miao"].includes(id)),
    );
    for (const def of config.agents) {
      def.initialPlace = "park";
      def.schedule = [];
      def.needs = { energy: 90, social: 10, mood: 10 };
    }
    let world = createWorld(config);
    const after = tick(world, config); // 11:41 is not an encounter minute.
    expect(after.agents[0].goal?.action).toBe("chat");
    expect(after.agents[0].needs.social).toBeGreaterThan(
      world.agents[0].needs.social,
    );
    world.agents[1].place = "home-a";
    world.agents[1].goal = {
      action: "sleep",
      place: "home-a",
      source: "schedule",
      reason: "睡眠",
      score: 120,
    };
    expect(
      chooseGoal(world.agents[0], config.agents[0], world, config).action,
    ).not.toBe("chat");
    world = giveNote(world, config, "zhou", "chat", "park");
    const alone = tick(world, config);
    expect(alone.agents[0].needs.social).toBeLessThan(
      world.agents[0].needs.social,
    );
  });

  it("活动保持不阻止纸条、到期和紧急补觉，收益与时长热改读取新配置", () => {
    let session = createSession(data);
    session = sessionReducer(session, {
      type: "note",
      agent: "amin",
      action: "shop",
      place: "store",
      message: "试走",
    });
    session = sessionReducer(session, { type: "tick", minutes: 12 });
    const hot = structuredClone(data);
    hot.rules.behavior.favoriteMoodPerMinute = 1;
    hot.rules.activityMinutes.shop = 30;
    session = sessionReducer(session, { type: "apply", candidate: hot });
    expect(session.feedback?.kind).toBe("success");
    expect(session.world.events.at(-1)?.reason).toContain(
      "favoriteMoodPerMinute",
    );
    const beforeMood = session.world.agents[0].needs.mood;
    session = sessionReducer(session, { type: "tick", minutes: 1 });
    expect(session.world.agents[0].needs.mood - beforeMood).toBeGreaterThan(1);
    session = sessionReducer(session, { type: "tick", minutes: 47 });
    expect(session.world.agents[0].note).toBeNull();
    expect(session.world.notesRemaining).toBe(0);
    session.world.agents[0].needs.energy = 1;
    const urgent = advanceWorld(session.world, hot, 20); // Finish any in-flight return leg before rerouting.
    expect(urgent.agents[0].goal?.action).toBe("sleep");
  });
});
