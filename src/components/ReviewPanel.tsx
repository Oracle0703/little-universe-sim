import { useMemo, useState, type ChangeEvent } from "react";
import { Download, Pause, Play, X } from "lucide-react";
import { EVENT_LABELS } from "../sim/eventKinds";
import { dayOf, formatTime } from "../sim/engine";
import type { EventKind } from "../sim/types";
import type { useSimulation } from "../useSimulation";
import { exportReviewRun } from "../review/file";
import {
  reportMarkdown,
  selectInterestingChains,
  summarizeRun,
} from "../review/report";
import {
  MAX_REVIEW_BYTES,
  REPLAY_MINUTES_PER_SECOND,
  REVIEW_MINUTES,
} from "../review/types";
import "./ReviewPanel.css";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ReviewPanel({
  sim,
  onStart,
  onPrepareImport,
  onSelect,
  onClose,
}: {
  sim: ReturnType<typeof useSimulation>;
  onStart: (minutes: number) => void;
  onPrepareImport: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { review } = sim,
    { run } = review;
  const busy = ["recording", "recording-paused", "importing"].includes(
    review.mode,
  );
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [page, setPage] = useState(0);
  const summary = useMemo(() => (run ? summarizeRun(run) : null), [run]);
  const samples = useMemo(
    () => (run ? selectInterestingChains(run) : []),
    [run],
  );
  const markdown = useMemo(() => (run ? reportMarkdown(run) : ""), [run]);
  const events = useMemo(
    () =>
      run?.events.filter((e) => filter === "all" || e.kind === filter) ?? [],
    [run, filter],
  );
  const pages = Math.max(1, Math.ceil(events.length / 20)),
    currentPage = Math.min(page, pages - 1);
  const selectEvent = (id: number) => {
    const event = run?.events.find((e) => e.id === id);
    if (!event) return;
    if (event.actors[0]) onSelect(event.actors[0]);
    sim.seekReview(event.time - run!.startTime, id);
  };
  const attempt = (task: () => void) => {
    try {
      task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败。");
    }
  };
  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("");
    try {
      if (file.size > MAX_REVIEW_BYTES)
        throw new Error("局文件超过 16 MB 上限。");
      const text = await file.text();
      onPrepareImport();
      sim.importReview(text);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取局文件。");
    }
  };
  const loadFixture = async () => {
    setMessage("正在读取仓库内的样例局…");
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}fixtures/review-run.json`,
      );
      if (!response.ok)
        throw new Error(
          "样例局读取失败，请运行 npm run review:fixture 后重试。",
        );
      const text = await response.text();
      onPrepareImport();
      sim.importReview(text);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "样例局读取失败。");
    }
  };
  const recording = review.job?.recording;
  return (
    <section className="review-panel panel" aria-label="评审长跑与复盘">
      <div className="review-heading">
        <div>
          <span>REVIEW ROOM · W4</span>
          <h2>让一局生活，留下证据。</h2>
        </div>
        <button aria-label="收起评审面板" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="review-intro">
        现实 30 分钟 ×1 旁观 = 1800 游戏分钟 = 30 游戏小时。新局从 11:40
        开始，锁定当前已应用配置；真实分片模拟，不自动发纸条。
      </p>
      <div className="review-actions">
        <button
          className="review-primary"
          disabled={sim.reviewLocked}
          onClick={() => {
            setMessage("");
            onStart(REVIEW_MINUTES);
          }}
        >
          一键评审长跑
        </button>
        <button
          disabled={sim.reviewLocked}
          onClick={() => {
            setMessage("");
            onStart(120);
          }}
        >
          短跑对比 · 120 分钟
        </button>
        <button disabled={busy} onClick={loadFixture}>
          加载样例局
        </button>
        <label className={`review-file ${busy ? "disabled" : ""}`}>
          导入本局
          <input
            type="file"
            aria-label="导入本局 JSON"
            accept=".json,application/json"
            disabled={busy}
            onChange={loadFile}
          />
        </label>
      </div>
      {recording && (
        <div className="recording-progress">
          <div>
            <strong>
              {review.mode === "importing"
                ? "正在核对局文件"
                : review.mode === "recording-paused"
                  ? "长跑已暂停"
                  : "世界正在自己过日子"}
            </strong>
            <span>
              {recording.elapsedMinutes} / {recording.targetMinutes} 游戏分钟 ·
              已记录 {recording.events.length} 件事
            </span>
          </div>
          <progress
            aria-label="长跑处理进度"
            value={recording.elapsedMinutes}
            max={recording.targetMinutes}
          />
          <div className="review-actions">
            {review.mode !== "importing" && (
              <button onClick={sim.pauseReviewRun}>
                {review.mode === "recording-paused" ? "继续长跑" : "暂停长跑"}
              </button>
            )}
            <button onClick={sim.abortReview}>放弃本次处理</button>
            <small>
              {review.mode === "importing"
                ? "正在核对完整记录；可放弃导入，原世界和原档案保留。"
                : "本阶段锁定热改、纸条和普通时钟；可暂停，未跑满不导出完整局。"}
            </small>
          </div>
        </div>
      )}
      {(message || review.feedback) && (
        <p className="review-feedback" role="status">
          {message || review.feedback}
        </p>
      )}
      {run && summary && (
        <>
          <div className="review-report-heading">
            <h3>本局一页纸</h3>
            <span>
              D{dayOf(run.startTime)} {formatTime(run.startTime)} → D
              {dayOf(run.endTime)} {formatTime(run.endTime)} · 已封存
            </span>
          </div>
          <div className="review-metrics" aria-label="事件密度汇总">
            <div>
              <small>游戏时长</small>
              <strong>
                {summary.durationMinutes}
                <em>分钟</em>
              </strong>
              <span>{summary.gameDays.toFixed(2)} 游戏天</span>
            </div>
            <div>
              <small>完整事件集合</small>
              <strong>
                {summary.totalEvents}
                <em>条</em>
              </strong>
              <span>含开局事件</span>
            </div>
            <div>
              <small>生活事件密度</small>
              <strong>{summary.storyEventsPerGameHour.toFixed(2)}</strong>
              <span>
                {summary.storyEvents} 条生活事件 /{" "}
                {summary.durationMinutes / 60} 游戏小时
              </span>
            </div>
            <div>
              <small>冲突 / 传闻</small>
              <strong>
                {summary.byKind.conflict} / {summary.byKind.rumor}
              </strong>
              <span>来自同一归档事件集</span>
            </div>
          </div>
          <p className="relationship-stat">
            关系升温 <b>{summary.relationships.warmingCount}</b> 次 · 摩擦等降温{" "}
            <b>{summary.relationships.frictionCoolingCount}</b> 次 · 自然疏远{" "}
            <b>{summary.relationships.decayPairMinutes}</b> 对分钟；净升温{" "}
            {summary.relationships.netWarmedPairs} 对 / 净降温{" "}
            {summary.relationships.netCooledPairs} 对。
          </p>
          <details className="review-details">
            <summary>按 kind 核对计数与统计口径</summary>
            <table>
              <thead>
                <tr>
                  <th>kind</th>
                  <th>含义</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byKind).map(([kind, count]) => (
                  <tr key={kind}>
                    <td>{kind}</td>
                    <td>{EVENT_LABELS[kind as EventKind]}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              全量日志密度 {summary.eventsPerGameHour.toFixed(2)} 条/游戏小时。
              生活事件只计偶遇/入座、冲突、传闻与纸条，排除目标、移动、热改、system；仍不等于独立故事链或趣味质量。
              升温/摩擦降温按每关系对每分钟的实际账本增减各计一次；疏远统计的是发生衰减的“关系对
              ×
              分钟”，不是故事条数。新关系以建立时初值为基线。默认无人干预，纸条和热改为
              0。完整档案不受右侧 240 条窗口裁剪影响。
            </p>
          </details>
          <div className="review-actions">
            <button
              disabled={busy}
              onClick={() =>
                attempt(() =>
                  download(
                    "little-universe-review.json",
                    exportReviewRun(run),
                    "application/json",
                  ),
                )
              }
            >
              <Download size={13} />
              导出本局 JSON
            </button>
            <button
              disabled={busy}
              onClick={() =>
                download("review-report.md", markdown, "text/markdown")
              }
            >
              导出复盘 Markdown
            </button>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(markdown);
                  setMessage("复盘 Markdown 已复制。");
                } catch {
                  setMessage(
                    "剪贴板不可用，请展开报告文本复制，或下载 Markdown。",
                  );
                }
              }}
            >
              复制复盘
            </button>
          </div>
          <details className="review-details">
            <summary>报告文本（可复制）</summary>
            <textarea
              aria-label="复盘 Markdown"
              readOnly
              rows={10}
              value={markdown}
            />
          </details>
          <div className="replay-controls" aria-label="回放控制">
            <div className="review-report-heading">
              <h3>
                {review.mode === "replay" ? "正在回看记录" : "打开这局的回放"}
              </h3>
              <span>回放 ×1 = 每秒 {REPLAY_MINUTES_PER_SECOND} 游戏分钟</span>
            </div>
            <div className="review-actions">
              <button disabled={busy} onClick={sim.playReview}>
                {review.playing ? <Pause size={13} /> : <Play size={13} />}
                {review.playing ? "暂停回放" : "播放回放"}
              </button>
              {([1, 2, 8] as const).map((speed) => (
                <button
                  key={speed}
                  aria-pressed={review.speed === speed}
                  onClick={() => sim.setReplaySpeed(speed)}
                  disabled={busy}
                >
                  回放 ×{speed}
                </button>
              ))}
              {review.mode === "replay" && (
                <button onClick={sim.exitReview}>退出回放，返回当前世界</button>
              )}
            </div>
            <input
              aria-label="回放进度"
              type="range"
              min={0}
              max={run.durationMinutes}
              step={1}
              value={Math.floor(review.cursor)}
              disabled={busy}
              onChange={(e) => sim.seekReview(Number(e.target.value))}
            />
            <div className="replay-position">
              <span>
                D{dayOf(run.startTime + Math.floor(review.cursor))}{" "}
                {formatTime(run.startTime + Math.floor(review.cursor))} · +
                {Math.floor(review.cursor)} / {run.durationMinutes} 分钟
              </span>
              <label>
                跳至分钟
                <input
                  aria-label="回放分钟"
                  type="number"
                  min={0}
                  max={run.durationMinutes}
                  value={Math.floor(review.cursor)}
                  disabled={busy}
                  onChange={(e) => sim.seekReview(Number(e.target.value))}
                />
              </label>
            </div>
            <p>
              拖动后暂停在该分钟；地图、居民详情和右侧时间线一起回到记录时刻。回放只读，不会改写当前世界或
              W3 草稿。
            </p>
          </div>
          <div className="review-report-heading">
            <h3>{samples.length} 段值得回看的生活</h3>
            <span>确定性选样 · 真实事件链</span>
          </div>
          <div className="review-samples">
            {samples.map((sample, i) => (
              <article key={sample.id}>
                <span>
                  {String(i + 1).padStart(2, "0")} · {sample.category} · D
                  {dayOf(sample.time)} {formatTime(sample.time)}
                </span>
                <h4>{sample.title}</h4>
                <p>
                  {sample.actors
                    .map(
                      (id) => run.config.agents.find((a) => a.id === id)!.name,
                    )
                    .join("、")}{" "}
                  · {run.config.places.find((p) => p.id === sample.place)!.name}
                </p>
                <p className="sample-reason">{sample.reason}</p>
                <div>
                  <small>
                    链 {sample.eventIds.map((id) => `#${id}`).join(" → ")}
                  </small>
                  <button
                    disabled={busy}
                    onClick={() => selectEvent(sample.anchorId)}
                    aria-label={`回看样本${i + 1}`}
                  >
                    回看这一刻 ↗
                  </button>
                </div>
              </article>
            ))}
          </div>
          <details className="review-details">
            <summary>完整事件检索（分页，不刷屏）</summary>
            <div className="archive-query">
              <label>
                事件种类
                <select
                  aria-label="归档事件种类"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value as EventKind | "all");
                    setPage(0);
                  }}
                >
                  <option value="all">全部</option>
                  {Object.entries(EVENT_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label} · {key}
                    </option>
                  ))}
                </select>
              </label>
              <span aria-label="归档匹配数量">匹配 {events.length} 条</span>
              <button
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span>
                {currentPage + 1}/{pages}
              </span>
              <button
                disabled={currentPage >= pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </div>
            <ol className="archive-events">
              {events
                .slice(currentPage * 20, (currentPage + 1) * 20)
                .map((event) => (
                  <li key={event.id}>
                    <button
                      disabled={busy}
                      onClick={() => selectEvent(event.id)}
                    >
                      <span>
                        #{event.id} · D{dayOf(event.time)}{" "}
                        {formatTime(event.time)} · {EVENT_LABELS[event.kind]}
                      </span>
                      {event.text}
                    </button>
                  </li>
                ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
