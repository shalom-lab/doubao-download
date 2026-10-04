import JSZip from "jszip";
import type { HdImageItem } from "./extract-hd";
import { fetchPreparedImage } from "./prepare-image";

export type ZipProgress = {
  phase: "fetch" | "zip" | "done" | "error";
  current?: number;
  total?: number;
  message: string;
};

async function mapPool<T, R>(
  list: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret = new Array<R>(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const i = cursor++;
      ret[i] = await fn(list[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, () => worker())
  );
  return ret;
}

/**
 * 并行拉取高清图 blob → 打成一个 zip → 触发一次浏览器下载。
 * 在 content script / 控制台页面上下文中运行（可跨域拉 byteimg 签名 URL）。
 */
export async function downloadImagesAsZip(options: {
  items: HdImageItem[];
  zipName: string;
  folderInsideZip?: string;
  concurrency?: number;
  convertToJpeg?: boolean;
  onProgress?: (p: ZipProgress) => void;
}): Promise<{ ok: number; fail: number; zipName: string; bytes: number }> {
  const {
    items,
    zipName,
    folderInsideZip = "images",
    concurrency = 10,
    convertToJpeg = true,
    onProgress,
  } = options;

  const log = (p: ZipProgress) => onProgress?.(p);

  log({
    phase: "fetch",
    current: 0,
    total: items.length,
    message: `并行拉取 ${items.length} 张（concurrency=${concurrency}）…`,
  });

  let done = 0;
  const fetched = await mapPool(items, concurrency, async (item) => {
    try {
      const prepared = await fetchPreparedImage(item, convertToJpeg);
      const buf = await prepared.blob.arrayBuffer();
      done += 1;
      // 进度回调降频：每完成 1 张仍更新数字，但文案别太碎也行——保持每张一次以便条走动
      log({
        phase: "fetch",
        current: done,
        total: items.length,
        message: `已拉取 ${done}/${items.length}：${prepared.name}（${(buf.byteLength / 1048576).toFixed(2)}MB）${prepared.converted ? `，JPEG 转换前 ${(prepared.originalBytes / 1048576).toFixed(2)}MB` : ""}${prepared.warning ? `，${prepared.warning}` : ""}`,
      });
      return { ok: true as const, item: { ...item, name: prepared.name }, data: buf };
    } catch (e) {
      done += 1;
      log({
        phase: "fetch",
        current: done,
        total: items.length,
        message: `失败 ${item.name}：${e instanceof Error ? e.message : String(e)}`,
      });
      return { ok: false as const, item, error: e };
    }
  });

  const okList = fetched.filter((x) => x.ok);
  const fail = fetched.length - okList.length;

  if (!okList.length) {
    log({ phase: "error", message: "全部拉取失败，无法打包" });
    throw new Error("全部拉取失败");
  }

  log({
    phase: "zip",
    message: `打包 zip（${okList.length} 张成功 / ${fail} 失败）…`,
  });

  const zip = new JSZip();
  for (const row of okList) {
    if (!row.ok) continue;
    zip.file(`${folderInsideZip}/${row.item.name}`, row.data);
  }

  let lastZipPct = -20;
  const zipBlob = await zip.generateAsync(
    { type: "blob", compression: "STORE", streamFiles: true },
    (meta) => {
      const pct = meta.percent ? Math.round(meta.percent) : 0;
      if (pct - lastZipPct >= 20 || pct >= 100) {
        lastZipPct = pct;
        log({
          phase: "zip",
          message: `打包中 ${pct}%`,
        });
      }
    }
  );

  const a = document.createElement("a");
  const obj = URL.createObjectURL(zipBlob);
  a.href = obj;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 60_000);

  log({
    phase: "done",
    message: `已触发下载 ${zipName}（${(zipBlob.size / 1048576).toFixed(1)} MB）`,
  });

  return { ok: okList.length, fail, zipName, bytes: zipBlob.size };
}
