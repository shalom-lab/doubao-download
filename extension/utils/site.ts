/** Supported chat sites for image scan / ZIP. */

export type ChatSite = "doubao" | "chatgpt";

export function detectChatSite(href = location.href): ChatSite | null {
  try {
    const host = new URL(href).hostname.toLowerCase();
    if (host === "doubao.com" || host.endsWith(".doubao.com")) return "doubao";
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "chatgpt";
  } catch {
    /* ignore */
  }
  return null;
}

export function isSupportedChatUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "doubao.com" || host.endsWith(".doubao.com")) {
      return /\/chat\/\d+/.test(parsed.pathname);
    }
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) {
      return /^\/c\/[0-9a-f-]{16,}$/i.test(parsed.pathname);
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function chatIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "doubao.com" || host.endsWith(".doubao.com")) {
      return parsed.pathname.match(/\/chat\/(\d+)/)?.[1] ?? null;
    }
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) {
      return parsed.pathname.match(/^\/c\/([0-9a-f-]{16,})$/i)?.[1] ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}
