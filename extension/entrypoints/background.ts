import { BASE_PATH, CATEGORY, GithubError, makeMarkdown, makeRecord, putGithubFile, resolveBranch, validateInput, validateSettings, type GithubSettings, type UploadInput } from "../utils/github-upload";
import { fetchPreparedImage } from "../utils/prepare-image";
import { deleteFile, deleteJob, getFile, listJobs, saveFile, saveJob, type UploadJob } from "../utils/upload-store";

export default defineBackground(() => {
  let processing = false;
  let mutations = Promise.resolve();
  const alarmName = "doubao-upload-retry";
  const KEEP_DONE = 10;

  async function publish() {
    let jobs = await listJobs();
    const extraDone = jobs.filter((job) => job.status === "done").sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(KEEP_DONE);
    for (const job of extraDone) {
      for (const file of job.files) await deleteFile(file.key).catch(() => {});
      await deleteJob(job.id);
    }
    if (extraDone.length) jobs = await listJobs();
    const summaries = jobs.sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map((job) => {
      const imageTotal = job.input.images.length;
      const imageDone = job.files.filter((file) => file.key.includes(":image:") && file.uploaded).length;
      return {
        id: job.id, repo: job.repo, branch: job.branch, status: job.status, message: job.message,
        done: job.status === "done" ? imageTotal : imageDone,
        total: imageTotal,
        url: job.status === "done" ? `https://github.com/${job.repo}/blob/${encodeURIComponent(job.branch)}/${BASE_PATH}/${CATEGORY}/${job.id}.md` : "",
      };
    });
    await browser.storage.local.set({ doubao_upload_status: summaries });
    const pending = jobs.filter((job) => job.status !== "done");
    await browser.action.setBadgeText({ text: pending.length ? String(pending.length) : "" });
    await browser.action.setBadgeBackgroundColor({ color: pending.some((job) => job.status === "failed") ? "#a33b2b" : "#c45c26" });
  }
  async function persist(job: UploadJob, message: string) {
    job.message = message;
    await saveJob(job);
    await publish();
  }
  async function settingsFor(job: UploadJob) {
    const stored = await browser.storage.local.get("doubao_github_settings");
    const settings = stored.doubao_github_settings as GithubSettings;
    validateSettings(settings);
    if (settings.repo !== job.repo) throw new GithubError(`任务目标为 ${job.repo}，请恢复该仓库设置后重试`, false);
    return settings;
  }
  async function runJob(job: UploadJob) {
    job.status = "running";
    job.attempts++;
    await persist(job, job.prepared ? "本地文件已就绪，等待上传…" : "任务已保存，正在缓存图片到本地…");
    try {
      if (!job.prepared) {
        for (let index = 0; index < job.input.images.length; index++) {
          const key = `${job.id}:image:${index}`;
          if (job.files.some((file) => file.key === key) && await getFile(key)) continue;
          await persist(job, `缓存图片到本地 ${index + 1}/${job.input.images.length}…`);
          const image = job.input.images[index]!;
          const prepared = await fetchPreparedImage({ url: image.url, name: `${job.id}-${index}.png` }, job.input.convertToJpeg);
          if (prepared.blob.size > 95 * 1024 * 1024) throw new GithubError(`第 ${index + 1} 张图片过大，请移除后重新提交`, false);
          await saveFile(key, prepared.blob);
          const file = { path: `${BASE_PATH}/Images/${CATEGORY}/${prepared.name}`, key, uploaded: false };
          const old = job.files.findIndex((row) => row.key === key);
          if (old >= 0) job.files[old] = file; else job.files.push(file);
          await persist(job, prepared.warning || `已缓存图片 ${index + 1}/${job.input.images.length}`);
        }
        const paths = job.files.filter((file) => file.key.includes(":image:")).map((file) => `../Images/${CATEGORY}/${file.path.split("/").pop()}`);
        const record = makeRecord(job.input, paths, job.savedAt);
        for (const [ext, content] of [["json", JSON.stringify(record, null, 2)], ["md", makeMarkdown(record)]] as const) {
          const key = `${job.id}:${ext}`;
          await saveFile(key, new Blob([content], { type: "text/plain;charset=utf-8" }));
          if (!job.files.some((file) => file.key === key)) job.files.push({ path: `${BASE_PATH}/${CATEGORY}/${job.id}.${ext}`, key, uploaded: false });
        }
        job.prepared = true;
        await saveJob(job);
      }
      await persist(job, "图片和内容已保存本地，正在连接 GitHub…");
      const settings = await settingsFor(job);
      if (!job.branch) {
        job.branch = await resolveBranch({ ...settings, branch: "" });
        await saveJob(job); // Pin default branch before the first file write.
      }
      // Keep writes sequential: concurrent Contents API writes may conflict.
      const imageTotal = job.input.images.length;
      for (const file of job.files) {
        if (file.uploaded) continue;
        const blob = await getFile(file.key);
        if (!blob) throw new GithubError("本地图片缓存缺失，请重新采集后提交", false);
        const isImage = file.key.includes(":image:");
        await persist(job, isImage
          ? `上传图片 ${job.files.filter((row) => row.key.includes(":image:") && row.uploaded).length + 1}/${imageTotal}`
          : `上传 ${file.path.split("/").pop()}`);
        await putGithubFile(settings, job.branch, file.path, blob);
        file.uploaded = true;
        await saveJob(job);
      }
      job.status = "done";
      await persist(job, imageTotal ? "上传完成" : "上传完成（无图片）");
      for (const file of job.files) await deleteFile(file.key).catch(() => {});
    } catch (error) {
      const retryable = !(error instanceof GithubError) || error.retryable;
      job.status = retryable && job.attempts < 3 ? "queued" : "failed";
      job.nextAttempt = Date.now() + job.attempts * 60_000;
      // Avoid echoing server responses or signed image URLs into UI or logs.
      const message = error instanceof GithubError ? error.message : "网络、图片读取或本地缓存失败";
      await persist(job, `${message}。${job.status === "queued" ? "稍后自动重试" : "请检查设置或网络后重试"}`);
    }
  }
  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      while (true) {
        const jobs = await listJobs();
        const job = jobs.find((row) => row.status === "running" || (row.status === "queued" && row.nextAttempt <= Date.now()));
        if (!job) break;
        await runJob(job);
      }
    } finally { processing = false; }
  }
  const kick = () => { void processQueue().catch(() => browser.action.setBadgeText({ text: "!" })); };
  async function ensureAlarm() {
    if (!await browser.alarms.get(alarmName)) await browser.alarms.create(alarmName, { periodInMinutes: 1 });
  }
  async function enqueue(input: UploadInput) {
    validateInput(input);
    const stored = await browser.storage.local.get("doubao_github_settings");
    const settings = stored.doubao_github_settings as GithubSettings;
    validateSettings(settings);
    const normalized = { ...input, contents: input.contents.trim(), reply_words: input.reply_words.trim(), url: input.url.trim(), convertToJpeg: input.convertToJpeg !== false };
    const bytes = new TextEncoder().encode(JSON.stringify({ input: normalized, repo: settings.repo, branch: settings.branch || "" }));
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
    const existing = (await listJobs()).find((job) => job.fingerprint === fingerprint);
    if (existing) return { id: existing.id, existing: true, status: existing.status };
    const savedAt = new Date().toISOString();
    const id = `${savedAt.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const job: UploadJob = { id, fingerprint, repo: settings.repo, branch: settings.branch?.trim() || "", input: normalized, savedAt, files: [], prepared: false, attempts: 0, nextAttempt: 0, status: "queued", message: "任务已保存本地，等待缓存和上传" };
    await saveJob(job);
    await publish();
    return { id, existing: false, status: job.status };
  }
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== browser.runtime.id || sender.url?.split("?")[0] !== browser.runtime.getURL("/sidepanel.html")) return;
    if (!message || !["upload:enqueue", "upload:retry"].includes(message.type)) return;
    // Serialize enqueue operations to prevent double-clicks creating duplicate jobs.
    mutations = mutations.catch(() => {}).then(async () => {
      try {
        await ensureAlarm();
        let result;
        if (message.type === "upload:enqueue") result = await enqueue(message.input);
        else {
          const job = (await listJobs()).find((row) => row.id === message.id);
          if (!job || job.status !== "failed") throw new Error("该任务当前不能重试");
          job.status = "queued"; job.attempts = 0; job.nextAttempt = 0;
          await persist(job, "等待重试…");
          result = { id: job.id };
        }
        respond({ ok: true, ...result });
        kick();
      } catch (error) {
        respond({ ok: false, error: error instanceof Error ? error.message : "无法保存上传任务" });
      }
    });
    return true;
  });
  browser.alarms.onAlarm.addListener((alarm) => { if (alarm.name === alarmName) kick(); });
  browser.runtime.onStartup.addListener(() => { void ensureAlarm().then(kick); });
  browser.runtime.onInstalled.addListener(() => { void ensureAlarm().then(kick); });
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Restrict credentials to extension pages and the service worker.
  void browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void ensureAlarm().then(kick);
});
