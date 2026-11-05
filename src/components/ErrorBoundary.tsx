import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="data-error" role="alert">
        <h1>界面暂时无法继续显示</h1>
        <p>{this.state.error.message}</p>
        <p>刷新会清空未导出的进度；已下载的局文件仍可重新导入。</p>
        <button onClick={() => window.location.reload()}>刷新并重新开局</button>
      </main>
    );
  }
}
