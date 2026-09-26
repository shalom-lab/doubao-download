/**
 * 注入到豆包页面 MAIN world 的脚本（可访问页面 React Fiber）。
 * 由 popup 通过 chrome.scripting.executeScript({ world: 'MAIN' }) 加载。
 */
import {
  extractHdImages,
  sanitizePrefix,
  getCurrentChatId,
} from "../utils/extract-hd";
import { downloadImagesAsZip } from "../utils/zip-download";

export type ProgressPhase =
  | "idle"
  | "scan"
  | "fetch"
  | "zip"
  | "done"
  | "error";

export type DoubaoHdProgress = {
  phase: ProgressPhase;
  message: string;
  chatId?: string | null;
  found?: number;
  current?: number;
  total?: number;
  percent?: number;
  zipName?: string;
  ok?: number;
  fail?: number;
  bytes?: number;
};

export type DoubaoHdRunResult = {
  ok: number;
  fail: number;
  zipName: string;
  bytes: number;
  found: number;
  chatId: string | null;
};

export type DoubaoHdApi = {
  logs: string[];
  progress: DoubaoHdProgress;
  running: boolean;
  /** 后台任务结果（供 popup 轮询，避免 executeScript 堵死） */
  jobResult:
    | { ok: true; data: DoubaoHdRunResult }
    | { ok: false; error: string }
    | null;
  /** 启动打包（立即返回，结果写入 jobResult） */
  startRun: (opts: { prefix: string }) => boolean;
  run: (opts: { prefix: string }) => Promise<DoubaoHdRunResult>;
};

declare global {
  interface Window {
    __DOUBAO_HD__?: DoubaoHdApi;
  }
}

export default defineUnlistedScript(() => {
  if (window.__DOUBAO_HD__) {
    console.log("[doubao-hd] MAIN world api already installed");
    return;
  }

  const logs: string[] = [];
  const pushLog = (text: string) => {
    logs.push(text);
    console.log("[doubao-hd]", text);
  };

  const setProgress = (
    p: Partial<DoubaoHdProgress> & { phase: ProgressPhase; message: string }
  ) => {
    api.progress = { ...api.progress, ...p };
  };

  const api: DoubaoHdApi = {
    logs,
    progress: { phase: "idle", message: "就绪" },
    running: false,
    jobResult: null,

    startRun(opts) {
      if (api.running) return false;
      api.jobResult = null;
      void api.run(opts).then(
        (data) => {
          api.jobResult = { ok: true, data };
        },
        (e) => {
          const error = e instanceof Error ? e.message : String(e);
          api.jobResult = { ok: false, error };
        }
      );
      return true;
    },

    async run(opts) {
      if (api.running) throw new Error("已有下载任务进行中");
      api.running = true;
      api.jobResult = null;
      try {
        const prefix = sanitizePrefix(opts.prefix || "0001");
        const chatId = getCurrentChatId();
        setProgress({
          phase: "scan",
          message: "正在查找当前会话图片…",
          chatId,
          found: 0,
          percent: 8,
        });
        pushLog(
          `开始打包… prefix=${prefix} chatId=${chatId || "?"}（仅当前会话·最清晰）`
        );

        const items = await extractHdImages(prefix, (t) => {
          setProgress({
            phase: "scan",
            message: t.message,
            chatId,
            found: t.found,
            percent: Math.min(40, t.percent),
          });
        });
        (window as unknown as { __doubaoHdImages?: typeof items }).__doubaoHdImages =
          items;

        if (!items.length) {
          setProgress({
            phase: "error",
            message: "没找到大图。请先点开一张图进入预览。",
            chatId,
            found: 0,
            percent: 0,
          });
          throw new Error(
            "没找到大图。请先在对话里点开一张图进入右侧预览，再点打包。"
          );
        }

        const zipName = `${prefix}-共${items.length}张.zip`;
        setProgress({
          phase: "fetch",
          message: `已找到 ${items.length} 张，开始拉取…`,
          chatId,
          found: items.length,
          current: 0,
          total: items.length,
          percent: 0,
          zipName,
        });
        pushLog(`找到 ${items.length} 张 → ${prefix}/ … 输出 ${zipName}`);

        let lastZipPct = -10;
        const result = await downloadImagesAsZip({
          items,
          zipName,
          folderInsideZip: prefix,
          concurrency: 10,
          onProgress: (p) => {
            if (p.phase === "fetch") {
              const cur = p.current ?? 0;
              const tot = p.total ?? items.length;
              const pct = tot ? Math.round((cur / tot) * 100) : 0;
              setProgress({
                phase: "fetch",
                message: `拉取中 ${cur}/${tot}`,
                chatId,
                found: items.length,
                current: cur,
                total: tot,
                percent: pct,
                zipName,
              });
              pushLog(p.message);
            } else if (p.phase === "zip") {
              const m = p.message.match(/(\d+)%/);
              const pct = m ? Number(m[1]) : undefined;
              setProgress({
                phase: "zip",
                message: p.message,
                chatId,
                found: items.length,
                current: items.length,
                total: items.length,
                percent: pct ?? 100,
                zipName,
              });
              if (pct == null || pct - lastZipPct >= 15 || pct >= 100) {
                lastZipPct = pct ?? 100;
                pushLog(p.message);
              }
            } else {
              pushLog(p.message);
            }
          },
        });

        const out: DoubaoHdRunResult = {
          ...result,
          found: items.length,
          chatId,
        };
        setProgress({
          phase: "done",
          message: `完成：${result.zipName}（${(result.bytes / 1048576).toFixed(1)} MB）`,
          chatId,
          found: items.length,
          current: result.ok,
          total: items.length,
          percent: 100,
          zipName: result.zipName,
          ok: result.ok,
          fail: result.fail,
          bytes: result.bytes,
        });
        pushLog(
          `完成：成功 ${result.ok}，失败 ${result.fail} → ${result.zipName}`
        );
        return out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setProgress({ phase: "error", message: msg, percent: 0 });
        throw e;
      } finally {
        api.running = false;
      }
    },
  };

  window.__DOUBAO_HD__ = api;
  console.log("[doubao-hd] MAIN world api ready", location.href);
});
