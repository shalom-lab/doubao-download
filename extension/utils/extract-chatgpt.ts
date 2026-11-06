/**
 * ChatGPT 网页版：从当前对话 React 状态抽出生成图，并解析为可拉取的 estuary HTTPS。
 *
 * 链路（CDP 实测）：
 * 1. Fiber 上 images[]：src = sediment://file_…，含标题 / 尺寸
 * 2. imageAssetResolver.resolveAsset("file_…") →
 *    GET /backend-api/files/download/file_…?conversation_id=…
 *    → { downloadUrl: /backend-api/estuary/content?id=file_…&sig=… }
 * 3. fetch(estuaryUrl) 需带站点 cookie（credentials: include）
 *
 * SPA 切会话时 URL 会先变、Fiber 仍短暂保留上一会话的 images[]，
 * 因此必须校验 conversationId 与地址栏一致，并短轮询等待新会话就绪。
 */

import type { ExtractProgressTick, HdImageItem } from "./extract-hd";
import { sanitizePrefix } from "./extract-hd";

type ChatGptImage = {
  id?: string;
  src?: string;
  chatGptDisplayTitle?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  status?: string;
  type?: string;
};

type AssetResolver = {
  resolveAsset?: (fileId: string) => Promise<{
    kind?: string;
    downloadUrl?: string;
    requestHeaders?: Record<string, string>;
  }>;
};

type ImagePack = {
  images: ChatGptImage[];
  resolver: AssetResolver | null;
  conversationId: string | null;
};

function findReactFiber(el: Element): any | null {
  const key = Object.keys(el).find(
    (k) =>
      k.startsWith("__reactFiber$") ||
      k.startsWith("__reactInternalInstance$")
  );
  return key ? (el as any)[key] : null;
}

function fileIdFromSediment(src: string | undefined): string | null {
  if (!src) return null;
  const m = String(src).match(/^(?:sediment:\/\/)?(file_[0-9a-f]+)/i);
  return m?.[1] ?? null;
}

function walkFiberProps(
  start: any,
  pred: (props: Record<string, unknown>) => boolean,
  max = 80
): Record<string, unknown> | null {
  let fiber = start;
  let steps = 0;
  while (fiber && steps < max) {
    steps += 1;
    const props = fiber.memoizedProps;
    if (props && typeof props === "object" && pred(props as Record<string, unknown>)) {
      return props as Record<string, unknown>;
    }
    fiber = fiber.return;
  }
  return null;
}

function normalizeConversationId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/([0-9a-f-]{16,})/i);
  return m?.[1]?.toLowerCase() ?? null;
}

export function getChatGptConversationId(): string | null {
  const m = location.pathname.match(/^\/c\/([0-9a-f-]{16,})$/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function packMatchesChat(pack: ImagePack, chatId: string | null): boolean {
  if (!chatId) return false;
  const packId = normalizeConversationId(pack.conversationId);
  return !!packId && packId === chatId;
}

function collectImagePacks(): ImagePack[] {
  const roots: Element[] = [];
  const preview = document.querySelector('[data-testid="generated-image-preview"]');
  if (preview) roots.push(preview);
  for (const btn of document.querySelectorAll(
    'button[aria-label^="Generated image"], button[aria-label^="Show generated image"]'
  )) {
    roots.push(btn);
  }
  const main = document.querySelector("main");
  if (main) roots.push(main);

  const packs: ImagePack[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    const fiber = findReactFiber(root);
    if (!fiber) continue;
    const packProps = walkFiberProps(
      fiber,
      (p) => Array.isArray(p.images) && (p.images as unknown[]).length > 0
    );
    if (!packProps) continue;

    const images = (packProps.images as ChatGptImage[]).filter(
      (item) =>
        item &&
        (item.type === "generated-image" || !!fileIdFromSediment(item.src)) &&
        item.status !== "pending"
    );
    if (!images.length) continue;

    const conversationId =
      typeof packProps.conversationId === "string" ? packProps.conversationId : null;
    const key = `${normalizeConversationId(conversationId) || "?"}::${images
      .map((item) => fileIdFromSediment(item.src) || item.id || "")
      .join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    packs.push({
      images,
      resolver: (packProps.imageAssetResolver as AssetResolver) || null,
      conversationId,
    });
  }
  return packs;
}

function findImagePackForChat(chatId: string | null): {
  pack: ImagePack | null;
  stale: boolean;
} {
  const packs = collectImagePacks();
  if (!packs.length) return { pack: null, stale: false };
  const matched = packs.find((pack) => packMatchesChat(pack, chatId));
  if (matched) return { pack: matched, stale: false };
  // 有图但 conversationId 对不上：多半是上一会话残留，不能当本会话结果
  return { pack: null, stale: true };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 提取当前 ChatGPT 对话生成图（estuary HTTPS，可供侧边栏预览与 ZIP）。
 */
export async function extractChatGptImages(
  prefix = "0001",
  onTick?: (t: ExtractProgressTick) => void
): Promise<HdImageItem[]> {
  const safePrefix = sanitizePrefix(prefix);
  const expectedChatId = getChatGptConversationId();
  const tick = (message: string, percent: number, found = 0) =>
    onTick?.({ message, found, percent });

  console.log(`[chatgpt-hd] conversation=${expectedChatId || "?"}`);
  tick("扫描 ChatGPT 生成图…", 15);

  let pack: ImagePack | null = null;
  const deadline = Date.now() + 8_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const liveId = getChatGptConversationId();
    if (expectedChatId && liveId && liveId !== expectedChatId) {
      // 用户又切走了，停止用旧期望 id 扫
      tick("对话已切换，停止扫描", 100, 0);
      return [];
    }
    const found = findImagePackForChat(liveId || expectedChatId);
    if (found.pack) {
      pack = found.pack;
      break;
    }
    tick(
      found.stale
        ? "等待新对话图片加载（忽略上一会话残留）…"
        : "等待对话图片出现…",
      Math.min(55, 15 + attempt * 4),
      0
    );
    await sleep(350);
  }

  if (!pack?.images.length) {
    tick("未找到当前对话的生成图", 100, 0);
    return [];
  }

  const chatId = normalizeConversationId(pack.conversationId) || expectedChatId;
  tick(`发现 ${pack.images.length} 张，解析下载地址…`, 40, pack.images.length);
  const resolver = pack.resolver?.resolveAsset?.bind(pack.resolver);
  const items: HdImageItem[] = [];

  for (let i = 0; i < pack.images.length; i += 1) {
    const liveId = getChatGptConversationId();
    if (chatId && liveId && liveId !== chatId) {
      tick("对话已切换，丢弃未完成结果", 100, 0);
      return [];
    }

    const image = pack.images[i]!;
    const fileId = fileIdFromSediment(image.src);
    if (!fileId) continue;

    let url = "";
    if (resolver) {
      try {
        const resolved = await resolver(fileId);
        if (resolved?.downloadUrl) url = resolved.downloadUrl;
      } catch (e) {
        console.warn(`[chatgpt-hd] resolveAsset failed ${fileId}`, e);
      }
    }
    if (!url) continue;

    items.push({
      index: items.length + 1,
      id: fileId,
      url,
      name: `${safePrefix}-${String(items.length + 1).padStart(2, "0")}.png`,
    });

    const pct = 40 + Math.round(((i + 1) / pack.images.length) * 55);
    tick(`已解析 ${items.length}/${pack.images.length}`, pct, items.length);
  }

  tick(items.length ? `找到 ${items.length} 张` : "未解析到可下载地址", 100, items.length);
  console.log(`[chatgpt-hd] conversation=${chatId || "?"} 检出 ${items.length} 张`);
  return items;
}
