export type Action =
  | "sleep"
  | "work"
  | "eat"
  | "chat"
  | "sketch"
  | "walk"
  | "shop"
  | "rest";
export interface Needs {
  energy: number;
  social: number;
  mood: number;
}
export interface Schedule {
  start: string;
  end: string;
  action: Action;
  place: string;
}
export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  home: string;
  initialPlace: string;
  color: string;
  tags: string[];
  bio: string;
  needs: Needs;
  traits: { sociability: number; praiseSensitivity: number; kindness: number };
  favorite: { action: Action; place: string };
  schedule: Schedule[];
}
export interface PlaceDefinition {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  x: number;
  y: number;
  actions: Action[];
  resource?: { name: string; capacity: number; actions: Action[] };
}
export interface Relation {
  a: string;
  b: string;
  label: string;
  value: number;
}
export interface RelationState extends Relation {
  initialValue: number;
  createdAt: number;
  lastInteractionAt: number | null;
  interactionDelta: number;
  rumorDelta: number;
  manualDelta: number;
  decayTotal: number;
}
export interface SimulationRules {
  behavior: {
    favoriteMoodPerMinute: number;
    restMoodPerMinute: number;
    chatSocialPerMinute: number;
    continuationBonus: number;
    maxQueueMinutes: number;
    encounterIntervalMinutes: number;
    pairCooldownMinutes: number;
  };
  activityMinutes: Record<Action, number>;
  relationships: {
    decayPerHour: number;
    graceMinutes: number;
    closeThreshold: number;
    closeMultiplier: number;
  };
  plans: {
    durationMinutes: number;
    queueMoodPenalty: number;
    interruptionMoodPenalty: number;
    interruptionRelationPenalty: number;
  };
  rumors: {
    maxHops: number;
    minRelation: number;
    hopDelayMinutes: number;
    broadcastCooldownMinutes: number;
    recipientCooldownMinutes: number;
    sourceCooldownMinutes: number;
    lifetimeMinutes: number;
    maxActive: number;
    maxRecipients: number;
    moodBoost: number;
    familiarityBoost: number;
  };
}
export interface JointPlan {
  participants: [string, string];
  place: string;
  actions: [Action, Action];
  label: string;
  until: number;
}
export interface Rumor {
  id: number;
  topic: "praise" | "night";
  text: string;
  subject: string;
  witnesses: [string, string];
  place: string;
  sourceEventId: number;
  createdAt: number;
  expiresAt: number;
  receipts: { agent: string; path: string[]; heardAt: number }[];
}
export interface WorldData {
  agents: AgentDefinition[];
  places: PlaceDefinition[];
  relations: Relation[];
  rules: SimulationRules;
}
export interface Goal {
  action: Action;
  place: string;
  reason: string;
  source: "schedule" | "need" | "favorite" | "note";
  score: number;
  scheduleKey?: string;
}
export interface AgentState {
  id: string;
  place: string;
  needs: Needs;
  goal: Goal | null;
  goalSince: number;
  activityMinutes: number;
  travel: { from: string; to: string; remaining: number; total: number } | null;
  waitingSince: number | null;
  hasResource: boolean;
  completedSchedules: string[];
  note: {
    action: Action;
    place: string;
    message: string;
    expiresAt: number;
  } | null;
}
export type EventKind =
  | "goal"
  | "move"
  | "encounter"
  | "conflict"
  | "note"
  | "rumor"
  | "meta"
  | "system";
export interface WorldEvent {
  id: number;
  time: number;
  actors: string[];
  place: string;
  kind: EventKind;
  text: string;
  reason: string;
  decision?: { action: Action; source: Goal["source"] };
  encounterTopic?: "praise" | "night";
  edit?: { author: string; changes: string[] };
  conflict?: {
    type: "resource" | "interruption";
    initiator: string;
    others: string[];
    result: "wait" | "cancel";
    resource?: string;
  };
  rumor?: {
    id: number;
    path: string[];
    sourceEventId: number;
    subject: string;
    moodDelta: number;
    relationDelta: number;
  };
}
export interface WorldState {
  time: number;
  agents: AgentState[];
  relations: RelationState[];
  jointPlans: JointPlan[];
  rumors: Rumor[];
  nextRumorId: number;
  lastRumorCreatedAt: number | null;
  lastRumorSharedAt: number | null;
  rumorRecipientCooldowns: Record<string, number>;
  events: WorldEvent[];
  nextEventId: number;
  notesRemaining: number;
  pairCooldowns: Record<string, number>;
  totalEvents: number;
}
