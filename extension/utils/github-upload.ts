export const BASE_PATH = "infoflow-data";
export const CATEGORY = "Prompts";
export type UploadInput = {
  contents: string;
  reply_words: string;
  url: string;
  images: { url: string; name: string }[];
  convertToJpeg: boolean;
};
export type GithubSettings = { repo: string; token: string; branch?: string };

export function validateInput(input: UploadInput) {
  if (!input || typeof input.contents !== "string" || typeof input.reply_words !== "string" || !Array.isArray(input.images)) throw new Error("提交内容无效");
  if (!input.contents.trim() && !input.images.length) throw new Error("请填写 contents 或至少选择一张图片");
  if (input.images.length > 200) throw new Error("单次最多上传 200 张图片");
  for (const image of input.images) {
    const url = new URL(image.url);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".byteimg.com") || url.username || url.password) throw new Error("仅支持豆包 byteimg 图片地址");
  }
  if (input.url) {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || !(url.hostname === "doubao.com" || url.hostname.endsWith(".doubao.com"))) throw new Error("来源链接必须为豆包页面");
  }
}

export function makeRecord(input: UploadInput, paths: string[], savedAt: string) {
  return { category: CATEGORY, url: input.url.trim(), content: input.contents.trim(), notes: "", reply_words: input.reply_words.trim(), image: paths[0] || "", images: paths, savedAt };
}
export function makeMarkdown(record: ReturnType<typeof makeRecord>) {
  const lines = [`# ${CATEGORY}`, ""];
  if (record.content) lines.push(`- **Category:** ${CATEGORY}`);
  lines.push(`- **Source URL:** ${record.url || "-"}`);
  if (record.image) lines.push(`- **Image:** ![](${record.image})`);
  lines.push(`- **Saved At:** ${record.savedAt}`, "");
  if (record.content) lines.push("---", "", "## Content", "", record.content, "");
  if (record.images.length > 1) lines.push("## Images", "", ...record.images.flatMap((path) => [`![](${path})`, ""]));
  if (record.reply_words) {
    if (!record.content) lines.push("---", "");
    lines.push("## Reply Words", "", record.reply_words, "");
  }
  return lines.join("\n");
}

export class GithubError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); }
}
export function validateSettings(settings: GithubSettings) {
  if (!settings || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+$/i.test(settings.repo) || !settings.token?.trim()) throw new GithubError("请先保存 GitHub 仓库和 Token", false);
}
async function request(settings: GithubSettings, path: string, init: RequestInit = {}, allowMissing = false) {
  validateSettings(settings);
  const response = await fetch(`https://api.github.com/repos/${settings.repo}${path}`, {
    ...init, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(25_000),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) {
    const limited = response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || !!response.headers.get("retry-after")));
    const hint = response.status === 401 ? "Token 无效或已过期" : response.status === 403 ? "无写入权限、分支受保护或请求受限" : response.status === 404 ? "仓库或分支不存在，或 Token 无权访问" : `HTTP ${response.status}`;
    throw new GithubError(`GitHub：${hint}`, limited || response.status >= 500 || response.status === 409);
  }
  return response.json();
}
export async function resolveBranch(settings: GithubSettings): Promise<string> {
  if (settings.branch?.trim()) return settings.branch.trim();
  const repo = await request(settings, "");
  if (!repo?.default_branch) throw new GithubError("无法读取仓库默认分支", false);
  return repo.default_branch;
}
async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export async function putGithubFile(settings: GithubSettings, branch: string, path: string, blob: Blob) {
  const endpoint = `/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const existing = await request(settings, `${endpoint}?ref=${encodeURIComponent(branch)}`, {}, true);
  await request(settings, endpoint, { method: "PUT", body: JSON.stringify({ message: `InfoFlow: ${path}`, content: await blobBase64(blob), branch, ...(existing?.sha ? { sha: existing.sha } : {}) }) });
}
