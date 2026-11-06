export const CHAT_SUBMITS_KEY = "doubao_chat_submits";
export type ChatSubmitRecord = { count: number; lastAt: string };
export type ChatSubmitMap = Record<string, ChatSubmitRecord>;

export function chatSubmitKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "doubao.com" || host.endsWith(".doubao.com")) {
      if (!/^\/chat\/\d+$/.test(parsed.pathname)) return "";
      return `${parsed.origin}${parsed.pathname}`;
    }
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) {
      if (!/^\/c\/[0-9a-f-]{16,}$/i.test(parsed.pathname)) return "";
      return `${parsed.origin}${parsed.pathname}`;
    }
    return "";
  } catch {
    return "";
  }
}

export function chatIdFromKey(key: string): string {
  return (
    key.match(/\/chat\/(\d+)$/)?.[1] ||
    key.match(/\/c\/([0-9a-f-]{16,})$/i)?.[1] ||
    ""
  );
}
