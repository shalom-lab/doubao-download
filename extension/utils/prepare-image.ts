/** Shared by ZIP downloads and background GitHub uploads. */
export const JPEG_THRESHOLD = 2 * 1024 * 1024;
export const JPEG_QUALITY = 0.9;

export type PreparedImage = {
  blob: Blob;
  name: string;
  converted: boolean;
  originalBytes: number;
  warning?: string;
};

export async function prepareImage(blob: Blob, name: string, convertToJpeg = true): Promise<PreparedImage> {
  // Detect the actual format instead of trusting names assigned during extraction.
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ext = header[0] === 0xff && header[1] === 0xd8 ? "jpg"
    : header[0] === 0x89 && header[1] === 0x50 ? "png"
    : String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP" ? "webp"
    : String.fromCharCode(...header.slice(0, 3)) === "GIF" ? "gif" : null;
  const stem = name.replace(/\.[^.]+$/, "");
  const original = { blob, name: ext ? `${stem}.${ext}` : name, converted: false, originalBytes: blob.size };
  if (!convertToJpeg || blob.size <= JPEG_THRESHOLD) return original;

  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    canvas = typeof document === "undefined" ? new OffscreenCanvas(bitmap.width, bitmap.height) : document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("无法创建图片画布");
    // JPEG cannot store transparency. Keep dimensions and use a white background.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const jpeg = canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob((result) => result?.type === "image/jpeg" ? resolve(result) : reject(new Error("JPEG 编码失败")), "image/jpeg", JPEG_QUALITY);
        });
    if (jpeg.size >= blob.size) return { ...original, warning: "JPEG 体积未减小，保留原图" };
    return { blob: jpeg, name: `${stem}.jpg`, converted: true, originalBytes: blob.size };
  } catch {
    return { ...original, warning: "JPEG 转换失败，保留原图" };
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function fetchPreparedImage(item: { url: string; name: string }, convertToJpeg = true): Promise<PreparedImage> {
  const response = await fetch(item.url, { credentials: "omit", mode: "cors", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return prepareImage(await response.blob(), item.name, convertToJpeg);
}
