/**
 * 通用提取：只收「当前对话」里的高清生成图。
 * 提速策略：优先扫 <img>（最快）→ 仅「保存」按钮 Fiber 补 raw → 找不到才加重扫描。
 */

export type Quality = "raw" | "dld" | "cpreview";

export type HdImageItem = {
  index: number;
  id: string;
  url: string;
  name: string;
};

const BYTEIMG_TPLV_RE =
  /https:\/\/[^"'\\\s]*byteimg\.com\/[^"'\\\s]+~tplv-[^"'\\\s]+/gi;

const NOISE_RE =
  /image-qvalue|\/icon\/|passport|user-avatar|avatar|favicon|emoji|sticker/i;

type VariantMap = Map<string, Partial<Record<Quality, string>>>;

export function sanitizePrefix(raw: string): string {
  const s = String(raw || "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s.slice(0, 64) || "0001";
}

export function getCurrentChatId(): string | null {
  const m = location.pathname.match(/\/chat\/(\d+)/);
  return m ? m[1] : null;
}

export function fileIdFromUrl(u: string): string | null {
  const clean = String(u).split("?")[0];
  const m = clean.match(
    /\/([a-f0-9][a-f0-9._-]{7,}\.(?:jpg|jpeg|png|webp))(?:~|$)/i
  );
  return m ? m[1] : null;
}

function normalizeUrl(raw: string): string {
  return raw.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
}

function classifyQuality(u: string): Quality | null {
  if (!u || NOISE_RE.test(u) || /\.heic(\?|$)/i.test(u)) return null;
  if (!/byteimg\.com/i.test(u) || !/~tplv-/i.test(u)) return null;
  if (/image_raw(_b)?\.(png|jpe?g)/i.test(u)) return "raw";
  if (/(image_dld_watermark[^~?]*|cdld_wm\d+)\.(png|jpe?g)/i.test(u))
    return "dld";
  if (/cpreview_wm\d+\.(png|jpe?g)/i.test(u)) return "cpreview";
  return null;
}

function scoreVariant(u: string, q: Quality): number {
  let s = 0;
  if (/\.png(\?|$)/i.test(u)) s += 10;
  if (/\.jpe?g(\?|$)/i.test(u)) s += 4;
  if (q === "cpreview") {
    if (/cpreview_wm0/i.test(u)) s += 8;
    else if (/cpreview_wm1/i.test(u)) s += 2;
  }
  if (q === "raw" && /image_raw(_b)?\.png/i.test(u)) s += 6;
  if (q === "dld" && /cdld_wm|image_dld/i.test(u) && /\.png/i.test(u)) s += 6;
  return s;
}

function putVariant(bag: VariantMap, u: string) {
  const q = classifyQuality(u);
  if (!q) return;
  const id = fileIdFromUrl(u);
  if (!id) return;
  const row = bag.get(id) || {};
  const prev = row[q];
  if (!prev || scoreVariant(u, q) > scoreVariant(prev, q)) {
    row[q] = u;
    bag.set(id, row);
  }
}

function harvestString(s: string | null | undefined, bag: VariantMap) {
  if (!s || typeof s !== "string" || s.length > 2_000_000) return;
  if (!/byteimg\.com/i.test(s) || !/~tplv-/i.test(s)) return;
  BYTEIMG_TPLV_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BYTEIMG_TPLV_RE.exec(s))) {
    const u = normalizeUrl(m[0]);
    if (!u.includes("doubao.com/chat")) putVariant(bag, u);
  }
}

function findReactFiber(el: Element): any | null {
  const key = Object.keys(el).find(
    (k) =>
      k.startsWith("__reactFiber$") ||
      k.startsWith("__reactInternalInstance$")
  );
  return key ? (el as any)[key] : null;
}

function safeJson(value: unknown, maxLen = 120_000): string | null {
  try {
    const s = JSON.stringify(value);
    if (!s) return null;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return null;
  }
}

function walkFiber(start: any, bag: VariantMap, maxSteps = 80) {
  let fiber = start;
  let steps = 0;
  while (fiber && steps < maxSteps) {
    steps += 1;
    const s = safeJson(fiber.memoizedProps);
    if (s) harvestString(s, bag);
    fiber = fiber.return;
  }
}

function isSidebarConversationLink(el: Element): boolean {
  return !!el.closest('a[id^="conversation_"]');
}

function getMessageList(): Element | null {
  return document.querySelector('[class*="message-list"]');
}

/** 最快路径：只收当前消息区 / 预览里的 <img> */
function harvestImgsFast(bag: VariantMap) {
  const roots: Element[] = [];
  const msg = getMessageList();
  if (msg) roots.push(msg);
  else {
    const main = document.querySelector("main");
    if (main) roots.push(main);
  }
  for (const el of document.querySelectorAll('[role="dialog"]')) {
    roots.push(el);
  }

  const seen = new Set<Element>();
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    for (const img of root.querySelectorAll("img")) {
      if (isSidebarConversationLink(img)) continue;
      const el = img as HTMLImageElement;
      harvestString(el.currentSrc || el.src, bag);
      const srcset = el.getAttribute("srcset");
      if (srcset) harvestString(srcset, bag);
    }
  }
}

/** 只从「保存」按钮往上抠 raw/dld（比全树 BFS 快一个数量级） */
function harvestSaveButtonFiber(bag: VariantMap) {
  const btns = document.querySelectorAll("button");
  let n = 0;
  for (const btn of btns) {
    if (isSidebarConversationLink(btn)) continue;
    const t = (btn.textContent || "").trim();
    if (!(t === "保存" || t.includes("保存"))) continue;
    const fiber = findReactFiber(btn);
    if (fiber) walkFiber(fiber, bag, 100);
    n += 1;
    if (n >= 3) break; // 够了
  }
}

/** 兜底：轻量 Fiber BFS（仅消息列表，且仅在 img 一条都没有时） */
async function bfsFiberLight(
  rootEl: Element,
  bag: VariantMap,
  maxVisit = 800,
  onVisit?: (visited: number) => void | Promise<void>
) {
  const rootFiber = findReactFiber(rootEl);
  if (!rootFiber) return;
  const queue: any[] = [rootFiber];
  const seen = new Set<any>();
  let visited = 0;
  while (queue.length && visited < maxVisit) {
    const f = queue.shift();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    visited += 1;
    const s = safeJson(f.memoizedProps, 80_000);
    if (s && /byteimg\.com/i.test(s)) harvestString(s, bag);
    if (f.child) queue.push(f.child);
    if (f.sibling) queue.push(f.sibling);
    if (onVisit && visited % 100 === 0) await onVisit(visited);
  }
}

const BEST_ORDER: Quality[] = ["raw", "dld", "cpreview"];

function pickBestUrl(
  variants: Partial<Record<Quality, string>>
): { url: string; used: Quality } | null {
  for (const q of BEST_ORDER) {
    const u = variants[q];
    if (u) return { url: u, used: q };
  }
  return null;
}

function bagToItems(bag: VariantMap, safePrefix: string): HdImageItem[] {
  const items: HdImageItem[] = [];
  for (const [id, variants] of bag.entries()) {
    const picked = pickBestUrl(variants);
    if (!picked) continue;
    items.push({
      index: items.length + 1,
      id,
      url: picked.url,
      name: `${safePrefix}-${String(items.length + 1).padStart(2, "0")}.png`,
    });
  }
  return items;
}

function yieldMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export type ExtractProgressTick = {
  message: string;
  found: number;
  percent: number;
};

/**
 * 快速提取当前会话高清图。
 */
export async function extractHdImages(
  prefix = "0001",
  onTick?: (t: ExtractProgressTick) => void
): Promise<HdImageItem[]> {
  const safePrefix = sanitizePrefix(prefix);
  const chatId = getCurrentChatId();
  const bag: VariantMap = new Map();
  const tick = (message: string, percent: number) =>
    onTick?.({ message, found: bag.size, percent });

  console.log(`[doubao-hd] 限定当前会话 chatId=${chatId || "?"}`);

  tick("快速扫描图片…", 20);
  harvestImgsFast(bag);
  await yieldMain();

  // 有预览「保存」时补 raw（成本低、收益高）
  tick(`已见 ${bag.size} 张，补全高清链接…`, 55);
  harvestSaveButtonFiber(bag);
  await yieldMain();

  // 只有一张都没有时才走慢路径
  if (bag.size === 0) {
    const msg = getMessageList();
    if (msg) {
      tick("深度扫描消息区…", 70);
      try {
        const html = msg.innerHTML;
        harvestString(html.length > 800_000 ? html.slice(0, 800_000) : html, bag);
      } catch {
        /* ignore */
      }
      await yieldMain();
      if (bag.size === 0) {
        await bfsFiberLight(msg, bag, 800, async () => {
          tick(`深度扫描中…`, 85);
          await yieldMain();
        });
      }
    }
  }

  const items = bagToItems(bag, safePrefix);
  tick(items.length ? `找到 ${items.length} 张` : "未找到大图", 100);
  console.log(`[doubao-hd] chatId=${chatId || "?"} 检出 ${items.length} 张`);
  return items;
}
