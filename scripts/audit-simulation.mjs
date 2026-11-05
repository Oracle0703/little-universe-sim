import { createServer } from "vite";
import { writeFile } from "node:fs/promises";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { data } = await server.ssrLoadModule("/src/sim/data.ts");
  const { createWorld, tick } =
    await server.ssrLoadModule("/src/sim/engine.ts");
  let world = createWorld(data);
  const stats = Object.fromEntries(
    data.agents.map((a) => [
      a.id,
      {
        name: a.name,
        zeroMoodMinutes: 0,
        longestZeroMood: 0,
        zeroStreak: 0,
        workMinutes: 0,
        eatMinutes: 0,
        completedShopVisits: 0,
        returnsWithin40Minutes: 0,
        repeatedGoals: 0,
        arrivals: [],
        lastGoal: null,
      },
    ]),
  );
  let reviewEvents = [];
  for (let minute = 1; minute <= 5760; minute++) {
    const previous = world;
    world = tick(world, data);
    const emitted = world.events.filter((e) => e.id >= previous.nextEventId);
    if (minute <= 1800) reviewEvents.push(...emitted);
    for (const a of world.agents) {
      const s = stats[a.id],
        before = previous.agents.find((b) => b.id === a.id);
      if (a.needs.mood < 1) {
        s.zeroMoodMinutes++;
        s.zeroStreak++;
      } else s.zeroStreak = 0;
      s.longestZeroMood = Math.max(s.longestZeroMood, s.zeroStreak);
      if (!a.travel && a.goal?.action === "work") s.workMinutes++;
      if (!a.travel && a.goal?.action === "eat" && a.hasResource)
        s.eatMinutes++;
      if (
        before.goal?.action === "shop" &&
        !before.travel &&
        before.activityMinutes >= data.rules.activityMinutes.shop - 1 &&
        (a.goal === null || a.activityMinutes <= before.activityMinutes)
      )
        s.completedShopVisits++;
    }
    for (const e of emitted) {
      if (e.actors.length !== 1) continue;
      const s = stats[e.actors[0]];
      if (e.kind === "move") {
        s.arrivals.push({ place: e.place, time: e.time });
        const [a, b, c] = s.arrivals.slice(-3);
        if (
          c &&
          a.place === c.place &&
          a.place !== b.place &&
          c.time - a.time <= 40
        )
          s.returnsWithin40Minutes++;
      }
      if (e.kind === "goal") {
        const key = `${e.place}:${e.text}`;
        if (s.lastGoal === key) s.repeatedGoals++;
        s.lastGoal = key;
      }
    }
  }
  const result = {
    minutes: 5760,
    agents: Object.fromEntries(
      Object.entries(stats).map(
        ([id, { arrivals, lastGoal, zeroStreak, ...s }]) => [id, s],
      ),
    ),
    review: {
      events: reviewEvents.length + 1,
      conflict: reviewEvents.filter((e) => e.kind === "conflict").length,
      rumor: reviewEvents.filter((e) => e.kind === "rumor").length,
      day2ParkConflicts: reviewEvents.filter(
        (e) => e.time >= 1440 && e.place === "park" && e.kind === "conflict",
      ).length,
    },
  };
  const text = JSON.stringify(result, null, 2) + "\n";
  if (process.argv[2]) await writeFile(process.argv[2], text, "utf8");
  console.log(text);
} finally {
  await server.close();
}
