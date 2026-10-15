import { sanitizePrefix } from "../../utils/extract-hd";
import { CHAT_SUBMITS_KEY, chatIdFromKey, chatSubmitKey, type ChatSubmitMap } from "../../utils/chat-submit";

const PREFIX_KEY = "doubao_hd_prefix";
const JPEG_KEY = "doubao_convert_jpeg";
const jpegEl = document.getElementById("convert-jpeg") as HTMLInputElement;
let jpegChanged = false;
let jpegSaveQueue = Promise.resolve();
const jpegReady = browser.storage.local.get([JPEG_KEY]).then((stored) => {
  if (!jpegChanged) jpegEl.checked = stored[JPEG_KEY] !== false;
});
void jpegReady.catch(() => setStatus("读取图片设置失败，请重新选择 JPEG 选项。", "err"));
jpegEl.addEventListener("change", () => {
  jpegChanged = true;
  const enabled = jpegEl.checked;
  jpegSaveQueue = jpegSaveQueue.catch(() => {}).then(() => browser.storage.local.set({ [JPEG_KEY]: enabled }));
  void jpegSaveQueue.catch(() => setStatus("图片设置保存失败。", "err"));
});
const MAIN_SCRIPT_FILE = "/doubao-main.js";

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
  return `${p}-共${n}张.zip → ${p}/${p}-01、${p}-02 …（后缀按实际格式）`;
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
  setPreview(namingPreview(prefixEl.value, picked(downloadImages).length || undefined));
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
    const url = browser.runtime.getURL("/doubao-console-batch-download.js");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`读取脚本失败 HTTP ${res.status}`);
    let text = await res.text();
    await jpegReady;
    text = text.replace("const CONVERT_TO_JPEG = true;", `const CONVERT_TO_JPEG = ${jpegEl.checked};`);
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
  const [injection] = await browser.scripting.executeScript({
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
    injection?.result || {
      logs: [],
      progress: null,
      running: false,
      jobResult: null,
    }
  );
}

type DraftImage = { id: string; url: string; name: string; selected?: boolean };
type ContentDraft = { contents: string; reply_words: string; images: DraftImage[]; scanned: boolean };
const downloadImageList = document.getElementById("download-image-list")!;
const downloadCountEl = document.getElementById("download-image-count")!;
const scanDownloadBtn = document.getElementById("scan-download-images") as HTMLButtonElement;
let downloadImages: DraftImage[] = [];
let downloadScanned = false;
let scanningDownload = false;
let extractingImages: Promise<DraftImage[]> | undefined;
let draggedId: string | null = null;

function picked(images: DraftImage[]) {
  return images.filter((item) => item.selected !== false);
}

type RangeAction = "select-before" | "select-after" | "clear-before" | "clear-after";
type RangeMenuTarget = {
  index: number;
  images: DraftImage[];
  listEl: HTMLElement;
  countEl: HTMLElement;
  verb: string;
  onChange: () => void;
};
let rangeMenuTarget: RangeMenuTarget | null = null;
const rangeMenu = document.getElementById("image-range-menu") as HTMLMenuElement;

function hideRangeMenu() {
  rangeMenu.hidden = true;
  rangeMenuTarget = null;
}

function showRangeMenu(event: MouseEvent, target: RangeMenuTarget) {
  event.preventDefault();
  event.stopPropagation();
  rangeMenuTarget = target;
  rangeMenu.hidden = false;
  const pad = 8;
  const { width, height } = rangeMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - width - pad);
  const top = Math.min(event.clientY, window.innerHeight - height - pad);
  rangeMenu.style.left = `${Math.max(pad, left)}px`;
  rangeMenu.style.top = `${Math.max(pad, top)}px`;
}

function applyRangeAction(action: RangeAction) {
  const target = rangeMenuTarget;
  hideRangeMenu();
  if (!target) return;
  const { index, images, listEl, countEl, verb, onChange } = target;
  // Include the clicked card as the range endpoint for all four actions.
  images.forEach((image, i) => {
    if (action === "select-before" && i <= index) image.selected = true;
    if (action === "select-after" && i >= index) image.selected = true;
    if (action === "clear-before" && i <= index) image.selected = false;
    if (action === "clear-after" && i >= index) image.selected = false;
  });
  renderPicker(listEl, countEl, images, verb, onChange);
  onChange();
}

rangeMenu.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-range-action]");
  if (!button?.dataset.rangeAction) return;
  applyRangeAction(button.dataset.rangeAction as RangeAction);
});
document.addEventListener("pointerdown", (event) => {
  if (!rangeMenu.hidden && !rangeMenu.contains(event.target as Node)) hideRangeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideRangeMenu();
});
window.addEventListener("blur", hideRangeMenu);
window.addEventListener("resize", hideRangeMenu);

function renderPicker(
  listEl: HTMLElement,
  countEl: HTMLElement,
  images: DraftImage[],
  verb: string,
  onChange: () => void
) {
  const refreshCount = () => {
    countEl.textContent = images.length ? `${picked(images).length}/${images.length}` : "0";
  };
  listEl.replaceChildren();
  refreshCount();
  if (!images.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "暂无图片，可打开豆包大图预览后获取。";
    listEl.append(empty);
    return;
  }
  images.forEach((item, index) => {
    const selected = item.selected !== false;
    const card = document.createElement("figure");
    card.className = `image-card loading${selected ? "" : " unselected"}`;
    card.draggable = true;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = `对话图片 ${index + 1}`;
    img.referrerPolicy = "no-referrer";
    img.draggable = false;
    img.onclick = () => {
      if (draggedId) return;
      check.checked = !check.checked;
      check.dispatchEvent(new Event("change"));
    };
    const caption = document.createElement("figcaption");
    caption.textContent = `第 ${index + 1} 张`;
    img.addEventListener("load", () => { card.classList.remove("loading"); });
    img.addEventListener("error", () => { card.classList.remove("loading"); caption.textContent = `第 ${index + 1} 张 · 加载失败`; });
    img.src = item.url;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "select-image";
    check.checked = selected;
    check.title = `勾选后${verb}`;
    check.draggable = false;
    check.setAttribute("aria-label", `${verb}第 ${index + 1} 张图片`);
    const selectHit = document.createElement("label");
    selectHit.className = "select-hit";
    selectHit.title = `勾选后${verb}`;
    selectHit.append(check);
    selectHit.addEventListener("pointerdown", (event) => event.stopPropagation());
    selectHit.addEventListener("click", (event) => event.stopPropagation());
    check.onchange = () => {
      item.selected = check.checked;
      card.classList.toggle("unselected", !check.checked);
      refreshCount();
      onChange();
    };
    const zoom = document.createElement("button");
    zoom.type = "button";
    zoom.className = "zoom-image";
    zoom.title = "放大查看";
    zoom.setAttribute("aria-label", `放大第 ${index + 1} 张图片`);
    zoom.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/></svg>';
    zoom.addEventListener("pointerdown", (event) => event.stopPropagation());
    zoom.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!draggedId) openPreview(item, index);
    });
    card.oncontextmenu = (event) => {
      showRangeMenu(event, { index, images, listEl, countEl, verb, onChange });
    };
    card.append(img, caption, selectHit, zoom);
    card.ondragstart = (event) => {
      hideRangeMenu();
      if ((event.target as HTMLElement).closest(".select-hit, .zoom-image")) {
        event.preventDefault();
        return;
      }
      draggedId = item.id;
      event.dataTransfer?.setData("text/plain", item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    card.ondragover = (event) => { event.preventDefault(); card.classList.add("drag-over"); };
    card.ondragleave = () => card.classList.remove("drag-over");
    card.ondragend = () => {
      draggedId = null;
      listEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    };
    card.ondrop = (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      const from = images.findIndex((image) => image.id === draggedId);
      draggedId = null;
      if (from < 0 || from === index) return;
      const [moved] = images.splice(from, 1);
      if (!moved) return;
      images.splice(index, 0, moved);
      renderPicker(listEl, countEl, images, verb, onChange);
      onChange();
    };
    listEl.append(card);
  });
}

function renderDownloadImages() {
  renderPicker(downloadImageList, downloadCountEl, downloadImages, "下载", () => {
    setPreview(namingPreview(prefixEl.value, picked(downloadImages).length || undefined));
  });
}

function setAllSelected(images: DraftImage[], selected: boolean, render: () => void, onChange: () => void) {
  if (!images.length) return;
  for (const item of images) item.selected = selected;
  render();
  onChange();
}

async function extractChatImages(): Promise<DraftImage[]> {
  if (!extractingImages) {
    extractingImages = (async () => {
      const tab = await getActiveDoubaoTab();
      if (!tab?.id || !/\/chat\/\d+/.test(new URL(tab.url!).pathname)) throw new Error("请先打开豆包对话页。");
      await ensureMainWorld(tab.id);
      const [injection] = await browser.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async () => {
          const api = window.__DOUBAO_HD__;
          if (!api?.extractImages) throw new Error("请刷新豆包页面后重试。");
          return api.extractImages();
        },
      });
      if (injection && "error" in injection && injection.error) throw new Error(String(injection.error));
      const items = (injection?.result || []) as DraftImage[];
      if (!items.length) throw new Error("未找到图片，请先点开一张图进入预览后再试。");
      return items.map((item) => ({ ...item, selected: true as const }));
    })();
  }
  try {
    const items = await extractingImages;
    return items.map((item) => ({ ...item }));
  } finally { extractingImages = undefined; }
}

let downloadScanTask: Promise<void> | undefined;
async function scanDownloadImages(automatic = false) {
  if (downloadScanTask) return downloadScanTask;
  downloadScanTask = (async () => {
    scanningDownload = true;
    scanDownloadBtn.disabled = true;
    if (!automatic) setStatus("正在获取当前对话图片…");
    try {
      downloadImages = await extractChatImages();
      downloadScanned = true;
      renderDownloadImages();
      setPreview(namingPreview(prefixEl.value, picked(downloadImages).length));
      setStatus(`已获取 ${downloadImages.length} 张，默认全选，可拖拽排序后打包。`);
    } catch (error) {
      renderDownloadImages();
      const msg = error instanceof Error ? error.message : String(error);
      if (!automatic) setStatus(msg, "err");
      else setStatus(msg === "请先打开豆包对话页。" ? "打开豆包对话后会自动获取图片。" : msg);
    } finally {
      scanningDownload = false;
      scanDownloadBtn.disabled = false;
    }
  })();
  try { await downloadScanTask; }
  finally { downloadScanTask = undefined; }
}

async function startRunJob(
  tabId: number,
  prefix: string,
  convertToJpeg: boolean,
  items: { id: string; url: string }[]
) {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [prefix, convertToJpeg, items],
    func: (p: string, jpeg: boolean, list: { id: string; url: string }[]) => {
      const api = (
        window as unknown as {
          __DOUBAO_HD__?: { startRun: (o: { prefix: string; convertToJpeg: boolean; items?: { id: string; url: string }[] }) => boolean };
        }
      ).__DOUBAO_HD__;
      if (!api?.startRun) throw new Error("MAIN world 未就绪");
      return api.startRun({ prefix: p, convertToJpeg: jpeg, items: list });
    },
  });
  if (injection && "error" in injection && injection.error) throw new Error(String(injection.error));
  if (!injection?.result) throw new Error("无法启动任务（可能已有任务在跑）");
}

runBtn.addEventListener("click", () => {
  void (async () => {
    if (downloadScanTask) await downloadScanTask.catch(() => {});
    const prefix = sanitizePrefix(prefixEl.value);
    prefixEl.value = prefix;
    setPreview(namingPreview(prefix, picked(downloadImages).length || undefined));
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
      if (downloadScanTask) await downloadScanTask.catch(() => {});
      if (!downloadScanned) await scanDownloadImages();
      const selected = picked(downloadImages).map(({ id, url }) => ({ id, url }));
      if (!selected.length) throw new Error("请至少勾选一张图片");
      setPreview(namingPreview(prefix, selected.length));
      setStatus("注入脚本…");
      await ensureMainWorld(tab.id);
      appendLog(`MAIN world 已就绪，按列表顺序打包 ${selected.length} 张`);
      applyProgress({
        phase: "scan",
        message: `按已选 ${selected.length} 张的顺序打包…`,
        percent: 6,
        found: selected.length,
      });
      await paint();

      await jpegReady;
      await startRunJob(tab.id, prefix, jpegEl.checked, selected);

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
scanDownloadBtn.addEventListener("click", () => { void scanDownloadImages(); });
document.getElementById("download-select-all")!.addEventListener("click", () => {
  setAllSelected(downloadImages, true, renderDownloadImages, () => {
    setPreview(namingPreview(prefixEl.value, picked(downloadImages).length || undefined));
  });
});
document.getElementById("download-select-none")!.addEventListener("click", () => {
  setAllSelected(downloadImages, false, renderDownloadImages, () => {
    setPreview(namingPreview(prefixEl.value, picked(downloadImages).length || undefined));
  });
});
void scanDownloadImages(true);

// Content drafts stay in the extension; the page receives only image scan requests.
const contentEl = document.getElementById("contents") as HTMLTextAreaElement;
const replyWordsEl = document.getElementById("reply_words") as HTMLInputElement;
const composeImageList = document.getElementById("image-list")!;
const composeCountEl = document.getElementById("image-count")!;
const composeStatus = document.getElementById("compose-status")!;
const scanBtn = document.getElementById("scan-images") as HTMLButtonElement;
const clipboardBtn = document.getElementById("read-clipboard") as HTMLButtonElement;
const repoEl = document.getElementById("github-repo") as HTMLInputElement;
const tokenEl = document.getElementById("github-token") as HTMLInputElement;
const branchEl = document.getElementById("github-branch") as HTMLInputElement;
const presetListEl = document.getElementById("preset-list")!;
const composePresetSelect = document.getElementById("compose-preset") as HTMLSelectElement;
const presetSaveBtn = document.getElementById("preset-save") as HTMLButtonElement;
const settingsStatus = document.getElementById("settings-status")!;
const submitBtn = document.getElementById("submit-content") as HTMLButtonElement;
const GITHUB_SETTINGS_KEY = "doubao_github_settings";
const GITHUB_PRESETS_KEY = "doubao_github_presets";
type GithubSettingsFields = { repo: string; token: string; branch: string };
type GithubPreset = GithubSettingsFields & { id: string };
type GithubPresetStore = { presets: GithubPreset[]; activeId: string };
let githubPresets: GithubPreset[] = [];
let activePresetId = "";
let activeSettings: GithubSettingsFields = { repo: "", token: "", branch: "" };
let sourceUrl = "";
let scanningImages = false;
let draft: ContentDraft = { contents: "", reply_words: "", images: [], scanned: false };
let draftKey = "doubao_content_draft:general";
let sourceTabId: number | undefined;
let composeOpened = false;
let editVersion = 0;
let saveQueue = Promise.resolve();
const previewDialog = document.getElementById("image-preview") as HTMLDialogElement;
const previewImage = document.getElementById("preview-image") as HTMLImageElement;
const previewLoading = document.getElementById("preview-loading")!;
const editorControls = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | HTMLSelectElement>("#panel-compose input, #panel-compose textarea, #panel-compose button, #panel-compose select, #github-form input, #github-form button, #panel-presets button");
editorControls.forEach((control) => { control.disabled = true; });

function normalizeRepo(raw: string) {
  return raw.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").replace(/\.git$/, "");
}
function isValidRepo(repo: string) {
  return /^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+$/i.test(repo);
}
function readSettingsFromForm(): GithubSettingsFields {
  return { repo: normalizeRepo(repoEl.value), token: tokenEl.value.trim(), branch: branchEl.value.trim() };
}
function fillSettingsForm(settings: Partial<GithubSettingsFields>) {
  repoEl.value = settings.repo || "";
  tokenEl.value = settings.token || "";
  branchEl.value = settings.branch || "";
}
function presetStorePayload(): GithubPresetStore {
  return { presets: githubPresets, activeId: activePresetId };
}
async function persistActiveSettings(settings: GithubSettingsFields) {
  activeSettings = settings;
  await browser.storage.local.set({ [GITHUB_SETTINGS_KEY]: settings });
  renderComposeRepoTarget();
}
async function persistPresetStore() {
  await browser.storage.local.set({ [GITHUB_PRESETS_KEY]: presetStorePayload() });
}
/** Write active settings + preset list together so UI/upload never diverge mid-switch. */
async function persistSettingsAndPresets(settings: GithubSettingsFields) {
  activeSettings = settings;
  await browser.storage.local.set({
    [GITHUB_SETTINGS_KEY]: settings,
    [GITHUB_PRESETS_KEY]: presetStorePayload(),
  });
  renderComposeRepoTarget();
}
function renderComposeRepoTarget() {
  composePresetSelect.replaceChildren();
  if (!githubPresets.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = activeSettings.repo || "暂无预设，请先在设置页「存为预设」";
    composePresetSelect.append(empty);
    composePresetSelect.disabled = true;
    return;
  }
  if (!activePresetId && activeSettings.repo) {
    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = activeSettings.repo;
    composePresetSelect.append(custom);
  } else if (!activePresetId) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "选择上传仓库…";
    composePresetSelect.append(empty);
  }
  for (const item of githubPresets) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.repo;
    composePresetSelect.append(option);
  }
  composePresetSelect.value = activePresetId;
  composePresetSelect.disabled = false;
}
function renderPresetList() {
  const previous = activePresetId;
  activePresetId = githubPresets.some((item) => item.id === previous) ? previous : "";
  presetListEl.replaceChildren();
  if (!githubPresets.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "暂无预设";
    presetListEl.append(empty);
    renderComposeRepoTarget();
    return;
  }
  for (const preset of githubPresets) {
    const row = document.createElement("div");
    row.className = "preset-item";
    const load = document.createElement("button");
    load.type = "button";
    load.className = `preset-load${preset.id === activePresetId ? " is-active" : ""}`;
    load.dataset.presetId = preset.id;
    const label = document.createElement("span");
    label.className = "preset-load-name";
    label.textContent = preset.repo;
    load.append(label);
    if (preset.branch) {
      const branch = document.createElement("span");
      branch.className = "preset-load-repo";
      branch.textContent = `@ ${preset.branch}`;
      load.append(branch);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "preset-remove";
    remove.dataset.presetId = preset.id;
    remove.setAttribute("aria-label", `删除预设 ${preset.repo}`);
    remove.textContent = "×";
    row.append(load, remove);
    presetListEl.append(row);
  }
  renderComposeRepoTarget();
}
/** Clicking a preset fills the original form above (and makes it the active upload target). */
async function loadPresetIntoForm(id: string, statusEl: HTMLElement) {
  const preset = githubPresets.find((item) => item.id === id);
  if (!preset) {
    renderPresetList();
    statusEl.textContent = "预设不存在，已刷新列表。";
    return;
  }
  try {
    fillSettingsForm(preset);
    activePresetId = preset.id;
    await persistSettingsAndPresets({ repo: preset.repo, token: preset.token, branch: preset.branch });
    renderPresetList();
    statusEl.textContent = `已切换到 ${preset.repo}。`;
  } catch { statusEl.textContent = "载入预设失败，请重试。"; }
}
async function switchToPreset(id: string, statusEl: HTMLElement) {
  if (!id) {
    if (!activePresetId) {
      renderPresetList();
      return;
    }
    activePresetId = "";
    renderPresetList();
    try {
      await persistPresetStore();
      statusEl.textContent = "已取消预设选择；当前仍使用已保存的生效仓库。";
    } catch { statusEl.textContent = "预设状态保存失败，请重试。"; }
    return;
  }
  await loadPresetIntoForm(id, statusEl);
}
function openPreview(item: DraftImage, index: number) {
  if (draggedId) return;
  document.getElementById("preview-title")!.textContent = `第 ${index + 1} 张`;
  previewLoading.hidden = false;
  previewLoading.textContent = "图片加载中…";
  previewImage.onload = () => { previewLoading.hidden = true; };
  previewImage.onerror = () => { previewLoading.textContent = "图片加载失败，请重新获取对话图片。"; };
  previewImage.src = item.url;
  previewDialog.showModal();
}
document.getElementById("close-preview")!.onclick = () => previewDialog.close();
previewDialog.addEventListener("close", () => { previewImage.removeAttribute("src"); });
previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) {
    const rect = previewDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) previewDialog.close();
  }
});
function selectedImages() {
  return picked(draft.images);
}

function saveDraft() {
  draft.contents = contentEl.value;
  draft.reply_words = replyWordsEl.value;
  const snapshot = JSON.parse(JSON.stringify(draft)) as ContentDraft;
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await browser.storage.local.set({ [draftKey]: snapshot });
  });
  return saveQueue;
}
function persistDraft() {
  void saveDraft().catch(() => { composeStatus.textContent = "草稿保存失败，请重试。"; });
}
function renderImages() {
  renderPicker(composeImageList, composeCountEl, draft.images, "上传", persistDraft);
}

async function readClipboard(automatic = false) {
  const version = editVersion;
  if (automatic && contentEl.value) return;
  clipboardBtn.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    if (version !== editVersion) return;
    if (!text) { if (!automatic) composeStatus.textContent = "剪贴板中没有文本。"; return; }
    contentEl.value = text;
    editVersion++;
    await saveDraft();
    composeStatus.textContent = "已读取剪贴板，可继续编辑。";
  } catch {
    composeStatus.textContent = "无法读取剪贴板，请在文本框手动粘贴。";
  } finally { clipboardBtn.disabled = false; }
}

function draftKeyFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    if (/\/chat\/\d+/.test(path)) return `doubao_content_draft:${path}`;
  } catch { /* ignore */ }
  return "doubao_content_draft:general";
}

function sourceUrlFromTab(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return "";
  }
}

const settingsReady = (async () => {
  const stored = await browser.storage.local.get([GITHUB_SETTINGS_KEY, GITHUB_PRESETS_KEY]);
  const settings = stored[GITHUB_SETTINGS_KEY] as Partial<GithubSettingsFields> | undefined;
  const presetStore = stored[GITHUB_PRESETS_KEY] as GithubPresetStore | undefined;
  const rawPresets = Array.isArray(presetStore?.presets) ? presetStore!.presets : [];
  githubPresets = rawPresets
    .map((item) => {
      const repo = normalizeRepo(String((item as GithubPreset & { name?: string })?.repo || (item as { name?: string })?.name || ""));
      if (!item || typeof item.id !== "string" || !isValidRepo(repo)) return null;
      return {
        id: item.id,
        repo,
        token: typeof item.token === "string" ? item.token : "",
        branch: typeof item.branch === "string" ? item.branch : "",
      } satisfies GithubPreset;
    })
    .filter((item): item is GithubPreset => !!item);
  const requestedId = typeof presetStore?.activeId === "string" ? presetStore.activeId : "";
  activePresetId = githubPresets.some((item) => item.id === requestedId) ? requestedId : "";
  // Original form always reflects saved settings, not a forced preset overwrite.
  activeSettings = { repo: settings?.repo || "", token: settings?.token || "", branch: settings?.branch || "" };
  fillSettingsForm(activeSettings);
  const needsRewrite = requestedId !== activePresetId
    || rawPresets.length !== githubPresets.length
    || rawPresets.some((item) => item && "name" in item);
  if (needsRewrite) await persistPresetStore();
  renderPresetList();
  editorControls.forEach((control) => { control.disabled = false; });
})();
settingsReady.catch(() => {
  composeStatus.textContent = "读取本地配置失败，请重新打开扩展。";
});

let bindQueue = Promise.resolve();
async function bindActiveChat(options: { rescan?: boolean; silent?: boolean } = {}) {
  await settingsReady;
  await saveQueue.catch(() => {});
  const tab = await getActiveDoubaoTab();
  const nextKey = tab?.url ? draftKeyFromUrl(tab.url) : "doubao_content_draft:general";
  const nextUrl = tab?.url ? sourceUrlFromTab(tab.url) : "";
  const unchanged = tab?.id === sourceTabId && nextKey === draftKey && nextUrl === sourceUrl;
  if (unchanged) {
    const counts = await browser.storage.local.get(CHAT_SUBMITS_KEY);
    renderChatSubmits((counts[CHAT_SUBMITS_KEY] || {}) as ChatSubmitMap);
    return false;
  }

  if (contentEl.value || replyWordsEl.value || draft.images.length) {
    await saveDraft().catch(() => {});
  }

  sourceTabId = tab?.id;
  sourceUrl = nextUrl;
  draftKey = nextKey;
  editVersion++;
  const stored = await browser.storage.local.get([draftKey, CHAT_SUBMITS_KEY]);
  if (stored[draftKey]) {
    const saved = stored[draftKey] as ContentDraft;
    draft = {
      contents: saved.contents ?? "",
      reply_words: saved.reply_words ?? "",
      images: (saved.images ?? []).map((item) => ({ ...item, selected: item.selected !== false })),
      scanned: !!saved.scanned,
    };
  } else {
    draft = { contents: "", reply_words: "", images: [], scanned: false };
  }
  contentEl.value = draft.contents;
  replyWordsEl.value = draft.reply_words;
  renderImages();
  renderChatSubmits((stored[CHAT_SUBMITS_KEY] || {}) as ChatSubmitMap);

  downloadScanned = false;
  downloadImages = [];
  renderDownloadImages();
  void scanDownloadImages(true);

  if (composeOpened) {
    const id = chatIdFromKey(chatSubmitKey(sourceUrl));
    if (!options.silent) {
      composeStatus.textContent = id ? `已切换到对话 ${id}，正在同步…` : "当前不是豆包对话页。";
    }
    if (options.rescan !== false && id) void scanImages();
  }
  return true;
}

function scheduleBindActiveChat(options?: { rescan?: boolean; silent?: boolean }) {
  bindQueue = bindQueue.catch(() => {}).then(() => bindActiveChat(options));
  return bindQueue;
}

async function scanImages() {
  if (scanningImages) return;
  scanningImages = true;
  submitBtn.disabled = true;
  scanBtn.disabled = true;
  composeStatus.textContent = "正在获取当前对话图片…";
  try {
    await scheduleBindActiveChat({ rescan: false, silent: true });
    const tab = await getActiveDoubaoTab();
    if (!tab?.id || !/\/chat\/\d+/.test(new URL(tab.url!).pathname)) throw new Error("请先打开豆包对话页。");
    draft.images = await extractChatImages();
    draft.scanned = true;
    renderImages();
    await saveDraft();
    composeStatus.textContent = `已获取 ${draft.images.length} 张图片，默认全选；取消勾选则不上传。`;
  } catch (error) {
    composeStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally { scanBtn.disabled = false; scanningImages = false; submitBtn.disabled = false; }
}

const editorReady = scheduleBindActiveChat({ rescan: false, silent: true });
editorReady.catch(() => { composeStatus.textContent = "读取本地配置失败，请重新打开扩展。"; });

browser.tabs.onActivated.addListener(() => {
  void scheduleBindActiveChat({ rescan: true });
});
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url && info.status !== "complete") return;
  void browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (tabs[0]?.id === tabId) void scheduleBindActiveChat({ rescan: true });
  });
});

for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
  tab.addEventListener("click", async () => {
    try {
      for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
        const active = button === tab;
        button.setAttribute("aria-pressed", String(active));
        document.getElementById(`panel-${button.dataset.tab}`)!.hidden = !active;
      }
      await paint();
      await editorReady;
      if (tab.getAttribute("aria-pressed") !== "true") return;
      if (tab.dataset.tab === "compose" && !composeOpened) {
        composeOpened = true;
        renderImages();
        void readClipboard(true);
        if (!draft.scanned) void scanImages();
        else void scheduleBindActiveChat({ rescan: false, silent: true });
      }
    } catch { composeStatus.textContent = "初始化失败，请重新打开扩展。"; }
  });
}
document.querySelector<HTMLButtonElement>('[data-tab="compose"]')?.click();
contentEl.addEventListener("input", () => { editVersion++; persistDraft(); });
replyWordsEl.addEventListener("input", persistDraft);
clipboardBtn.addEventListener("click", () => { void readClipboard(); });
scanBtn.addEventListener("click", () => { void scanImages(); });
document.getElementById("compose-select-all")!.addEventListener("click", () => {
  setAllSelected(draft.images, true, renderImages, persistDraft);
});
document.getElementById("compose-select-none")!.addEventListener("click", () => {
  setAllSelected(draft.images, false, renderImages, persistDraft);
});
document.getElementById("submit-content")!.addEventListener("click", async () => {
  if (scanningImages) return;
  submitBtn.disabled = true;
  try {
    await jpegReady;
    await saveDraft();
    const input = { contents: contentEl.value, reply_words: replyWordsEl.value, url: sourceUrl, images: selectedImages().map(({ url, name }) => ({ url, name })), convertToJpeg: jpegEl.checked };
    if (!input.contents.trim() && !input.images.length) throw new Error("请填写 contents 或至少选择一张图片");
    const result = await browser.runtime.sendMessage({ type: "upload:enqueue", input });
    if (!result?.ok) throw new Error(result?.error || "无法保存上传任务");
    composeStatus.textContent = result.existing
      ? result.status === "done" ? "相同内容已上传，未重复创建记录。" : "相同任务已存在，请查看下方进度；失败任务可点击重试。"
      : "任务已保存本地，可关掉侧边栏。图片缓存和上传将在后台继续。";
  } catch (error) { composeStatus.textContent = error instanceof Error ? error.message : "提交失败，请重试。"; }
  finally { submitBtn.disabled = scanningImages; }
});
document.getElementById("github-form")!.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readSettingsFromForm();
  if (!isValidRepo(settings.repo)) {
    settingsStatus.textContent = "请输入 owner/repo 或完整 GitHub 仓库链接。";
    return;
  }
  try {
    repoEl.value = settings.repo;
    const preset = activePresetId ? githubPresets.find((item) => item.id === activePresetId) : undefined;
    // Saving the original form only updates active settings; presets stay as snapshots unless user clicks「存为预设」.
    if (preset && (preset.repo !== settings.repo || preset.token !== settings.token || preset.branch !== settings.branch)) {
      activePresetId = "";
    }
    await persistSettingsAndPresets(settings);
    renderPresetList();
    settingsStatus.textContent = "GitHub 设置已保存。";
  } catch { settingsStatus.textContent = "设置保存失败，请重试。"; }
});

composePresetSelect.addEventListener("change", () => {
  void switchToPreset(composePresetSelect.value, composeStatus);
});

presetSaveBtn.addEventListener("click", async () => {
  const settings = readSettingsFromForm();
  if (!isValidRepo(settings.repo)) {
    settingsStatus.textContent = "请先填写上方有效的 owner/repo，再存为预设。";
    return;
  }
  try {
    repoEl.value = settings.repo;
    const existing = githubPresets.find((item) => item.repo === settings.repo);
    if (existing) {
      Object.assign(existing, settings);
      activePresetId = existing.id;
      settingsStatus.textContent = `已更新预设 ${settings.repo}。`;
    } else {
      const preset: GithubPreset = { id: crypto.randomUUID(), ...settings };
      githubPresets.push(preset);
      activePresetId = preset.id;
      settingsStatus.textContent = `已保存预设 ${settings.repo}。`;
    }
    await persistSettingsAndPresets(settings);
    renderPresetList();
  } catch { settingsStatus.textContent = "存为预设失败，请重试。"; }
});

const presetDeleteDialog = document.getElementById("preset-delete-dialog") as HTMLDialogElement;
const presetDeleteMessage = document.getElementById("preset-delete-message")!;
let pendingDeletePresetId = "";

function closePresetDeleteDialog() {
  pendingDeletePresetId = "";
  if (presetDeleteDialog.open) presetDeleteDialog.close();
}

function askDeletePreset(id: string) {
  const preset = githubPresets.find((item) => item.id === id);
  if (!preset) {
    settingsStatus.textContent = "预设不存在，已刷新列表。";
    renderPresetList();
    return;
  }
  pendingDeletePresetId = preset.id;
  presetDeleteMessage.textContent = `确定删除预设 ${preset.repo}？上方当前设置不会被清空。`;
  presetDeleteDialog.showModal();
}

presetListEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const remove = target?.closest<HTMLButtonElement>("button.preset-remove");
  if (remove?.dataset.presetId) {
    askDeletePreset(remove.dataset.presetId);
    return;
  }
  const load = target?.closest<HTMLButtonElement>("button.preset-load");
  if (load?.dataset.presetId) void loadPresetIntoForm(load.dataset.presetId, settingsStatus);
});

document.getElementById("preset-delete-confirm")!.addEventListener("click", async () => {
  const preset = githubPresets.find((item) => item.id === pendingDeletePresetId);
  closePresetDeleteDialog();
  if (!preset) {
    settingsStatus.textContent = "预设不存在或已删除。";
    return;
  }
  try {
    githubPresets = githubPresets.filter((item) => item.id !== preset.id);
    if (activePresetId === preset.id) activePresetId = "";
    await persistPresetStore();
    renderPresetList();
    settingsStatus.textContent = `已删除预设 ${preset.repo}。`;
  } catch { settingsStatus.textContent = "删除预设失败，请重试。"; }
});

document.getElementById("preset-delete-cancel")!.addEventListener("click", closePresetDeleteDialog);
document.getElementById("preset-delete-cancel-x")!.addEventListener("click", closePresetDeleteDialog);
presetDeleteDialog.addEventListener("cancel", () => { pendingDeletePresetId = ""; });
presetDeleteDialog.addEventListener("click", (event) => {
  if (event.target === presetDeleteDialog) closePresetDeleteDialog();
});

type UploadSummary = { id: string; repo: string; status: string; message: string; done: number; total: number; url: string };
function renderUploads(jobs: UploadSummary[]) {
  const container = document.getElementById("upload-jobs")!;
  container.replaceChildren();
  if (!jobs.length) { container.textContent = "暂无上传任务"; return; }
  for (const job of jobs) {
    const row = document.createElement("div");
    row.className = "upload-job";
    const text = document.createElement("p");
    text.textContent = job.total
      ? `${job.repo} · ${job.done}/${job.total} 张 · ${job.message}`
      : `${job.repo} · ${job.message}`;
    row.append(text);
    if (job.status === "failed") {
      const retry = document.createElement("button");
      retry.className = "btn-fallback";
      retry.textContent = "重试";
      retry.onclick = async () => {
        retry.disabled = true;
        try {
          const result = await browser.runtime.sendMessage({ type: "upload:retry", id: job.id });
          if (!result?.ok) throw new Error(result?.error || "重试失败");
        } catch (error) { composeStatus.textContent = error instanceof Error ? error.message : "重试失败"; retry.disabled = false; }
      };
      row.append(retry);
    }
    if (job.status === "done" && job.url.startsWith("https://github.com/")) {
      const link = document.createElement("a");
      link.href = job.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "查看仓库文件";
      row.append(link);
    }
    container.append(row);
  }
}
void browser.storage.local.get("doubao_upload_status").then((stored) => renderUploads((stored.doubao_upload_status || []) as UploadSummary[]));
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.doubao_upload_status) renderUploads((changes.doubao_upload_status.newValue || []) as UploadSummary[]);
  if (changes[CHAT_SUBMITS_KEY]) renderChatSubmits((changes[CHAT_SUBMITS_KEY].newValue || {}) as ChatSubmitMap);
});

function renderChatSubmits(map: ChatSubmitMap) {
  const el = document.getElementById("chat-submit-summary")!;
  const key = chatSubmitKey(sourceUrl);
  if (!key) {
    el.textContent = "打开豆包 /chat/数字 对话后，这里会按会话记下提交次数。";
    return;
  }
  const id = chatIdFromKey(key);
  const row = map[key];
  if (!row?.count) {
    el.textContent = `对话 ${id} · 还没提交过`;
    return;
  }
  const last = new Date(row.lastAt);
  const when = Number.isNaN(last.getTime()) ? "" : ` · 最近 ${last.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  el.textContent = `对话 ${id} · 已提交 ${row.count} 次${when}`;
}
