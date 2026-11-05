import type { EventKind } from "./types";

export const EVENT_LABELS: Record<EventKind, string> = {
  goal: "新打算",
  move: "在路上",
  encounter: "偶遇",
  conflict: "冲突",
  rumor: "传闻",
  note: "你的纸条",
  meta: "热改",
  system: "世界",
};
