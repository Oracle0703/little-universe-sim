import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { data, validateData } from "./sim/data";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
try {
  validateData(data);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} catch (error) {
  root.render(
    <main className="data-error">
      <h1>数据需要修正</h1>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <p>请检查 src/data 下的 JSON。修正并保存后刷新页面即可。</p>
    </main>,
  );
}
