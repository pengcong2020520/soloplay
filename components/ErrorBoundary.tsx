"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
  message: string;
  isDomConflict: boolean;
}

/**
 * 全局错误边界。
 *
 * 主要目的：兜住浏览器翻译插件（沉浸式翻译 / Google 翻译等）改写 DOM 后，
 * 与 React 流式更新冲突引发的 "NotFoundError: Failed to execute 'removeChild' / 'insertBefore'"。
 * 这类错误并非应用逻辑问题，重新挂载即可恢复。对于这类 DOM 冲突，自动尝试一次静默恢复；
 * 其它错误则展示友好的重试界面，而不是整页崩溃白屏。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: "", isDomConflict: false };
  private autoRecovered = false;

  static getDerivedStateFromError(error: Error): State {
    const msg = error?.message ?? String(error);
    const isDomConflict =
      /removeChild|insertBefore|The node (to be removed|before which the new node is to be inserted) is not a child/i.test(
        msg
      );
    return { hasError: true, message: msg, isDomConflict };
  }

  componentDidCatch() {
    // DOM 冲突（翻译插件所致）尝试一次自动恢复：清错误态触发重新渲染
    if (this.state.isDomConflict && !this.autoRecovered) {
      this.autoRecovered = true;
      // 下一帧重置，给被插件改动的 DOM 一点稳定时间
      requestAnimationFrame(() => {
        this.setState({ hasError: false, message: "", isDomConflict: false });
      });
    }
  }

  private reload = () => {
    this.autoRecovered = false;
    this.setState({ hasError: false, message: "", isDomConflict: false });
  };

  render() {
    if (this.state.hasError) {
      // DOM 冲突且正在自动恢复时，渲染空占位，避免闪烁
      if (this.state.isDomConflict && this.autoRecovered) {
        return null;
      }
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h2 className="text-lg font-semibold">页面遇到一点小问题</h2>
          {this.state.isDomConflict ? (
            <p className="max-w-md text-sm text-muted-foreground">
              检测到可能由浏览器翻译插件改动页面导致的冲突。本应用为中文动态内容，建议在本页关闭翻译插件后重试。
            </p>
          ) : (
            <p className="max-w-md text-sm text-muted-foreground">{this.state.message}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.reload}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              重试
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
