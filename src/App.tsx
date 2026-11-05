import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Coffee,
  Footprints,
  Home,
  History,
  Leaf,
  MapPin,
  MessageCircle,
  Moon,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Store,
  Sun,
  Users,
  Utensils,
  X,
  Zap,
} from "lucide-react";
import { ACTIONS } from "./sim/data";
import { dayOf, formatTime, minuteOfDay } from "./sim/engine";
import type {
  Action,
  AgentDefinition,
  AgentState,
  EventKind,
  PlaceDefinition,
  WorldState,
} from "./sim/types";
import { useSimulation, type Speed } from "./useSimulation";
import { RelationshipChange, SocialContext } from "./components/SocialDetails";
import { PlannerPanel } from "./components/PlannerPanel";
import { WorldDataProvider, useWorldData } from "./WorldDataContext";
import { ReviewPanel } from "./components/ReviewPanel";

const placeIcons = {
  home: Home,
  office: Coffee,
  food: Utensils,
  park: Leaf,
  shop: Store,
};
const kindLabels: Record<EventKind, string> = {
  goal: "新打算",
  move: "在路上",
  encounter: "偶遇",
  conflict: "冲突",
  note: "你的纸条",
  rumor: "传闻",
  meta: "热改",
  system: "世界",
};
const sourceLabels = {
  schedule: "作息驱动",
  need: "需求驱动",
  favorite: "个人偏好",
  note: "纸条干预",
};

function Avatar({
  def,
  small = false,
}: {
  def: AgentDefinition;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{ "--avatar-color": def.color } as CSSProperties}
    >
      <span className="avatar-hair" />
      <span className="avatar-face">
        <i />
        <i />
      </span>
      <span className="avatar-shirt" />
    </span>
  );
}

function Resident({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentState;
  selected: boolean;
  onSelect: () => void;
}) {
  const { agentById } = useWorldData();
  const def = agentById.get(agent.id)!;
  return (
    <button
      className={`resident ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-label={`查看${def.name}`}
      aria-pressed={selected}
      title={`${def.name} · ${agent.waitingSince !== null ? "等待空位" : agent.goal ? ACTIONS[agent.goal.action] : "想一想"}`}
    >
      <Avatar def={def} small />
      <span>{def.name}</span>
      <span
        className={`activity-dot ${agent.waitingSince !== null ? "waiting" : ""}`}
      >
        {agent.waitingSince !== null
          ? "…"
          : agent.goal?.action === "sleep"
            ? "z"
            : ""}
      </span>
    </button>
  );
}

function Place({
  place,
  world,
  selected,
  onSelect,
}: {
  place: PlaceDefinition;
  world: WorldState;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const Icon = placeIcons[place.type as keyof typeof placeIcons] ?? MapPin;
  const residents = world.agents.filter(
    (a) => a.place === place.id && !a.travel,
  );
  const occupied = residents.filter((a) => a.hasResource).length;
  const waiting = residents.filter((a) => a.waitingSince !== null).length;
  const selectedHere = residents.some((a) => a.id === selected);
  return (
    <section
      className={`place place-${place.type} ${selectedHere ? "has-selected" : ""}`}
      aria-label={`${place.name}，${residents.length} 位居民`}
    >
      <div className="place-heading">
        <span className="place-icon">
          <Icon size={19} strokeWidth={1.6} />
        </span>
        <div>
          <h3>{place.name}</h3>
          <span>{place.subtitle}</span>
        </div>
        <span className="occupancy">
          {String(residents.length).padStart(2, "0")}
        </span>
      </div>
      <div className={`room-drawing drawing-${place.type}`} aria-hidden="true">
        {place.type === "home" && (
          <>
            <div className="bed">
              <span />
              <span />
            </div>
            <div className="rug" />
            <div className="plant">✳</div>
            <div className="cabinet" />
          </>
        )}
        {place.type === "office" && (
          <>
            <div className="desk desk-one">
              <i />
              <i />
            </div>
            <div className="desk desk-two">
              <i />
              <i />
            </div>
            <div className="plant">✳</div>
          </>
        )}
        {place.type === "food" && (
          <>
            <div className="food-counter">
              <i />
              <i />
              <i />
            </div>
            <div className="dining-table">
              <i className={occupied > 0 ? "taken" : ""} />
              <i className={occupied > 1 ? "taken" : ""} />
            </div>
          </>
        )}
        {place.type === "park" && (
          <>
            <div className="tree tree-one" />
            <div className="tree tree-two" />
            <div className="garden-path" />
            <div className={`bench bench-one ${occupied > 0 ? "taken" : ""}`} />
            <div className={`bench bench-two ${occupied > 1 ? "taken" : ""}`} />
          </>
        )}
        {place.type === "shop" && (
          <>
            <div className="shelf shelf-one">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="shelf shelf-two">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="shop-counter" />
          </>
        )}
      </div>
      <div className="place-residents">
        {residents.length ? (
          residents.map((a) => (
            <Resident
              key={a.id}
              agent={a}
              selected={selected === a.id}
              onSelect={() => onSelect(a.id)}
            />
          ))
        ) : (
          <span className="empty-place">
            {place.type === "home" ? "等一个归来的人" : "故事还没走到这里"}
          </span>
        )}
      </div>
      <div className="place-footer">
        {place.resource ? (
          <>
            <span className="resource-seats">
              {Array.from({ length: place.resource.capacity }, (_, i) => (
                <i key={i} className={i < occupied ? "filled" : ""} />
              ))}
            </span>
            <span>
              {place.resource.name} {occupied}/{place.resource.capacity}
            </span>
            {waiting > 0 && <b>{waiting} 人等候</b>}
          </>
        ) : (
          <>
            <span className="tiny-dot" />
            <span>
              {place.type === "shop"
                ? "24 小时亮着灯"
                : place.type === "home"
                  ? "可以安心休息"
                  : "有想法，也有截止日期"}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function NeedBar({
  label,
  value,
  type,
}: {
  label: string;
  value: number;
  type: string;
}) {
  return (
    <div className={`need need-${type}`}>
      <div>
        <span>{label}</span>
        <span>
          {Math.round(value)}
          <small> / 100</small>
        </span>
      </div>
      <div
        className="need-track"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Inspector({
  world,
  selected,
  onSelect,
  onNote,
  readOnly = false,
}: {
  world: WorldState;
  selected: string;
  onSelect: (id: string) => void;
  onNote: () => void;
  readOnly?: boolean;
}) {
  const { agentById, placeById } = useWorldData();
  const agent = world.agents.find((a) => a.id === selected)!,
    def = agentById.get(selected)!;
  const relations = world.relations
    .filter((r) => r.a === selected || r.b === selected)
    .sort((a, b) => b.value - a.value);
  const currentLocation = agent.travel
    ? `去${placeById.get(agent.travel.to)!.name}的路上 · ${agent.travel.remaining} 分钟`
    : placeById.get(agent.place)!.name;
  return (
    <aside className="inspector panel" aria-label="居民详情">
      <div className="panel-eyebrow">
        <span>居民档案</span>
        <span>RESIDENT FILE</span>
      </div>
      <div className="identity">
        <Avatar def={def} />
        <div>
          <h2>
            {def.name}
            <span>{def.role}</span>
          </h2>
          <div className="tags">
            {def.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="bio">{def.bio}</p>
      <div className="location-line">
        <MapPin size={13} />
        {currentLocation}
      </div>
      <div className="section-title">
        <h3>此刻的状态</h3>
        <span>数值越高，越满足</span>
      </div>
      <div className="needs">
        <NeedBar label="精力" value={agent.needs.energy} type="energy" />
        <NeedBar label="社交" value={agent.needs.social} type="social" />
        <NeedBar label="心情" value={agent.needs.mood} type="mood" />
      </div>
      <div className={`goal-box ${agent.note ? "noted" : ""}`}>
        <div>
          <span className="goal-symbol">
            {agent.note ? <Send size={14} /> : <Footprints size={15} />}
          </span>
          <span>{agent.note ? "纸条带来的小转弯" : "当前的小打算"}</span>
          <span className="source-tag">
            {agent.goal ? sourceLabels[agent.goal.source] : "思考中"}
          </span>
        </div>
        <strong>
          {agent.waitingSince !== null ? "等一个空位，然后" : ""}
          {agent.goal ? ACTIONS[agent.goal.action] : "看看接下来做什么"}
        </strong>
        <p>{agent.goal?.reason ?? "下一分钟，会根据作息与需求做决定。"}</p>
        {agent.note && (
          <span className="note-expiry">
            还有 {Math.max(0, agent.note.expiresAt - world.time)}{" "}
            分钟恢复自主决策
          </span>
        )}
      </div>
      <SocialContext world={world} selected={selected} />
      <div className="section-title">
        <h3>身边的人</h3>
        <span>{relations.length} 段联系</span>
      </div>
      <div className="relations">
        {relations.map((r) => {
          const other = agentById.get(r.a === selected ? r.b : r.a)!;
          return (
            <div key={other.id} className="relationship-item">
              <button
                className="relation"
                onClick={() => onSelect(other.id)}
                aria-label={`查看${other.name}的关系档案`}
              >
                <Avatar def={other} small />
                <span>
                  <strong>{other.name}</strong>
                  <small>{r.label}</small>
                </span>
                <span
                  className={`relation-score ${r.value < 35 ? "strained" : ""}`}
                >
                  {r.value.toFixed(1)}
                  <small>熟悉度</small>
                </span>
                <ChevronRight size={12} />
              </button>
              <RelationshipChange relation={r} time={world.time} />
            </div>
          );
        })}
      </div>
      <button
        className="note-button"
        disabled={!world.notesRemaining || readOnly}
        onClick={onNote}
      >
        <Send size={15} />
        {readOnly
          ? "长跑 / 回放期间只读"
          : world.notesRemaining
            ? `给${def.name}塞张纸条`
            : "这轮的纸条已送出"}
        <span>{world.notesRemaining}/1</span>
      </button>
      <p className="small-note">一点干预，看看生活会拐向哪里。</p>
      <details className="schedule">
        <summary>
          查看一天的作息 <ChevronRight size={12} />
        </summary>
        {def.schedule.map((s, i) => (
          <div key={i}>
            <span>
              {s.start}–{s.end}
            </span>
            <span>
              {placeById.get(s.place)!.name} · {ACTIONS[s.action]}
            </span>
          </div>
        ))}
      </details>
    </aside>
  );
}

function Timeline({
  world,
  selected,
  onSelect,
  replay = false,
  archiveTotal,
  focusEventId,
}: {
  world: WorldState;
  selected: string;
  onSelect: (id: string) => void;
  replay?: boolean;
  archiveTotal?: number;
  focusEventId?: number | null;
}) {
  const { agentById, placeById } = useWorldData();
  const [filter, setFilter] = useState<
    "all" | "story" | "rumor" | "conflict" | "selected"
  >("story");
  const [held, setHeld] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusEventId == null) return;
    setFilter("all");
    setHeld(null);
    const frame = requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>(`[data-event-id="${focusEventId}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusEventId]);
  const visible = world.events
    .filter(
      (e) =>
        (held === null || e.id <= held) &&
        (filter === "all" ||
          (filter === "story"
            ? ["encounter", "conflict", "note", "rumor", "meta"].includes(
                e.kind,
              )
            : filter === "rumor"
              ? e.kind === "rumor"
              : filter === "conflict"
                ? e.kind === "conflict"
                : e.actors.includes(selected))),
    )
    .slice(-70)
    .reverse();
  const unseen =
    held === null ? 0 : world.events.filter((e) => e.id > held).length;
  return (
    <aside className="timeline panel" aria-label="事件时间线">
      <div className="timeline-header">
        <div>
          <span className="panel-eyebrow">生活实录</span>
          <h2>
            刚刚发生的事
            <span className="live-dot" />
          </h2>
        </div>
        <span className="event-total">
          {world.totalEvents}
          <small>{replay ? "到此刻的事件" : "件小事"}</small>
        </span>
      </div>
      <div className="timeline-tabs" role="group" aria-label="事件筛选">
        {(
          [
            ["all", "全部"],
            ["story", "生活故事"],
            ["rumor", "传闻"],
            ["conflict", "冲突"],
            ["selected", agentById.get(selected)!.name],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={filter === key}
            className={filter === key ? "active" : ""}
            onClick={() => {
              setFilter(key);
              setHeld(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="timeline-status">
        <span>每件事，都有它的原因</span>
        <button
          onClick={() => setHeld(held === null ? world.nextEventId - 1 : null)}
        >
          {held === null
            ? "定格阅读"
            : `继续更新${unseen ? ` +${unseen}` : ""}`}
        </button>
      </div>
      <div
        className="event-list"
        tabIndex={0}
        aria-label="可滚动事件列表"
        ref={listRef}
      >
        {visible.length ? (
          visible.map((event) => (
            <article
              key={event.id}
              className={`event event-${event.kind === "meta" ? "configuration" : event.kind} ${event.id === focusEventId ? "review-focused" : ""}`}
              data-event-id={event.id}
              aria-current={event.id === focusEventId ? "true" : undefined}
            >
              <div className="event-marker">
                {event.kind === "note" ? (
                  <Send size={12} />
                ) : event.kind === "encounter" || event.kind === "rumor" ? (
                  <MessageCircle size={12} />
                ) : event.kind === "conflict" ? (
                  <Zap size={12} />
                ) : (
                  <span />
                )}
              </div>
              <div className="event-meta">
                <time>
                  D{dayOf(event.time)} · {formatTime(event.time)}
                </time>
                <span>{kindLabels[event.kind]}</span>
              </div>
              <p>{event.text}</p>
              <div className="event-location">
                <MapPin size={11} />
                {placeById.get(event.place)!.name}
                {event.actors.map((id) => (
                  <button key={id} onClick={() => onSelect(id)}>
                    {agentById.get(id)!.name}
                  </button>
                ))}
              </div>
              <details>
                <summary>
                  为什么会这样 <ChevronRight size={10} />
                </summary>
                <p>{event.reason}</p>
              </details>
            </article>
          ))
        ) : (
          <div className="timeline-empty">
            <MessageCircle size={24} />
            <p>故事正在酝酿</p>
            <span>让时间走一会儿，或试试另一种筛选。</span>
          </div>
        )}
      </div>
      <div className="timeline-bottom">
        <span className="tiny-dot" />
        {replay ? `本局归档 ${archiveTotal} 条 · ` : ""}保留此刻最近 240 条 ·
        展示最多 70 条
      </div>
    </aside>
  );
}

const demoSteps = [
  {
    title: "先不做任何事",
    time: 700,
    npc: "amin",
    hint: "让世界走 20 秒。点选居民，看需求随时间变化。第一幕到 12:00 自动暂停，给讲解留一点时间。",
  },
  {
    title: "午饭时，座位不够了",
    time: 732,
    npc: "zhou",
    hint: "食堂只有两个餐位。看「生活故事」里的冲突：谁想吃饭、谁占着位、谁排队。展开原因，看到延后计划和心情损失。",
  },
  {
    title: "一句夸奖，传到第三人",
    time: 824,
    npc: "ake",
    hint: "选「传闻」并展开原因：林叔夸阿可的画后，消息已传到小唐、苗苗。点小唐，展开与阿可的关系变化，看「听闻 +1.0」。传闻最多两跳。",
  },
  {
    title: "改道，谁的约定被打断",
    time: 824,
    npc: "ake",
    hint: "此刻阿可与苗苗约好一起看稿。给阿可纸条：便利店 / 逛便利店。切回「生活故事」，看约定取消、苗苗心情和关系下降；播放 ×8，14:04 可见林叔→苗苗→小周的第二跳，60 分钟后纸条到期。",
  },
  {
    title: "有的熟络，有的渐远",
    time: 1404,
    npc: "amin",
    hint: "已快进至 23:24。阿敏与乔乔在便利店碰面；展开关系变化，区分直接互动、传闻与久未联系。再选阿可看与苗苗：失约扣过 1 分，当天的互动仍让关系升温，比较各自账本。",
  },
];

function NoteDialog({
  selected,
  onClose,
  onSend,
}: {
  selected: string;
  onClose: () => void;
  onSend: (id: string, action: Action, place: string, message: string) => void;
}) {
  const { data, placeById } = useWorldData();
  const [person, setPerson] = useState(selected),
    [place, setPlace] = useState("park"),
    [action, setAction] = useState<Action>(() =>
      placeById.get("park")!.actions.includes("chat")
        ? "chat"
        : placeById.get("park")!.actions[0],
    ),
    [message, setMessage] = useState("出去透口气，和大家聊聊。");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSend(person, action, place, message);
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="note-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Tab") {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                "button, select, textarea",
              ),
            );
            const first = items[0],
              last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="关闭纸条"
          autoFocus
        >
          <X size={19} />
        </button>
        <span className="note-decoration">
          <Send size={26} strokeWidth={1.5} />
        </span>
        <span className="panel-eyebrow">A SMALL INTERVENTION</span>
        <h2 id="note-title">给生活，递一张纸条。</h2>
        <p>不替他过日子，只临时改一个小打算。</p>
        <form onSubmit={submit}>
          <label>
            递给谁
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              {data.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.role}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              去哪里
              <select
                value={place}
                onChange={(e) => {
                  setPlace(e.target.value);
                  const allowed = placeById.get(e.target.value)!.actions;
                  if (!allowed.includes(action)) setAction(allowed[0]);
                }}
              >
                {data.places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              做点什么
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as Action)}
              >
                {placeById.get(place)!.actions.map((a) => (
                  <option key={a} value={a}>
                    {ACTIONS[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            纸条上的话 <small>只作记录，行动以上方选项为准</small>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={80}
              rows={3}
            />
          </label>
          <div className="note-terms">
            <Check size={14} />
            持续 60 游戏分钟 · 本轮仅 1 次 · 到期恢复自主行动
          </div>
          <button className="primary-button" type="submit">
            <Send size={15} />
            把纸条递出去
          </button>
        </form>
      </section>
    </div>
  );
}

export default function App() {
  const sim = useSimulation();
  return (
    <WorldDataProvider data={sim.data}>
      <WorldView sim={sim} />
    </WorldDataProvider>
  );
}

function WorldView({ sim }: { sim: ReturnType<typeof useSimulation> }) {
  const { data, agentById, placeById } = useWorldData();
  const { world } = sim;
  const [selectedId, setSelected] = useState(data.agents[0].id);
  const selected = world.agents.some((a) => a.id === selectedId)
    ? selectedId
    : world.agents[0].id;
  const [showNote, setShowNote] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [showPlanner, setShowPlanner] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [demoStep, setDemoStep] = useState(-1);
  useEffect(() => {
    if (!sim.reviewLocked && showDemo && demoStep === 0 && world.time >= 720)
      sim.setPaused(true);
  }, [showDemo, demoStep, world.time, sim.setPaused, sim.reviewLocked]);
  const prepareReview = () => {
    setShowDemo(false);
    setShowPlanner(false);
    setShowNote(false);
    setDemoStep(-1);
    sim.setPaused(true);
  };
  const minute = minuteOfDay(world.time),
    night = minute < 6 * 60 || minute >= 20 * 60;
  const traveling = world.agents.filter((a) => a.travel);
  const averageMood = Math.round(
    world.agents.reduce((sum, a) => sum + a.needs.mood, 0) /
      world.agents.length,
  );
  const nextDemo = () => {
    const step = demoStep + 1;
    if (step === 0) sim.reset();
    else sim.jumpTo(demoSteps[step].time);
    setSelected(demoSteps[step].npc);
    setDemoStep(step);
  };
  const reset = () => {
    sim.reset();
    setDemoStep(-1);
    setSelected(data.agents[0].id);
  };
  return (
    <div className={`app ${night ? "is-night" : ""}`}>
      <header className="app-header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <Orbit size={26} strokeWidth={1.4} />
          </span>
          <span>
            <strong>
              小宇宙<span>little universe</span>
            </strong>
            <small>生活正在发生</small>
          </span>
        </a>
        <div className="header-right">
          <span className="internal-badge">
            INTERNAL PROTOTYPE <i /> W4
          </span>
          <button
            className="planner-entry"
            aria-expanded={showReview}
            onClick={() => setShowReview(!showReview)}
          >
            <History size={14} />
            评审复盘
          </button>
          <button
            className="planner-entry"
            aria-expanded={showPlanner}
            disabled={sim.reviewLocked}
            onClick={() => setShowPlanner(!showPlanner)}
          >
            <SlidersHorizontal size={14} />
            策划热改
          </button>
          <button
            className={`demo-button ${showDemo ? "active" : ""}`}
            disabled={sim.reviewLocked}
            onClick={() => setShowDemo(!showDemo)}
          >
            <BookOpen size={15} />5 分钟 Demo
          </button>
        </div>
      </header>
      <main className="main-shell">
        <div className="page-intro">
          <div>
            <div className="eyebrow">
              <span className="tiny-line" />
              一个关于自主生活的实验 · 001
            </div>
            <h1>
              小小的世界，<span>照常过日子。</span>
            </h1>
            <p>八个居民，六个地方。你不在的时候，故事也在继续。</p>
          </div>
          <div className="world-stamp">
            <Orbit size={34} strokeWidth={1} />
            <span>
              没有主角
              <br />
              每个人都有生活
            </span>
          </div>
        </div>
        <section className="world-toolbar" aria-label="时间控制">
          <div className="clock-block">
            <span className="day-icon">
              {night ? <Moon size={22} /> : <Sun size={23} />}
            </span>
            <span className="day-label">
              第 {String(dayOf(world.time)).padStart(2, "0")} 天
              <small>
                {night
                  ? "夜色渐深"
                  : minute < 12 * 60
                    ? "午前的日常"
                    : minute < 18 * 60
                      ? "午后的时光"
                      : "慢慢入夜"}
              </small>
            </span>
            <strong className="world-time">{formatTime(world.time)}</strong>
            <span className={`running-label ${sim.paused ? "paused" : ""}`}>
              <i />
              {sim.review.mode === "replay"
                ? "记录回放 · 只读"
                : sim.review.mode === "recording"
                  ? "评审长跑中"
                  : sim.review.mode === "recording-paused"
                    ? "长跑已暂停"
                    : sim.review.mode === "importing"
                      ? "正在核对局文件"
                      : sim.paused
                        ? "时间已暂停"
                        : "世界自行运转中"}
            </span>
          </div>
          <div className="time-controls">
            <button
              className="play-button"
              disabled={sim.reviewLocked}
              onClick={() => sim.setPaused(!sim.paused)}
              aria-label={sim.paused ? "继续时间" : "暂停时间"}
            >
              {sim.paused ? (
                <Play size={15} fill="currentColor" />
              ) : (
                <Pause size={15} fill="currentColor" />
              )}
            </button>
            <div className="speed-controls" role="group" aria-label="时间速度">
              {([1, 2, 8] as Speed[]).map((speed) => (
                <button
                  key={speed}
                  disabled={sim.reviewLocked}
                  onClick={() => sim.setSpeed(speed)}
                  className={sim.speed === speed ? "active" : ""}
                  aria-pressed={sim.speed === speed}
                >
                  ×{speed}
                </button>
              ))}
            </div>
            <span className="speed-caption">1 秒 = {sim.speed} 分钟</span>
            <button
              className="reset-button"
              disabled={sim.reviewLocked}
              onClick={reset}
              title="重新开局，清空本轮进度"
            >
              <RotateCcw size={14} />
              <span>重新开局</span>
            </button>
          </div>
        </section>
        {sim.feedback?.kind === "error" && !showPlanner && (
          <p role="alert">{sim.feedback.message}</p>
        )}
        {sim.reviewLocked && (
          <p className="review-lock-note">
            当前使用评审局锁定的数据。普通时钟、纸条和热改暂不可用；请在「评审复盘」中暂停长跑或退出回放。
          </p>
        )}
        {showReview && (
          <ReviewPanel
            sim={sim}
            onStart={(minutes) => {
              prepareReview();
              sim.startReview(minutes);
            }}
            onPrepareImport={prepareReview}
            onSelect={setSelected}
            onClose={() => setShowReview(false)}
          />
        )}
        {showDemo && (
          <section className="demo-guide" aria-label="五分钟演示导览">
            <div className="demo-guide-top">
              <span>
                <BookOpen size={15} />
                制作人的 5 分钟散步
              </span>
              <button
                aria-label="关闭演示导览"
                onClick={() => setShowDemo(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="demo-dots">
              {demoSteps.map((step, i) => (
                <span
                  className={
                    i === demoStep ? "current" : i < demoStep ? "done" : ""
                  }
                  key={step.title}
                >
                  <b>{String(i + 1).padStart(2, "0")}</b>
                  {step.title}
                </span>
              ))}
            </div>
            <div className="demo-explanation">
              <p>
                {demoStep < 0
                  ? "从 11:40 重新开局。每一幕都推进真实模拟，不插入预写事件；跳转后暂停，方便观察与讲解。"
                  : demoSteps[demoStep].hint}
              </p>
              {demoStep < 4 ? (
                <button onClick={nextDemo}>
                  {demoStep < 0 ? "重新开局并开始" : "下一幕"}
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowDemo(false);
                    sim.setPaused(false);
                  }}
                >
                  让世界继续
                  <Play size={13} />
                </button>
              )}
            </div>
            <button
              className="demo-planner-entry"
              onClick={() => setShowPlanner(true)}
            >
              <SlidersHorizontal size={13} />
              W3 加演 45 秒：打开热改面板，把食堂容量 2 改为 6，观察等位变化。
            </button>
          </section>
        )}
        <div className="workspace">
          <Inspector
            world={world}
            selected={selected}
            onSelect={setSelected}
            onNote={() => setShowNote(true)}
            readOnly={sim.reviewLocked}
          />
          <section className="world-column">
            <div className="map-heading">
              <div>
                <h2>
                  生活发生的地方<span>THE NEIGHBORHOOD</span>
                </h2>
                <p>点一位居民，听听他的生活。</p>
              </div>
              <div className="map-legend">
                <span>
                  <i />
                  自在生活
                </span>
                <span>
                  <i />
                  等待空位
                </span>
              </div>
            </div>
            <div className="neighborhood">
              <div className="map-label">
                <span>小宇宙街区</span>
                <span>平凡的一天，也值得观察 ↗</span>
              </div>
              <div className="places-grid">
                {data.places.map((place) => (
                  <Place
                    key={place.id}
                    place={place}
                    world={world}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ))}
              </div>
              <div className="street-label">
                <span />
                生活没有剧本 · 相遇自有原因
                <span />
              </div>
            </div>
            <div className="in-transit">
              <Footprints size={16} />
              <span>街上</span>
              <div>
                {traveling.length ? (
                  traveling.map((a) => (
                    <button key={a.id} onClick={() => setSelected(a.id)}>
                      <span style={{ color: agentById.get(a.id)!.color }}>
                        ●
                      </span>
                      {agentById.get(a.id)!.name}
                      <ArrowRight size={11} />
                      {placeById.get(a.travel!.to)!.name}
                      <small>{a.travel!.remaining}′</small>
                    </button>
                  ))
                ) : (
                  <span className="quiet-street">
                    此刻街上很安静，大家都在各自的地方。
                  </span>
                )}
              </div>
            </div>
            <section className="residents-strip">
              <div className="section-title">
                <h3>
                  街坊邻里 <span>{data.agents.length}</span>
                </h3>
                <span>每个人，都有自己的节奏</span>
              </div>
              <div className="roster">
                {world.agents.map((a) => (
                  <button
                    className={selected === a.id ? "active" : ""}
                    onClick={() => setSelected(a.id)}
                    aria-label={`选择居民${agentById.get(a.id)!.name}`}
                    aria-pressed={selected === a.id}
                    key={a.id}
                  >
                    <Avatar def={agentById.get(a.id)!} small />
                    <strong>{agentById.get(a.id)!.name}</strong>
                    <span>
                      {a.travel
                        ? "在路上"
                        : a.waitingSince !== null
                          ? "等空位"
                          : a.goal
                            ? ACTIONS[a.goal.action]
                            : "想一想"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <div className="world-metrics">
              <div>
                <Users size={17} />
                <span>
                  各有各的生活<strong>{world.agents.length} 位居民</strong>
                </span>
              </div>
              <div>
                <Sparkles size={17} />
                <span>
                  街区的心情
                  <strong>
                    {averageMood} <small>/ 100</small>
                  </strong>
                </span>
              </div>
              <div>
                <Leaf size={17} />
                <span>
                  相遇正在生长<strong>{world.relations.length} 段联系</strong>
                </span>
              </div>
            </div>
            <div className="world-caption">
              <span>让世界自己走一会儿。</span>
              <p>作息 × 需求 × 性格 × 有限的空间 = 今天的故事</p>
            </div>
          </section>
          <Timeline
            key={`${sim.runId}:${sim.review.mode === "replay" ? `replay-${sim.review.serial}` : "live"}`}
            world={world}
            selected={selected}
            onSelect={setSelected}
            replay={sim.review.mode === "replay"}
            archiveTotal={sim.review.run?.events.length}
            focusEventId={sim.review.focusEventId}
          />
        </div>
        <footer className="app-footer">
          <span>
            <span className="tiny-dot" />
            规则驱动 · 本地运行 · 无模型调用
          </span>
          <span>
            仅供内部创新评审使用<span className="footer-divider">/</span>W4 ·
            生活模拟实验
          </span>
        </footer>
      </main>
      <PlannerPanel
        open={showPlanner && !sim.reviewLocked}
        onClose={() => setShowPlanner(false)}
        data={sim.liveData}
        revision={sim.revision}
        feedback={sim.feedback}
        onApply={sim.applyData}
      />
      {showNote && !sim.reviewLocked && (
        <NoteDialog
          selected={selected}
          onClose={() => {
            setShowNote(false);
            window.setTimeout(
              () =>
                document
                  .querySelector<HTMLButtonElement>(".note-button")
                  ?.focus(),
              0,
            );
          }}
          onSend={(...args) => {
            sim.note(...args);
            setSelected(args[0]);
          }}
        />
      )}
    </div>
  );
}
