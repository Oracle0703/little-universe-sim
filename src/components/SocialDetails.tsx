import { useWorldData } from "../WorldDataContext";
import { formatTime } from "../sim/engine";
import type { RelationState, WorldState } from "../sim/types";

const signed = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;

export function RelationshipChange({
  relation,
  time,
}: {
  relation: RelationState;
  time: number;
}) {
  const { data } = useWorldData();
  const delta = relation.value - relation.initialValue;
  const since = time - (relation.lastInteractionAt ?? relation.createdAt);
  return (
    <details className="relationship-change">
      <summary>较起点 {signed(delta)} · 变化原因</summary>
      <p>
        起点 {relation.initialValue.toFixed(1)}；直接互动 / 失约{" "}
        {signed(relation.interactionDelta)}；听闻 {signed(relation.rumorDelta)}
        ；久未联系 −{relation.decayTotal.toFixed(1)}；策划调整{" "}
        {signed(relation.manualDelta)}。
      </p>
      <p>
        {relation.lastInteractionAt === null
          ? `建立联系后 ${since} 分钟未直接互动`
          : `距上次直接互动 ${since} 分钟`}
        。熟悉度达到 {data.rules.relationships.closeThreshold}{" "}
        时，疏远速度为普通关系的{" "}
        {Math.round(data.rules.relationships.closeMultiplier * 100)}%。
      </p>
    </details>
  );
}

export function SocialContext({
  world,
  selected,
}: {
  world: WorldState;
  selected: string;
}) {
  const { agentById } = useWorldData();
  const nameOf = (id: string) => agentById.get(id)!.name;
  const plan = world.jointPlans.find((p) => p.participants.includes(selected));
  const heard = world.rumors
    .flatMap((rumor) =>
      rumor.receipts
        .filter((r) => r.agent === selected && r.path.length > 1)
        .map((receipt) => ({ rumor, receipt })),
    )
    .sort((a, b) => b.receipt.heardAt - a.receipt.heardAt)[0];
  if (!plan && !heard) return null;
  return (
    <div className="social-context">
      {plan && (
        <div>
          <strong>正在共同安排</strong>
          <p>
            与{nameOf(plan.participants.find((id) => id !== selected)!)}「
            {plan.label}」，约定至 {formatTime(plan.until)}。
          </p>
          <small>纸条改道或紧急补觉会打断约定。</small>
        </div>
      )}
      {heard && (
        <details>
          <summary>最近听闻 · {formatTime(heard.receipt.heardAt)}</summary>
          <p>{heard.rumor.text}</p>
          <small>
            {heard.receipt.path.map(nameOf).join("→")}
            ；当时的轻微影响已计入心情与关系。
          </small>
        </details>
      )}
    </div>
  );
}
