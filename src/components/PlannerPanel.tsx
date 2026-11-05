import { useEffect, useState } from "react";
import { Download, SlidersHorizontal, X } from "lucide-react";
import { ACTIONS, data as bundledData, validateData } from "../sim/data";
import { exportConfiguration, parseConfiguration } from "../sim/configuration";
import type { Action, WorldData } from "../sim/types";
import type { SimulationSession } from "../sim/session";
import "./PlannerPanel.css";

const ruleLabels: Record<string, string> = {
  favoriteMoodPerMinute: "偏好活动每分钟心情收益",
  restMoodPerMinute: "休息每分钟心情收益",
  chatSocialPerMinute: "有伴聊天每分钟社交收益",
  continuationBonus: "当前活动继续评分加成",
  maxQueueMinutes: "排队多久允许重新考虑",
  encounterIntervalMinutes: "地点偶遇间隔分钟",
  pairCooldownMinutes: "同一对人偶遇冷却分钟",
  ...Object.fromEntries(
    Object.entries(ACTIONS).map(([key, label]) => [key, `${label}活动分钟`]),
  ),
  decayPerHour: "每小时关系衰减",
  graceMinutes: "互动后宽限分钟",
  closeThreshold: "熟人分数门槛",
  closeMultiplier: "熟人衰减倍率",
  durationMinutes: "共同安排分钟",
  queueMoodPenalty: "排队心情损失",
  interruptionMoodPenalty: "失约心情损失",
  interruptionRelationPenalty: "失约关系损失",
  maxHops: "传闻最大跳数",
  minRelation: "传闻关系门槛",
  hopDelayMinutes: "收到后转述等待分钟",
  broadcastCooldownMinutes: "全局转述冷却分钟",
  recipientCooldownMinutes: "听众冷却分钟",
  sourceCooldownMinutes: "传闻源冷却分钟",
  lifetimeMinutes: "传闻存活分钟",
  maxActive: "存活传闻上限",
  maxRecipients: "每条听众上限",
  moodBoost: "听闻心情增加",
  familiarityBoost: "听闻熟悉度增加",
};
function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? NaN : Number(e.target.value))
        }
      />
    </label>
  );
}

export function PlannerPanel({
  open,
  onClose,
  data,
  revision,
  feedback,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  data: WorldData;
  revision: number;
  feedback: SimulationSession["feedback"];
  onApply: (candidate: unknown) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(data));
  const [tab, setTab] = useState<"agents" | "places" | "relations" | "rules">(
    "places",
  );
  const [agentId, setAgentId] = useState(data.agents[0].id);
  const [placeId, setPlaceId] = useState(
    () => data.places.find((p) => p.type === "food")?.id ?? data.places[0].id,
  );
  const [relationIndex, setRelationIndex] = useState(0);
  const [json, setJson] = useState("");
  const [message, setMessage] = useState({
    kind: "info",
    text: "草稿不会自动影响世界，校验通过并应用后才生效。",
  });
  useEffect(() => {
    setDraft(structuredClone(data));
  }, [data]);
  useEffect(() => {
    if (feedback) setMessage({ kind: feedback.kind, text: feedback.message });
  }, [feedback]);
  const edit = (update: (next: WorldData) => void) => {
    setDraft((previous) => {
      const next = structuredClone(previous);
      update(next);
      return next;
    });
    setMessage({
      kind: "info",
      text: "草稿有改动，尚未应用；世界继续使用已应用版本。",
    });
  };
  const attempt = (work: () => void) => {
    try {
      work();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "操作失败，世界未改变。",
      });
    }
  };
  const apply = () =>
    attempt(() => {
      validateData(draft);
      onApply(draft);
    });
  const loadJson = () =>
    attempt(() => {
      const imported = parseConfiguration(json);
      setDraft(imported);
      setAgentId(imported.agents[0].id);
      setPlaceId(imported.places[0].id);
      setRelationIndex(0);
      setMessage({
        kind: "info",
        text: "JSON 校验通过，已载入草稿。点击「应用到当前世界」才会生效。",
      });
    });
  const download = () =>
    attempt(() => {
      const serialized = exportConfiguration(draft);
      setJson(serialized);
      const url = URL.createObjectURL(
        new Blob([serialized], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "little-universe-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({
        kind: "info",
        text: "已导出当前草稿 JSON，并填入下方文本框。文件含配置，不含模拟进度。",
      });
    });
  if (!open) return null;
  const agent = draft.agents.find((a) => a.id === agentId) ?? draft.agents[0];
  const place = draft.places.find((p) => p.id === placeId) ?? draft.places[0];
  const relation =
    draft.relations[Math.min(relationIndex, draft.relations.length - 1)];
  const changeAgent = (update: (a: typeof agent) => void) =>
    edit((next) => update(next.agents.find((a) => a.id === agent.id)!));
  const changePlace = (update: (p: typeof place) => void) =>
    edit((next) => update(next.places.find((p) => p.id === place.id)!));
  const allowed = (id: string) =>
    draft.places.find((p) => p.id === id)!.actions;
  return (
    <aside
      className="planner-panel"
      aria-label="策划热改面板"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="planner-heading">
        <div>
          <span>
            <SlidersHorizontal size={16} />
            CONTENT LAB · W3
          </span>
          <h2>改一点，马上看见</h2>
        </div>
        <button onClick={onClose} aria-label="收起热改面板">
          <X size={20} />
        </button>
      </div>
      <p className="planner-intro">
        已应用版本 {revision} ·
        保留当前时刻与纸条。面板不自动暂停时间；比较改动前后时，可先暂停世界。关面板不会丢弃草稿。
      </p>
      <div className="planner-tabs" role="group" aria-label="热改类别">
        {(
          [
            ["agents", "居民"],
            ["places", "地点"],
            ["relations", "关系"],
            ["rules", "W2 配置"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="planner-content">
        {tab === "agents" && (
          <section aria-label="居民编辑">
            <label>
              编辑居民
              <select
                value={agent.id}
                onChange={(e) => setAgentId(e.target.value)}
              >
                {draft.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.role}
                  </option>
                ))}
              </select>
            </label>
            <div className="planner-fields">
              <label>
                姓名
                <input
                  value={agent.name}
                  maxLength={60}
                  onChange={(e) =>
                    changeAgent((a) => {
                      a.name = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                性格标签（逗号分隔）
                <input
                  value={agent.tags.join(", ")}
                  onChange={(e) =>
                    changeAgent((a) => {
                      a.tags = e.target.value.trim()
                        ? e.target.value.split(/[,，]/).map((tag) => tag.trim())
                        : [];
                    })
                  }
                />
              </label>
            </div>
            <h3>需求初值</h3>
            <p className="planner-help">
              修改的初值也会赋给当前居民；未修改的需求继续保留。范围 0–100。
            </p>
            <div className="planner-fields three">
              {(
                [
                  ["energy", "精力初值"],
                  ["social", "社交初值"],
                  ["mood", "心情初值"],
                ] as const
              ).map(([key, label]) => (
                <NumberField
                  key={key}
                  label={label}
                  value={agent.needs[key]}
                  onChange={(v) =>
                    changeAgent((a) => {
                      a.needs[key] = v;
                    })
                  }
                />
              ))}
            </div>
            <h3>性格参数</h3>
            <div className="planner-fields three">
              {(
                [
                  ["sociability", "外向程度"],
                  ["praiseSensitivity", "夸奖敏感度"],
                  ["kindness", "热心程度"],
                ] as const
              ).map(([key, label]) => (
                <NumberField
                  key={key}
                  label={`${label}（0–1）`}
                  value={agent.traits[key]}
                  step={0.1}
                  onChange={(v) =>
                    changeAgent((a) => {
                      a.traits[key] = v;
                    })
                  }
                />
              ))}
            </div>
            <div className="planner-fields">
              <label>
                偏好地点
                <select
                  value={agent.favorite.place}
                  onChange={(e) =>
                    changeAgent((a) => {
                      a.favorite.place = e.target.value;
                      if (!allowed(e.target.value).includes(a.favorite.action))
                        a.favorite.action =
                          allowed(e.target.value)[0] ?? a.favorite.action;
                    })
                  }
                >
                  {draft.places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                偏好行为
                <select
                  value={agent.favorite.action}
                  onChange={(e) =>
                    changeAgent((a) => {
                      a.favorite.action = e.target.value as Action;
                    })
                  }
                >
                  {allowed(agent.favorite.place).map((a) => (
                    <option key={a} value={a}>
                      {ACTIONS[a]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <h3>作息片段</h3>
            <p className="planner-help">
              支持跨午夜；重叠时按顺序第一条生效。修改作息后，自主目标下一 tick
              重选，路途中先到站。
            </p>
            {agent.schedule.map((s, i) => (
              <fieldset className="schedule-editor" key={i}>
                <legend>作息 {i + 1}</legend>
                <div className="planner-fields">
                  <label>
                    开始
                    <input
                      aria-label={`作息${i + 1}开始`}
                      type="time"
                      value={s.start}
                      onChange={(e) =>
                        changeAgent((a) => {
                          a.schedule[i].start = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    结束
                    <input
                      aria-label={`作息${i + 1}结束`}
                      type="time"
                      value={s.end}
                      onChange={(e) =>
                        changeAgent((a) => {
                          a.schedule[i].end = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    地点
                    <select
                      aria-label={`作息${i + 1}地点`}
                      value={s.place}
                      onChange={(e) =>
                        changeAgent((a) => {
                          a.schedule[i].place = e.target.value;
                          if (
                            !allowed(e.target.value).includes(
                              a.schedule[i].action,
                            )
                          )
                            a.schedule[i].action =
                              allowed(e.target.value)[0] ??
                              a.schedule[i].action;
                        })
                      }
                    >
                      {draft.places.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    行为
                    <select
                      aria-label={`作息${i + 1}行为`}
                      value={s.action}
                      onChange={(e) =>
                        changeAgent((a) => {
                          a.schedule[i].action = e.target.value as Action;
                        })
                      }
                    >
                      {allowed(s.place).map((action) => (
                        <option key={action} value={action}>
                          {ACTIONS[action]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  className="planner-text-button"
                  onClick={() =>
                    changeAgent((a) => {
                      a.schedule.splice(i, 1);
                    })
                  }
                >
                  删除作息 {i + 1}
                </button>
              </fieldset>
            ))}
            <button
              className="planner-secondary"
              onClick={() =>
                changeAgent((a) => {
                  a.schedule.push({
                    start: "19:00",
                    end: "20:00",
                    action: "rest",
                    place: a.home,
                  });
                })
              }
            >
              ＋ 添加作息片段
            </button>
          </section>
        )}
        {tab === "places" && (
          <section aria-label="地点编辑">
            <label>
              编辑地点
              <select
                value={place.id}
                onChange={(e) => setPlaceId(e.target.value)}
              >
                {draft.places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {place.resource ? (
              <>
                <NumberField
                  label={`${place.name}容量`}
                  value={place.resource.capacity}
                  onChange={(v) =>
                    changePlace((p) => {
                      p.resource!.capacity = v;
                    })
                  }
                />
                <p className="planner-help">
                  容量为 1–16
                  的整数。应用时立即重新分配位置，排队者有机会入座；缩小容量可能产生新的等位冲突。
                </p>
                <label>
                  资源名称
                  <input
                    value={place.resource.name}
                    onChange={(e) =>
                      changePlace((p) => {
                        p.resource!.name = e.target.value;
                      })
                    }
                  />
                </label>
                <fieldset className="action-checks">
                  <legend>哪些行为要占位</legend>
                  {place.actions.map((action) => (
                    <label key={action}>
                      <input
                        type="checkbox"
                        checked={place.resource!.actions.includes(action)}
                        onChange={(e) =>
                          changePlace((p) => {
                            p.resource!.actions = e.target.checked
                              ? [...p.resource!.actions, action]
                              : p.resource!.actions.filter((a) => a !== action);
                          })
                        }
                      />
                      {ACTIONS[action]}
                    </label>
                  ))}
                </fieldset>
              </>
            ) : (
              <p className="planner-help">
                这里没有稀缺资源；可在 JSON 草稿中配置 resource。
              </p>
            )}
            <fieldset className="action-checks">
              <legend>地点支持的行为</legend>
              {(Object.keys(ACTIONS) as Action[]).map((action) => (
                <label key={action}>
                  <input
                    type="checkbox"
                    checked={place.actions.includes(action)}
                    onChange={(e) =>
                      changePlace((p) => {
                        p.actions = e.target.checked
                          ? [...p.actions, action]
                          : p.actions.filter((a) => a !== action);
                        if (!e.target.checked && p.resource)
                          p.resource.actions = p.resource.actions.filter(
                            (a) => a !== action,
                          );
                      })
                    }
                  />
                  {ACTIONS[action]}
                </label>
              ))}
            </fieldset>
            <p className="planner-help">
              行为影响选址和资源争抢。若仍有居民的作息、偏好或生效纸条依赖被删除的行为，本次应用会被拒绝。
            </p>
            <div className="planner-fields">
              <NumberField
                label="地点 X 坐标"
                value={place.x}
                onChange={(v) =>
                  changePlace((p) => {
                    p.x = v;
                  })
                }
              />
              <NumberField
                label="地点 Y 坐标"
                value={place.y}
                onChange={(v) =>
                  changePlace((p) => {
                    p.y = v;
                  })
                }
              />
            </div>
            <p className="planner-help">
              坐标影响后续路程，范围 −20–20；已出发的路线保持原倒计时。
            </p>
          </section>
        )}
        {tab === "relations" && (
          <section aria-label="关系编辑">
            {relation ? (
              <>
                <label>
                  编辑关系
                  <select
                    value={Math.min(relationIndex, draft.relations.length - 1)}
                    onChange={(e) => setRelationIndex(Number(e.target.value))}
                  >
                    {draft.relations.map((r, i) => (
                      <option key={`${r.a}:${r.b}`} value={i}>
                        {draft.agents.find((a) => a.id === r.a)!.name} ↔{" "}
                        {draft.agents.find((a) => a.id === r.b)!.name}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  label="关系熟悉度"
                  value={relation.value}
                  step={0.1}
                  onChange={(v) =>
                    edit((next) => {
                      next.relations[
                        Math.min(relationIndex, next.relations.length - 1)
                      ].value = v;
                    })
                  }
                />
                <label>
                  关系描述
                  <input
                    value={relation.label}
                    onChange={(e) =>
                      edit((next) => {
                        next.relations[
                          Math.min(relationIndex, next.relations.length - 1)
                        ].label = e.target.value;
                      })
                    }
                  />
                </label>
                <p className="planner-help">
                  此处为配置分数，不是实时分数。修改配置分数会覆盖该段当前熟悉度，并单独记为「策划调整」。未编辑的关系保持冷暖变化；描述只用于展示。自主结识的其他关系保留。
                </p>
              </>
            ) : (
              <p>
                配置中没有关系。可在下方 JSON 草稿中添加现有居民之间的关系。
              </p>
            )}
          </section>
        )}
        {tab === "rules" && (
          <section aria-label="W2 配置编辑">
            {(
              [
                ["relationships", "关系冷暖"],
                ["behavior", "活动收益与保持目标"],
                ["activityMinutes", "到达后活动时长（路途不计）"],
                ["plans", "共同安排"],
                ["rumors", "传闻传播"],
              ] as const
            ).map(([group, title]) => (
              <div key={group}>
                <h3>{title}</h3>
                <div className="planner-fields">
                  {Object.entries(draft.rules[group]).map(([key, value]) => (
                    <NumberField
                      key={key}
                      label={ruleLabels[key]}
                      value={value}
                      step={
                        key === "decayPerHour" ||
                        key === "closeMultiplier" ||
                        key.endsWith("PerMinute")
                          ? 0.1
                          : 1
                      }
                      onChange={(v) =>
                        edit((next) => {
                          (
                            next.rules[group] as unknown as Record<
                              string,
                              number
                            >
                          )[key] = v;
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
            <p className="planner-help">
              传闻最多 1–2
              跳；冷却为正整数。已听到的消息不撤回，也不重复加分。新跳数会立即约束后续转述。
            </p>
          </section>
        )}
        <details className="planner-json">
          <summary>导入 / 导出 JSON</summary>
          <p className="planner-help">
            完整配置包含
            agents、places、relations、rules。只载入草稿不会改变世界；导出不含运行进度。
          </p>
          <textarea
            aria-label="配置 JSON"
            spellCheck={false}
            rows={10}
            value={json}
            placeholder="粘贴导出的完整 JSON"
            onChange={(e) => setJson(e.target.value)}
          />
          <div className="planner-button-row">
            <button className="planner-secondary" onClick={loadJson}>
              校验并载入草稿
            </button>
            <button className="planner-secondary" onClick={download}>
              <Download size={13} />
              导出草稿 JSON
            </button>
          </div>
        </details>
        <div className="planner-button-row">
          <button
            className="planner-text-button"
            onClick={() => {
              setDraft(structuredClone(data));
              setMessage({
                kind: "info",
                text: "已丢弃草稿改动，载入当前已应用配置。",
              });
            }}
          >
            撤销草稿改动
          </button>
          <button
            className="planner-text-button"
            onClick={() => {
              setDraft(structuredClone(bundledData));
              setMessage({
                kind: "info",
                text: "内置配置已载入草稿，点击应用后生效；重开可复演原始 Demo。",
              });
            }}
          >
            恢复内置到草稿
          </button>
        </div>
      </div>
      <div className="planner-bottom">
        <p
          className={`planner-message ${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
        <button className="primary-button" onClick={apply}>
          应用到当前世界
        </button>
        <small>重新开局会沿用已应用配置；刷新页面恢复源码数据。</small>
      </div>
    </aside>
  );
}
