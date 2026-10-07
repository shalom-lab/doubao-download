export const CHAT_SUBMITS_KEY = "doubao_chat_submits";
export type ChatSubmitRecord = { count: number; lastAt: string };
export type ChatSubmitMap = Record<string, ChatSubmitRecord>;

export function chatSubmitKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/^\/chat\/\d+$/.test(parsed.pathname)) return "";
    if (parsed.hostname !== "doubao.com" && !parsed.hostname.endsWith(".doubao.com")) return "";
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

export function chatIdFromKey(key: string): string {
  return key.match(/\/chat\/(\d+)$/)?.[1] || "";
}
