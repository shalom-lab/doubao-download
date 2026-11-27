/** Extract Doubao conversation list + messages for sidepanel export. */

export type ConversationItem = {
  id: string;
  name: string;
  href: string;
  pinned?: boolean;
  updateTime?: number;
};

export type ChatMessage = {
  messageId: string;
  role: "user" | "assistant" | "unknown";
  createTime?: number;
  text: string;
  /** Assistant reply targets this user message id. */
  replyId?: string;
};

/** One user question + its assistant answer in the current conversation. */
export type PromptTurn = {
  id: string;
  index: number;
  question: string;
  answer: string;
  createTime?: number;
  questionId: string;
  answerId?: string;
};

export type PromptListResult = {
  conversationId: string;
  name: string;
  url: string;
  hasMore: boolean;
  prompts: PromptTurn[];
};

export type ConversationExport = {
  conversationId: string;
  name: string;
  url: string;
  hasMore: boolean;
  messages: ChatMessage[];
};

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  );
}

function walkFiberProps<T>(
  el: Element,
  pick: (props: Record<string, unknown>) => T | null | undefined,
  max = 60
): T | null {
  const key = fiberKey(el);
  if (!key) return null;
  let fiber = (el as any)[key];
  for (let i = 0; fiber && i < max; i++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (!props || typeof props !== "object") continue;
    const hit = pick(props as Record<string, unknown>);
    if (hit != null) return hit;
  }
  return null;
}

function roleFromUserType(userType: unknown): ChatMessage["role"] {
  if (userType === 1) return "user";
  if (userType === 2) return "assistant";
  return "unknown";
}

function textFromMessage(msg: any): string {
  if (!msg || typeof msg !== "object") return "";
  const parts: string[] = [];
  const v2 = msg.content_blocks_v2;
  if (Array.isArray(v2)) {
    for (const block of v2) {
      if (block?.block_type === 10000) {
        const text = block?.content?.text_block?.text;
        if (typeof text === "string" && text.trim()) parts.push(text.trim());
      }
    }
  }
  if (!parts.length && Array.isArray(msg.content_blocks)) {
    for (const block of msg.content_blocks) {
      if (block?.block_type === 10000) {
        const text = block?.content_obj?.text;
        if (typeof text === "string" && text.trim()) parts.push(text.trim());
      }
    }
  }
  if (!parts.length) {
    const brief = msg.brief || msg.ext?.brief;
    if (typeof brief === "string" && brief.trim()) parts.push(brief.trim());
  }
  return parts.join("\n\n");
}

function messageFromRaw(msg: any): ChatMessage | null {
  if (!msg || typeof msg !== "object") return null;
  const messageId = String(msg.message_id || msg.messageId || "").trim();
  if (!messageId) return null;
  const replyRaw = msg.reply_id ?? msg.replyId;
  const replyId =
    replyRaw != null && String(replyRaw) !== "0" ? String(replyRaw).trim() : undefined;
  return {
    messageId,
    role: roleFromUserType(msg.user_type ?? msg.userType),
    createTime: Number(msg.create_time || msg.createTime) || undefined,
    text: textFromMessage(msg),
    replyId: replyId || undefined,
  };
}

function sanitizeFilePart(raw: string, max = 48): string {
  return (
    String(raw || "")
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, max) || "chat"
  );
}

export function conversationFileStem(name: string, id: string): string {
  return `${sanitizeFilePart(name)}-${String(id || "").slice(-8) || "chat"}`;
}

/** 导出文件名：豆包-{id末段}-{对话名截断}-{条数}条 */
export function exportPromptFileStem(name: string, id: string, count: number): string {
  const idPart = String(id || "chat").replace(/[^\w.-]/g, "").slice(-12) || "chat";
  const namePart = sanitizeFilePart(name, 28);
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return `豆包-${idPart}-${namePart}-${n}条`;
}

export function messagesToMarkdown(data: ConversationExport): string {
  const lines = [
    `# ${data.name || data.conversationId}`,
    "",
    `- 会话 ID: ${data.conversationId}`,
    `- 链接: ${data.url}`,
    `- 导出时间: ${new Date().toISOString()}`,
    `- 消息数: ${data.messages.length}${data.hasMore ? "（可能仍有更早消息未加载）" : ""}`,
    "",
    "---",
    "",
  ];
  for (const msg of data.messages) {
    const who = msg.role === "user" ? "用户" : msg.role === "assistant" ? "豆包" : "未知";
    const when = msg.createTime
      ? new Date(msg.createTime * 1000).toLocaleString("zh-CN")
      : "";
    lines.push(`## ${who}${when ? ` · ${when}` : ""}`);
    lines.push("");
    lines.push(msg.text || "_(空)_");
    lines.push("");
  }
  return lines.join("\n");
}

/** Sidebar conversation list (DOM + Fiber + prefetch). */
export function listConversations(): ConversationItem[] {
  const byId = new Map<string, ConversationItem>();

  const snap =
    (window as any)._CHAT_APP_?.PREFETCHED_DATA?.chat_layout?.conversationListV2Snapshot;
  const recent = snap?.recentConversations;
  if (Array.isArray(recent)) {
    for (const row of recent) {
      const id = String(row?.conversation_id || "").trim();
      if (!id) continue;
      byId.set(id, {
        id,
        name: String(row?.name || id).trim() || id,
        href: `/chat/${id}`,
        pinned: !!row?.pinned,
        updateTime: Number(row?.update_time) || undefined,
      });
    }
  }

  for (const el of document.querySelectorAll<HTMLElement>(
    '[data-testid="conversation-list-v2-item"], a[id^="conversation_"]'
  )) {
    const fromFiber = walkFiberProps(el, (props) => {
      const c = props.conversation as any;
      if (!c || typeof c !== "object") return null;
      const id = String(c.conversationId || c.conversation_id || "").trim();
      if (!id) return null;
      return {
        id,
        name: String(c.name || c.title || id).trim() || id,
        href: `/chat/${id}`,
        pinned: !!(c.pinned || c.pinned_time),
        updateTime: Number(c.updateTime || c.update_time) || undefined,
      } satisfies ConversationItem;
    });
    if (fromFiber) {
      byId.set(fromFiber.id, { ...byId.get(fromFiber.id), ...fromFiber });
      continue;
    }
    const anchor =
      el.tagName === "A"
        ? (el as HTMLAnchorElement)
        : el.querySelector<HTMLAnchorElement>("a[id^='conversation_'], a[href^='/chat/']");
    const href = anchor?.getAttribute("href") || "";
    const id =
      anchor?.id?.replace(/^conversation_/, "") ||
      href.match(/\/chat\/(\d+)/)?.[1] ||
      "";
    if (!id) continue;
    const name =
      (el.innerText || el.textContent || "")
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .find(Boolean) || id;
    byId.set(id, {
      id,
      name,
      href: href || `/chat/${id}`,
      ...byId.get(id),
      name: byId.get(id)?.name || name,
    });
  }

  return [...byId.values()];
}

function prefetchPageData(): any | null {
  const data = (window as any)._CHAT_APP_?.PREFETCHED_DATA;
  if (!data || typeof data !== "object") return null;
  return data["chat_(id)/page"] || null;
}

function currentConversationId(): string {
  return location.pathname.match(/\/chat\/(\d+)/)?.[1] || "";
}

function messagesFromPrefetch(expectedId?: string): {
  conversationId: string;
  name: string;
  hasMore: boolean;
  messages: ChatMessage[];
} | null {
  const page = prefetchPageData();
  if (!page) return null;
  const conversationId = String(page.conversationInfo?.conversation_id || "").trim();
  const want = expectedId || currentConversationId();
  // SPA 切会话后旧 prefetch 可能残留，绝不能串台。
  if (!conversationId || (want && conversationId !== want)) return null;
  const list = page.messageList?.message_list;
  if (!Array.isArray(list)) return null;
  const messages = list
    .filter((raw: any) => String(raw?.conversation_id || conversationId) === conversationId)
    .map(messageFromRaw)
    .filter((m: ChatMessage | null): m is ChatMessage => !!m)
    .reverse();
  return {
    conversationId,
    name: String(page.conversationInfo?.name || conversationId),
    hasMore: !!page.messageList?.has_more,
    messages,
  };
}

function messagesFromDomFiber(expectedId?: string): ChatMessage[] {
  const want = expectedId || currentConversationId();
  const nodes = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-testid="send_message"], [data-testid="receive_message"]'
    ),
  ];
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const el of nodes) {
    const msg = walkFiberProps(el, (props) => {
      const m = props.message as any;
      return m && typeof m === "object" && m.message_id ? m : null;
    });
    if (want && msg?.conversation_id && String(msg.conversation_id) !== want) continue;
    const parsed = messageFromRaw(msg);
    if (!parsed || seen.has(parsed.messageId)) continue;
    // Prefer DOM text when Fiber text is empty.
    if (!parsed.text.trim()) {
      const domText = (el.innerText || "").trim();
      if (domText) parsed.text = domText;
    }
    seen.add(parsed.messageId);
    out.push(parsed);
  }
  return out;
}

/** Virtual list dataList — keeps items that were scrolled through in this session. */
function messagesFromDataList(expectedId?: string): ChatMessage[] {
  const want = expectedId || currentConversationId();
  const root =
    document.querySelector('[data-testid="message-list"]') ||
    document.querySelector('[class*="message-list"]');
  if (!root) return [];
  const key = fiberKey(root);
  if (!key) return [];
  let fiber = (root as any)[key];
  let dataList: any[] | null = null;
  for (let i = 0; fiber && i < 80; i++, fiber = fiber.return) {
    if (Array.isArray(fiber.memoizedProps?.dataList)) {
      dataList = fiber.memoizedProps.dataList;
      break;
    }
  }
  if (!dataList?.length) return [];
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const item of dataList) {
    const raw =
      item?.data?.message ||
      item?.data?.[0]?.message ||
      item?.message ||
      (item?.data && typeof item.data === "object" && item.data.message_id ? item.data : null);
    if (!raw || typeof raw !== "object") continue;
    if (want && raw.conversation_id && String(raw.conversation_id) !== want) continue;
    const parsed = messageFromRaw(raw);
    if (!parsed || seen.has(parsed.messageId)) continue;
    seen.add(parsed.messageId);
    out.push(parsed);
  }
  return out;
}

function preferMessage(prev: ChatMessage, next: ChatMessage): ChatMessage {
  return {
    ...prev,
    ...next,
    text: (next.text?.length || 0) >= (prev.text?.length || 0) ? next.text : prev.text,
    role: next.role !== "unknown" ? next.role : prev.role,
    createTime: next.createTime || prev.createTime,
    replyId: next.replyId || prev.replyId,
  };
}

function mergeMessages(primary: ChatMessage[], fallback: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of fallback) map.set(m.messageId, m);
  for (const m of primary) {
    const prev = map.get(m.messageId);
    map.set(m.messageId, prev ? preferMessage(prev, m) : m);
  }
  return [...map.values()].sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
}

/** 目之所及：按会话分袋，切换对话不互相覆盖。 */
type MessageBag = {
  conversationId: string;
  messages: Map<string, ChatMessage>;
};

type MessageBagStore = Record<string, MessageBag>;

/**
 * 挂在 window 上：
 * 1) 避免 ensureMainWorld 重注入清空模块闭包
 * 2) 多会话各存一袋，切走再切回仍在
 */
function readBagStore(): MessageBagStore {
  const w = window as unknown as {
    __DOUBAO_PROMPT_BAGS__?: MessageBagStore;
    /** 旧版单袋，迁移一次 */
    __DOUBAO_PROMPT_BAG__?: MessageBag | null;
  };
  if (!w.__DOUBAO_PROMPT_BAGS__) {
    w.__DOUBAO_PROMPT_BAGS__ = {};
    const legacy = w.__DOUBAO_PROMPT_BAG__;
    if (legacy?.conversationId) {
      w.__DOUBAO_PROMPT_BAGS__[legacy.conversationId] = legacy;
    }
  }
  return w.__DOUBAO_PROMPT_BAGS__;
}

function ensureMessageBag(conversationId: string): MessageBag {
  const store = readBagStore();
  const prev = store[conversationId];
  if (prev) return prev;
  const next: MessageBag = { conversationId, messages: new Map() };
  store[conversationId] = next;
  return next;
}

function putIntoBag(messages: ChatMessage[]) {
  const conversationId = currentConversationId();
  if (!conversationId || !messages.length) return;
  const bag = ensureMessageBag(conversationId);
  for (const m of messages) {
    if (!m?.messageId) continue;
    const prev = bag.messages.get(m.messageId);
    bag.messages.set(m.messageId, prev ? preferMessage(prev, m) : m);
  }
}

/** One-shot harvest of everything currently in the page pipeline. */
function harvestLoadedMessages(): ChatMessage[] {
  const conversationId = currentConversationId();
  const prefetch = messagesFromPrefetch(conversationId);
  const fiber = messagesFromDomFiber(conversationId);
  const fromList = messagesFromDataList(conversationId);
  return mergeMessages(fiber, mergeMessages(fromList, prefetch?.messages || []));
}

function findMessageScroller(): HTMLElement | null {
  const msg =
    document.querySelector<HTMLElement>('[data-testid="message-list"]') ||
    document.querySelector<HTMLElement>('[class*="message-list"]');
  if (!msg) return null;
  let el: HTMLElement | null = msg;
  for (let i = 0; el && i < 14; i++, el = el.parentElement) {
    const style = getComputedStyle(el);
    const scrollable =
      (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + 40;
    if (scrollable && el.clientHeight > 120) return el;
  }
  return (
    document.querySelector<HTMLElement>('[data-container-name="conversation-message-area"]') ||
    msg
  );
}

function wheelOnMessages(deltaY: number) {
  const target =
    document.querySelector<HTMLElement>('[data-testid="message-list"]') ||
    document.querySelector<HTMLElement>('[data-container-name="conversation-message-area"]') ||
    findMessageScroller();
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const clientX = Math.floor(rect.left + rect.width / 2);
  const clientY = Math.floor(rect.top + Math.min(140, Math.max(40, rect.height / 5)));
  target.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window,
    })
  );
}

/**
 * 目之所及皆入库：
 * 1) 立刻收当前管道（prefetch + Fiber + dataList）
 * 2) 轻量滚轮尝试带出更多窗口（虚拟列表不一定吃 scrollTop）
 * 3) 全程按 messageId 去重合并；用户自己滚动后再点「获取提问」会继续变多
 */
async function sweepVisibleIntoBag(maxSteps = 28) {
  const conversationId = currentConversationId();
  if (!conversationId) return;
  putIntoBag(harvestLoadedMessages());

  let stable = 0;
  let prevSize = ensureMessageBag(conversationId).messages.size;

  // 向上：往期
  for (let i = 0; i < maxSteps; i++) {
    wheelOnMessages(-1200);
    const scroller = findMessageScroller();
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 40) {
      scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(scroller.clientHeight * 0.85, 400));
    }
    await sleep(180);
    putIntoBag(harvestLoadedMessages());
    const size = ensureMessageBag(conversationId).messages.size;
    if (size === prevSize) stable += 1;
    else stable = 0;
    prevSize = size;
    if (stable >= 5) break;
  }

  stable = 0;
  prevSize = ensureMessageBag(conversationId).messages.size;
  // 向下：最新
  for (let i = 0; i < maxSteps; i++) {
    wheelOnMessages(1200);
    const scroller = findMessageScroller();
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 40) {
      scroller.scrollTop = Math.min(
        scroller.scrollHeight,
        scroller.scrollTop + Math.max(scroller.clientHeight * 0.85, 400)
      );
    }
    await sleep(160);
    putIntoBag(harvestLoadedMessages());
    const size = ensureMessageBag(conversationId).messages.size;
    if (size === prevSize) stable += 1;
    else stable = 0;
    prevSize = size;
    if (stable >= 5) break;
  }

  putIntoBag(harvestLoadedMessages());
}

function pairPrompts(messages: ChatMessage[]): PromptTurn[] {
  const assistants = messages.filter((m) => m.role === "assistant");
  const byReply = new Map<string, ChatMessage>();
  for (const a of assistants) {
    if (!a.replyId) continue;
    const prev = byReply.get(a.replyId);
    // Same question may have regenerations; prefer later, then longer.
    if (
      !prev ||
      (a.createTime || 0) > (prev.createTime || 0) ||
      ((a.createTime || 0) === (prev.createTime || 0) &&
        (a.text?.length || 0) > (prev.text?.length || 0))
    ) {
      byReply.set(a.replyId, a);
    }
  }

  const users = messages.filter((m) => m.role === "user");
  return users.map((q, index) => {
    // 只认 replyId → user.messageId 的明确匹配；缺回复就留空，禁止「下一条 assistant」错挂。
    const ans = byReply.get(q.messageId);
    return {
      id: q.messageId,
      index: index + 1,
      question: q.text || "",
      answer: ans?.text || "",
      createTime: q.createTime,
      questionId: q.messageId,
      answerId: ans?.messageId,
    };
  });
}

function promptsFromBag(): PromptListResult {
  const data = extractCurrentConversation();
  const conversationId = data.conversationId || currentConversationId();
  putIntoBag(data.messages);
  const bag = conversationId ? ensureMessageBag(conversationId) : null;
  const messages = bag
    ? [...bag.messages.values()].sort((a, b) => (a.createTime || 0) - (b.createTime || 0))
    : data.messages;
  return {
    conversationId,
    name: data.name,
    url: data.url,
    hasMore: data.hasMore,
    prompts: pairPrompts(messages),
  };
}

/** Current conversation → user prompt list (accumulated + deduped + time-sorted). */
export function listCurrentPrompts(): PromptListResult {
  putIntoBag(harvestLoadedMessages());
  const result = promptsFromBag();
  // 被 watch 调用时由 harvestFromScrollWatch 再 sync；这里不强制 bump，避免无变化刷 revision。
  return result;
}

/** 扫一遍当前能加载到的视口/管道，去重累积后返回提问列表。 */
export async function refreshCurrentPrompts(): Promise<PromptListResult> {
  await sweepVisibleIntoBag();
  const result = promptsFromBag();
  syncPromptWatchSnapshot(result);
  return result;
}

/** 清空页面消息袋；传 conversationId 只清该会话，否则清全部。 */
export function clearPromptBag(conversationId?: string) {
  const store = readBagStore();
  if (conversationId) {
    delete store[conversationId];
  } else {
    for (const key of Object.keys(store)) delete store[key];
  }
  const currentId = currentConversationId();
  const clearedCurrent = !conversationId || conversationId === currentId;
  if (clearedCurrent && promptWatch.snapshot) {
    promptWatch.revision += 1;
    promptWatch.snapshot = {
      conversationId: currentId || promptWatch.snapshot.conversationId,
      name: promptWatch.snapshot.name,
      url: promptWatch.snapshot.url,
      hasMore: true,
      prompts: [],
    };
    promptWatch.lastSig = "";
  }
}

/** 滚动自动入库：尾部防抖 + 最长等待，避免滚太快一直不刷新。 */
export type PromptWatchSnapshot = {
  revision: number;
  updatedAt: number;
  result: PromptListResult | null;
};

type PromptWatchState = {
  enabled: boolean;
  debounceMs: number;
  maxWaitMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  firstPendingAt: number;
  lastHarvestAt: number;
  lastSig: string;
  revision: number;
  snapshot: PromptListResult | null;
  onWheel: ((ev: Event) => void) | null;
  onScroll: ((ev: Event) => void) | null;
  observer: MutationObserver | null;
};

const promptWatch: PromptWatchState = {
  enabled: false,
  debounceMs: 420,
  maxWaitMs: 1100,
  timer: null,
  firstPendingAt: 0,
  lastHarvestAt: 0,
  lastSig: "",
  revision: 0,
  snapshot: null,
  onWheel: null,
  onScroll: null,
  observer: null,
};

function promptResultSig(result: PromptListResult): string {
  return [
    result.conversationId,
    result.hasMore ? "1" : "0",
    String(result.prompts.length),
    result.prompts.map((p) => `${p.id}:${p.answer.length}`).join(","),
  ].join("|");
}

function syncPromptWatchSnapshot(result: PromptListResult) {
  const sig = promptResultSig(result);
  if (sig === promptWatch.lastSig && promptWatch.snapshot) return;
  promptWatch.lastSig = sig;
  promptWatch.revision += 1;
  promptWatch.snapshot = result;
  promptWatch.lastHarvestAt = Date.now();
}

function harvestFromScrollWatch() {
  if (!promptWatch.enabled) return;
  if (!currentConversationId()) return;
  try {
    const result = listCurrentPrompts();
    syncPromptWatchSnapshot(result);
  } catch {
    // ignore transient SPA states
  }
}

function scheduleScrollHarvest() {
  if (!promptWatch.enabled) return;
  const now = Date.now();
  if (!promptWatch.firstPendingAt) promptWatch.firstPendingAt = now;

  const waited = now - promptWatch.firstPendingAt;
  if (waited >= promptWatch.maxWaitMs) {
    if (promptWatch.timer) {
      clearTimeout(promptWatch.timer);
      promptWatch.timer = null;
    }
    promptWatch.firstPendingAt = 0;
    harvestFromScrollWatch();
    return;
  }

  if (promptWatch.timer) clearTimeout(promptWatch.timer);
  const remain = Math.max(0, promptWatch.debounceMs);
  promptWatch.timer = setTimeout(() => {
    promptWatch.timer = null;
    promptWatch.firstPendingAt = 0;
    harvestFromScrollWatch();
  }, remain);
}

function isMessageAreaEvent(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-testid="message-list"]') ||
      target.closest('[data-container-name="conversation-message-area"]') ||
      target.closest('[class*="message-list"]') ||
      target.closest('[class*="v_list"]')
  );
}

/** 开启「滚动即入库」监听；侧边栏轮询 getPromptWatchSnapshot。 */
export function startPromptWatch(opts?: { debounceMs?: number; maxWaitMs?: number }): PromptWatchSnapshot {
  if (opts?.debounceMs && opts.debounceMs > 80) promptWatch.debounceMs = opts.debounceMs;
  if (opts?.maxWaitMs && opts.maxWaitMs > 200) promptWatch.maxWaitMs = opts.maxWaitMs;

  if (!promptWatch.enabled) {
    promptWatch.enabled = true;
    promptWatch.onWheel = (ev) => {
      if (!isMessageAreaEvent(ev.target)) return;
      scheduleScrollHarvest();
    };
    promptWatch.onScroll = (ev) => {
      if (!isMessageAreaEvent(ev.target)) return;
      scheduleScrollHarvest();
    };
    window.addEventListener("wheel", promptWatch.onWheel, { capture: true, passive: true });
    window.addEventListener("scroll", promptWatch.onScroll, { capture: true, passive: true });

    const root =
      document.querySelector('[data-testid="message-list"]') ||
      document.querySelector('[data-container-name="conversation-message-area"]') ||
      document.body;
    promptWatch.observer = new MutationObserver(() => scheduleScrollHarvest());
    promptWatch.observer.observe(root, { childList: true, subtree: true });
  }

  harvestFromScrollWatch();
  return getPromptWatchSnapshot();
}

export function stopPromptWatch() {
  if (!promptWatch.enabled) return;
  promptWatch.enabled = false;
  if (promptWatch.timer) {
    clearTimeout(promptWatch.timer);
    promptWatch.timer = null;
  }
  promptWatch.firstPendingAt = 0;
  if (promptWatch.onWheel) {
    window.removeEventListener("wheel", promptWatch.onWheel, true);
    promptWatch.onWheel = null;
  }
  if (promptWatch.onScroll) {
    window.removeEventListener("scroll", promptWatch.onScroll, true);
    promptWatch.onScroll = null;
  }
  promptWatch.observer?.disconnect();
  promptWatch.observer = null;
}

export function getPromptWatchSnapshot(): PromptWatchSnapshot {
  return {
    revision: promptWatch.revision,
    updatedAt: promptWatch.lastHarvestAt,
    result: promptWatch.snapshot,
  };
}

export function promptsToMarkdown(
  meta: Pick<PromptListResult, "conversationId" | "name" | "url" | "hasMore">,
  prompts: PromptTurn[]
): string {
  const lines = [
    `# ${meta.name || meta.conversationId}`,
    "",
    `- 会话 ID: ${meta.conversationId}`,
    `- 链接: ${meta.url}`,
    `- 导出时间: ${new Date().toISOString()}`,
    `- 选中提问: ${prompts.length}${meta.hasMore ? "（会话可能仍有更早消息未加载）" : ""}`,
    "",
    "---",
    "",
  ];
  prompts.forEach((p, i) => {
    const when = p.createTime
      ? new Date(p.createTime * 1000).toLocaleString("zh-CN")
      : "";
    lines.push(`## 提问 ${i + 1}${when ? ` · ${when}` : ""}`);
    lines.push("");
    lines.push("### 用户");
    lines.push("");
    lines.push(p.question || "_(空)_");
    lines.push("");
    lines.push("### 豆包");
    lines.push("");
    lines.push(p.answer || "_(暂无回复)_");
    lines.push("");
  });
  return lines.join("\n");
}

export function exportPromptsMarkdown(promptIds: string[]): {
  meta: PromptListResult;
  markdown: string;
  stem: string;
  selected: PromptTurn[];
} {
  // 导出前再收一次当前视口，避免漏掉刚滚到的内容。
  putIntoBag(harvestLoadedMessages());
  const meta = promptsFromBag();
  const want = new Set(promptIds.map(String));
  const selected = meta.prompts.filter((p) => want.has(String(p.id)));
  if (!selected.length) {
    throw new Error(
      `未匹配到选中提问（请求 ${want.size} 条，袋内 ${meta.prompts.length} 条）。请重新打开「聊天导出」后再导出。`
    );
  }
  const markdown = promptsToMarkdown(meta, selected);
  const stem = exportPromptFileStem(meta.name, meta.conversationId, selected.length);
  return { meta, markdown, stem, selected };
}

/** 用侧栏已勾选的完整问答生成 Markdown（不依赖页面袋，避免重注入丢数据）。 */
export function exportPromptTurnsMarkdown(
  meta: Pick<PromptListResult, "conversationId" | "name" | "url" | "hasMore">,
  prompts: PromptTurn[]
): { markdown: string; stem: string; selected: PromptTurn[] } {
  if (!prompts.length) throw new Error("未选中任何提问");
  const selected = prompts.slice();
  const markdown = promptsToMarkdown(meta, selected);
  const stem = exportPromptFileStem(meta.name, meta.conversationId, selected.length);
  return { markdown, stem, selected };
}

/**
 * 合并两份提问列表（按 id 去重，再按时间排序重编号）。
 * 回复规则：只有明确 answerId 匹配才写入/更新正文；缺匹配留空。
 * 新到的明确匹配整份覆盖（answerId + answer 一起换），不再按「更长」保留错挂正文。
 */
export function mergePromptTurns(base: PromptTurn[], incoming: PromptTurn[]): PromptTurn[] {
  const map = new Map<string, PromptTurn>();
  const prefer = (a: PromptTurn, b: PromptTurn): PromptTurn => {
    const question =
      (b.question?.length || 0) >= (a.question?.length || 0) ? b.question : a.question;
    const createTime =
      a.createTime && b.createTime
        ? Math.min(a.createTime, b.createTime)
        : a.createTime || b.createTime;

    let answer = "";
    let answerId: string | undefined;
    if (b.answerId) {
      // 本次收获已有明确匹配：整份采用（允许比缓存更短）
      answer = b.answer || "";
      answerId = b.answerId;
    } else if (a.answerId) {
      // 本次视口未带回回复：保留此前已确认的匹配
      answer = a.answer || "";
      answerId = a.answerId;
    }

    return {
      ...a,
      ...b,
      question,
      answer,
      createTime,
      questionId: b.questionId || a.questionId,
      answerId,
    };
  };
  for (const p of base) {
    if (!p?.id) continue;
    map.set(String(p.id), p);
  }
  for (const p of incoming) {
    if (!p?.id) continue;
    const id = String(p.id);
    const prev = map.get(id);
    map.set(id, prev ? prefer(prev, p) : p);
  }
  return [...map.values()]
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0))
    .map((p, i) => ({ ...p, index: i + 1, id: String(p.id) }));
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Scroll virtual message list to encourage hydration of more nodes. */
async function nudgeMessageListScroll() {
  const list =
    document.querySelector<HTMLElement>('[data-testid="message-list"]') ||
    document.querySelector<HTMLElement>('[class*="message-list"]');
  if (!list) return;
  const scroller =
    (list.closest("[style*='overflow']") as HTMLElement | null) ||
    (document.querySelector(
      '[data-container-name="conversation-message-area"]'
    ) as HTMLElement | null) ||
    list;
  const top = scroller.scrollTop;
  scroller.scrollTop = 0;
  await sleep(120);
  scroller.scrollTop = scroller.scrollHeight;
  await sleep(180);
  scroller.scrollTop = top;
  await sleep(80);
}

function nameFromSidebar(conversationId: string): string {
  if (!conversationId) return "";
  const hit = listConversations().find((c) => c.id === conversationId);
  return hit?.name || "";
}

export function extractCurrentConversation(): ConversationExport {
  const conversationId = currentConversationId();
  const prefetch = messagesFromPrefetch(conversationId);
  const harvested = harvestLoadedMessages();
  const headerName =
    document
      .querySelector('[data-testid="editable_conversation_name"]')
      ?.textContent?.trim() || "";
  const name =
    (prefetch?.conversationId === conversationId ? prefetch?.name : "") ||
    headerName ||
    nameFromSidebar(conversationId) ||
    conversationId ||
    "未命名对话";
  putIntoBag(harvested);
  const bag = conversationId ? ensureMessageBag(conversationId) : null;
  const messages = bag
    ? [...bag.messages.values()].sort((a, b) => (a.createTime || 0) - (b.createTime || 0))
    : harvested;
  return {
    conversationId,
    name,
    url: location.href,
    hasMore: !!prefetch?.hasMore,
    messages,
  };
}

function pageReadyForConversation(id: string): boolean {
  if (location.pathname !== `/chat/${id}`) return false;
  const page = prefetchPageData();
  if (
    page &&
    String(page.conversationInfo?.conversation_id || "") === id &&
    Array.isArray(page.messageList?.message_list)
  ) {
    return true;
  }
  // Fiber DOM for this conversation also counts as ready.
  const nodes = document.querySelectorAll(
    '[data-testid="send_message"], [data-testid="receive_message"]'
  );
  if (!nodes.length) return false;
  for (const el of nodes) {
    const msg = walkFiberProps(el as Element, (props) => {
      const m = props.message as any;
      return m && typeof m === "object" && m.message_id ? m : null;
    });
    if (msg && String(msg.conversation_id || id) === id) return true;
  }
  return false;
}

function queryConversationLink(id: string): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`a#conversation_${id}`) ||
    document.querySelector<HTMLElement>(`a[href="/chat/${id}"]`) ||
    document.querySelector<HTMLElement>(
      `[data-testid="conversation-list-v2-item"][href="/chat/${id}"]`
    ) ||
    document.querySelector<HTMLElement>(
      `[data-testid="conversation-list-v2-item"] a[href="/chat/${id}"]`
    )
  );
}

async function findConversationLink(id: string): Promise<HTMLElement | null> {
  const direct = queryConversationLink(id);
  if (direct) return direct;

  const scroller =
    document.querySelector<HTMLElement>('[data-testid="chat_list_wrapper"]') ||
    document.querySelector<HTMLElement>('[data-testid="flow_chat_sidebar"]') ||
    document.querySelector<HTMLElement>('nav.panel-fvxXfj') ||
    document.querySelector<HTMLElement>('[class*="sidebar"]');
  if (!scroller) return null;

  const maxSteps = 24;
  for (let i = 0; i < maxSteps; i++) {
    scroller.scrollTop = Math.min(
      scroller.scrollHeight,
      scroller.scrollTop + Math.max(240, scroller.clientHeight * 0.85)
    );
    await sleep(120);
    const hit = queryConversationLink(id);
    if (hit) {
      hit.scrollIntoView({ block: "nearest" });
      return hit;
    }
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8) break;
  }

  // Try from top once more for items above current viewport.
  scroller.scrollTop = 0;
  await sleep(120);
  for (let i = 0; i < maxSteps; i++) {
    const hit = queryConversationLink(id);
    if (hit) {
      hit.scrollIntoView({ block: "nearest" });
      return hit;
    }
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.min(
      scroller.scrollHeight,
      scroller.scrollTop + Math.max(240, scroller.clientHeight * 0.85)
    );
    await sleep(120);
    if (scroller.scrollTop === before) break;
  }
  return queryConversationLink(id);
}

export async function openConversation(conversationId: string, timeoutMs = 20000) {
  const id = String(conversationId || "").trim();
  if (!id) throw new Error("缺少会话 ID");
  if (pageReadyForConversation(id)) return;

  if (location.pathname !== `/chat/${id}`) {
    const link = await findConversationLink(id);
    if (link) {
      link.click();
    } else {
      // Last resort: SPA-friendly path change. Avoid full reload when possible.
      history.pushState({}, "", `/chat/${id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      // If the app ignores pushState, fall back to assign.
      await sleep(400);
      if (location.pathname !== `/chat/${id}`) {
        location.assign(`https://www.doubao.com/chat/${id}`);
      }
    }
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pageReadyForConversation(id)) {
      await sleep(250);
      return;
    }
    await sleep(200);
  }
  // Soft success: URL matched even if hydration lags; extract will use whatever is available.
  if (location.pathname === `/chat/${id}`) return;
  throw new Error(`打开会话超时：${id}`);
}

export async function exportConversation(
  conversationId: string
): Promise<ConversationExport> {
  await openConversation(conversationId);
  await nudgeMessageListScroll();
  await sleep(250);
  let data = extractCurrentConversation();
  if (!data.conversationId) data.conversationId = conversationId;
  // One retry if SPA title/messages still settling.
  if (!data.messages.length || data.conversationId !== conversationId) {
    await sleep(600);
    data = extractCurrentConversation();
    if (!data.conversationId) data.conversationId = conversationId;
  }
  if (data.conversationId && data.conversationId !== conversationId) {
    throw new Error(
      `会话串台：期望 ${conversationId}，实际 ${data.conversationId}。请刷新页面后重试。`
    );
  }
  if (!data.messages.length) {
    throw new Error(`会话 ${conversationId} 未读到消息，请打开该对话后再试`);
  }
  return data;
}
