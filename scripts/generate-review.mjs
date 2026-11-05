import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { data } = await server.ssrLoadModule("/src/sim/data.ts");
  const { startRecording, advanceRecording, finishRecording } =
    await server.ssrLoadModule("/src/review/recorder.ts");
  const { exportReviewRun } = await server.ssrLoadModule("/src/review/file.ts");
  const { summarizeRun, reportMarkdown } = await server.ssrLoadModule(
    "/src/review/report.ts",
  );
  let recording = startRecording(data);
  while (recording.elapsedMinutes < recording.targetMinutes)
    recording = advanceRecording(recording, 30);
  const run = finishRecording(recording);
  await mkdir("public/fixtures", { recursive: true });
  await writeFile(
    "public/fixtures/review-run.json",
    exportReviewRun(run),
    "utf8",
  );
  await writeFile(
    "public/fixtures/review-report.md",
    reportMarkdown(run),
    "utf8",
  );
  console.log(
    JSON.stringify(
      { file: "public/fixtures/review-run.json", ...summarizeRun(run) },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
