import { sanitizePrefix } from "../../utils/extract-hd";

const PREFIX_KEY = "doubao_hd_prefix";
const MAIN_SCRIPT_FILE = "doubao-main.js";

type ProgressPhase =
  | "idle"
  | "scan"
  | "fetch"
  | "zip"
  | "done"
  | "error";

type DoubaoHdProgress = {
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

type JobResult =
  | {
      ok: true;
      data: {
        ok: number;
        fail: number;
        zipName: string;
        bytes: number;
        found: number;
        chatId: string | null;
      };
    }
  | { ok: false; error: string }
  | null;

const PHASE_LABEL: Record<ProgressPhase, string> = {
  idle: "就绪",
  scan: "查找中",
  fetch: "拉取中",
  zip: "打包中",
  done: "完成",
  error: "出错",
};

const prefixEl = document.getElementById("prefix") as HTMLInputElement;
const previewEl = document.getElementById("preview")!;
const runBtn = document.getElementById("run") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const clearBtn = document.getElementById("clear-log") as HTMLButtonElement;
const copyConsoleBtn = document.getElementById(
  "copy-console"
) as HTMLButtonElement;
const progressCard = document.getElementById("progress-card")!;
const phaseEl = document.getElementById("phase")!;
const progressMeta = document.getElementById("progress-meta")!;
const barFill = document.getElementById("bar-fill")!;
const progressMsg = document.getElementById("progress-msg")!;
const statChat = document.getElementById("stat-chat")!;
const statFound = document.getElementById("stat-found")!;
const statPct = document.getElementById("stat-pct")!;

function namingPreview(prefix: string, count?: number) {
  const p = sanitizePrefix(prefix);
  const n = count != null ? String(count) : "N";
  return `${p}-共${n}张.zip → ${p}/${p}-01.png, ${p}-02.png …`;
}

function setPreview(text: string) {
  const v = previewEl.querySelector(".preview-v");
  if (v) v.textContent = text;
  else previewEl.textContent = text;
}

function setStatus(text: string, kind: "" | "ok" | "err" = "") {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function appendLog(line: string) {
  const stamp = new Date().toLocaleTimeString();
  const next = `${logEl.textContent || ""}\n[${stamp}] ${line}`.trim();
  const lines = next.split("\n");
  logEl.textContent = lines.slice(-120).join("\n");
  logEl.scrollTop = logEl.scrollHeight;
}

function applyProgress(p: DoubaoHdProgress) {
  progressCard.hidden = false;
  phaseEl.textContent = PHASE_LABEL[p.phase] || p.phase;
  progressMsg.textContent = p.message || "—";
  const pct = Math.max(0, Math.min(100, p.percent ?? 0));
  barFill.style.width = `${pct}%`;
  progressMeta.textContent =
    p.current != null && p.total != null
      ? `${p.current}/${p.total}`
      : p.found != null
        ? `共 ${p.found} 张`
        : "";
  statChat.textContent = p.chatId ? p.chatId.slice(-8) : "—";
  statChat.title = p.chatId || "";
  statFound.textContent = p.found != null ? `${p.found} 张` : "—";
  statPct.textContent = `${pct}%`;

  if (p.found != null && p.found > 0) {
    setPreview(namingPreview(prefixEl.value, p.found));
  }

  if (p.phase === "done") setStatus(p.message, "ok");
  else if (p.phase === "error") setStatus(p.message, "err");
  else setStatus(p.message);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 让浏览器先画一帧，避免点击后“像没反应” */
async function paint() {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

async function loadPrefs() {
  const stored = await browser.storage.local.get([PREFIX_KEY]);
  prefixEl.value = (stored[PREFIX_KEY] as string) || "0001";
  setPreview(namingPreview(prefixEl.value));
}

prefixEl.addEventListener("input", () => {
  setPreview(namingPreview(prefixEl.value));
});

clearBtn.addEventListener("click", () => {
  logEl.textContent = "就绪";
});

async function copyConsoleFallback() {
  const prefix = sanitizePrefix(prefixEl.value);
  prefixEl.value = prefix;
  await browser.storage.local.set({ [PREFIX_KEY]: prefix });

  copyConsoleBtn.disabled = true;
  try {
    const url = browser.runtime.getURL("doubao-console-batch-download.js");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`读取脚本失败 HTTP ${res.status}`);
    let text = await res.text();
    text = text.replace(
      /const PREFIX = "0001";/,
      `const PREFIX = ${JSON.stringify(prefix)};`
    );
    await navigator.clipboard.writeText(text);
    setStatus(
      "已复制 Console 脚本。到豆包页按 F12 → Console 粘贴回车即可。",
      "ok"
    );
    appendLog(`已复制兜底脚本（PREFIX=${prefix}）`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`复制失败：${msg}`, "err");
    appendLog(`复制失败：${msg}`);
  } finally {
    copyConsoleBtn.disabled = false;
  }
}

copyConsoleBtn.addEventListener("click", () => {
  copyConsoleFallback().catch(() => {});
});

async function getActiveDoubaoTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) return null;
  if (!/^https:\/\/([a-z0-9-]+\.)?doubao\.com\//i.test(tab.url)) return null;
  return tab;
}

async function ensureMainWorld(tabId: number) {
  await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [MAIN_SCRIPT_FILE],
  });
}

async function pollMain(tabId: number): Promise<{
  logs: string[];
  progress: DoubaoHdProgress | null;
  running: boolean;
  jobResult: JobResult;
}> {
  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const api = (
        window as unknown as {
          __DOUBAO_HD__?: {
            logs: string[];
            progress: DoubaoHdProgress;
            running: boolean;
            jobResult: JobResult;
          };
        }
      ).__DOUBAO_HD__;
      if (!api) {
        return {
          logs: [] as string[],
          progress: null,
          running: false,
          jobResult: null as JobResult,
        };
      }
      return {
        logs: api.logs.splice(0, api.logs.length),
        progress: { ...api.progress },
        running: api.running,
        jobResult: api.jobResult,
      };
    },
  });
  return (
    result || {
      logs: [],
      progress: null,
      running: false,
      jobResult: null,
    }
  );
}

async function startRunJob(tabId: number, prefix: string) {
  const [{ result, error }] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [prefix],
    func: (p: string) => {
      const api = (
        window as unknown as {
          __DOUBAO_HD__?: { startRun: (o: { prefix: string }) => boolean };
        }
      ).__DOUBAO_HD__;
      if (!api?.startRun) throw new Error("MAIN world 未就绪");
      return api.startRun({ prefix: p });
    },
  });
  if (error) throw new Error(String(error));
  if (!result) throw new Error("无法启动任务（可能已有任务在跑）");
}

runBtn.addEventListener("click", () => {
  void (async () => {
    const prefix = sanitizePrefix(prefixEl.value);
    prefixEl.value = prefix;
    setPreview(namingPreview(prefix));
    await browser.storage.local.set({ [PREFIX_KEY]: prefix });

    // 立刻反馈，先画出来
    runBtn.disabled = true;
    progressCard.hidden = false;
    applyProgress({
      phase: "scan",
      message: "已点击，正在启动…",
      percent: 3,
    });
    appendLog(`打包 prefix=${prefix}`);
    await paint();

    const tab = await getActiveDoubaoTab();
    if (!tab?.id) {
      setStatus("请先打开 doubao.com 对话页，再点扩展图标。", "err");
      appendLog("当前标签不是豆包页面");
      applyProgress({
        phase: "error",
        message: "当前不是豆包对话页",
        percent: 0,
      });
      runBtn.disabled = false;
      return;
    }

    try {
      setStatus("注入脚本…");
      await ensureMainWorld(tab.id);
      appendLog("MAIN world 已就绪");
      applyProgress({
        phase: "scan",
        message: "已启动，查找图片中…",
        percent: 6,
      });
      await paint();

      // 关键返回：真正干活在页面里异步跑，popup 只轮询进度
      await startRunJob(tab.id, prefix);

      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const state = await pollMain(tab.id);
        for (const line of state.logs) appendLog(line);
        if (state.progress) applyProgress(state.progress);

        if (state.jobResult) {
          if (state.jobResult.ok) {
            const r = state.jobResult.data;
            setPreview(namingPreview(prefix, r.found));
            appendLog(
              `完成：成功 ${r.ok}，失败 ${r.fail} → ${r.zipName}（${(r.bytes / 1048576).toFixed(1)} MB）`
            );
            setStatus(`已下载 ${r.zipName}`, "ok");
          } else {
            throw new Error(state.jobResult.error);
          }
          return;
        }

        if (!state.running && !state.jobResult) {
          // 刚启动的瞬间可能还没置 running
          await sleep(120);
          continue;
        }
        await sleep(200);
      }
      throw new Error("超时：任务超过 10 分钟未结束");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg, "err");
      appendLog(msg);
      applyProgress({ phase: "error", message: msg, percent: 0 });
      try {
        const state = await pollMain(tab.id);
        for (const line of state.logs) appendLog(line);
        if (state.progress) applyProgress(state.progress);
      } catch {
        /* ignore */
      }
    } finally {
      runBtn.disabled = false;
    }
  })();
});

loadPrefs();
