/**
 * 豆包下载 · 通用控制台脚本（实验）
 * 只收当前 /chat/{id} 会话消息区里的高清图（自动最清晰 raw→dld→cpreview）
 *
 * 用法：打开目标对话 → 点开大图预览 → F12 Console → 整段粘贴回车
 */
(async function doubaoZipDownloadHd() {
  const PREFIX = "0001";
  const CONVERT_TO_JPEG = true;
  const CONCURRENCY = 6;
  const TAG = "[doubao-hd]";
  const chatId = (location.pathname.match(/\/chat\/(\d+)/) || [])[1] || null;

  console.log(`${TAG} start`, { PREFIX, CONCURRENCY, chatId, href: location.href });

  const BYTEIMG_TPLV_RE =
    /https:\/\/[^"'\\\s]*byteimg\.com\/[^"'\\\s]+~tplv-[^"'\\\s]+/gi;
  const NOISE_RE =
    /image-qvalue|\/icon\/|passport|user-avatar|avatar|favicon|emoji|sticker/i;

  function fileIdFromUrl(u) {
    const clean = String(u).split("?")[0];
    const m = clean.match(/\/([a-f0-9][a-f0-9._-]{7,}\.(?:jpg|jpeg|png|webp))(?:~|$)/i);
    return m ? m[1] : null;
  }
  function normalizeUrl(raw) {
    return raw.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  }
  function classifyQuality(u) {
    if (!u || NOISE_RE.test(u) || /\.heic(\?|$)/i.test(u)) return null;
    if (!/byteimg\.com/i.test(u) || !/~tplv-/i.test(u)) return null;
    if (/image_raw(_b)?\.(png|jpe?g)/i.test(u)) return "raw";
    if (/(image_dld_watermark[^~?]*|cdld_wm\d+)\.(png|jpe?g)/i.test(u)) return "dld";
    if (/cpreview_wm\d+\.(png|jpe?g)/i.test(u)) return "cpreview";
    return null;
  }
  function scoreVariant(u, q) {
    let s = 0;
    if (/\.png(\?|$)/i.test(u)) s += 10;
    if (q === "cpreview" && /cpreview_wm0/i.test(u)) s += 8;
    else if (q === "cpreview" && /cpreview_wm1/i.test(u)) s += 2;
    return s;
  }
  function putVariant(bag, u) {
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
  function harvestString(s, bag) {
    if (!s || typeof s !== "string" || s.length > 8000000) return;
    if (!/byteimg\.com/i.test(s) || !/~tplv-/i.test(s)) return;
    for (const raw of s.match(BYTEIMG_TPLV_RE) || []) {
      const u = normalizeUrl(raw);
      if (!u.includes("doubao.com/chat")) putVariant(bag, u);
    }
  }
  function findReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    return key ? el[key] : null;
  }
  function walkFiber(start, bag, maxSteps = 280) {
    let fiber = start, steps = 0;
    while (fiber && steps < maxSteps) {
      steps++;
      try { harvestString(JSON.stringify(fiber.memoizedProps), bag); } catch (_) {}
      let st = fiber.memoizedState, i = 0;
      while (st && i < 100) {
        try { harvestString(JSON.stringify(st.memoizedState), bag); } catch (_) {}
        st = st.next; i++;
      }
      fiber = fiber.return;
    }
  }
  function bfsFiberSubtree(rootEl, bag, maxVisit = 8000) {
    const rootFiber = findReactFiber(rootEl);
    if (!rootFiber) return;
    const queue = [rootFiber], seen = new Set();
    let visited = 0;
    while (queue.length && visited < maxVisit) {
      const f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f); visited++;
      try {
        const s = JSON.stringify(f.memoizedProps);
        if (s && /byteimg\.com/i.test(s) && /~tplv-/i.test(s)) harvestString(s, bag);
      } catch (_) {}
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
    }
  }
  function isSidebar(el) {
    return !!el.closest('a[id^="conversation_"]');
  }

  const bag = new Map();
  const scopes = [];
  const addScope = (el) => { if (el && !scopes.includes(el)) scopes.push(el); };
  addScope(document.querySelector('[class*="message-list"]'));
  addScope(document.querySelector("main"));
  for (const el of document.querySelectorAll('[role="dialog"], [data-state="open"]')) {
    if (/byteimg|cpreview|image_raw|保存/.test(el.innerHTML.slice(0, 30000))) addScope(el);
  }

  for (const root of scopes) {
    for (const img of root.querySelectorAll("img")) {
      if (isSidebar(img)) continue;
      harvestString(img.currentSrc || img.src, bag);
    }
    try { harvestString(root.innerHTML, bag); } catch (_) {}
    bfsFiberSubtree(root, bag);
  }

  for (const el of document.querySelectorAll("button, img")) {
    if (isSidebar(el)) continue;
    const t = (el.textContent || "").trim();
    const isSave = el.tagName === "BUTTON" && t.includes("保存");
    const isImg = el.tagName === "IMG" && /byteimg\.com/i.test(el.currentSrc || el.src || "");
    if (!isSave && !isImg) continue;
    const fiber = findReactFiber(el);
    if (fiber) walkFiber(fiber, bag);
  }

  function pickBestUrl(variants) {
    for (const q of ["raw", "dld", "cpreview"]) if (variants[q]) return { url: variants[q], used: q };
    return null;
  }

  const items = [];
  for (const [id, variants] of bag.entries()) {
    const picked = pickBestUrl(variants);
    if (!picked) continue;
    items.push({
      index: items.length + 1,
      id,
      url: picked.url,
      name: `${PREFIX}-${String(items.length + 1).padStart(2, "0")}.png`,
      used: picked.used,
    });
  }
  window.__doubaoHdImages = items;
  console.log(`${TAG} chatId=${chatId || "?"} 找到 ${items.length} 张（仅当前会话）→ ${PREFIX}/`);
  console.table(items.map(({ index, name, id, used }) => ({ index, name, id, used })));
  if (!items.length) {
    console.warn(`${TAG} 没找到。请先点开大图预览再跑`);
    return;
  }

  async function ensureJSZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("JSZip load failed"));
      document.head.appendChild(s);
    });
    return window.JSZip;
  }
  async function mapPool(list, limit, fn) {
    const ret = new Array(list.length);
    let cursor = 0;
    async function worker() {
      while (cursor < list.length) {
        const i = cursor++;
        ret[i] = await fn(list[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
    return ret;
  }

  const fetched = await mapPool(items, CONCURRENCY, async (item) => {
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let blob = await res.blob();
      let outputItem = item;
      if (CONVERT_TO_JPEG && blob.size > 2 * 1024 * 1024) {
        let bitmap, canvas;
        try {
          bitmap = await createImageBitmap(blob);
          canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, 0, 0);
          const jpeg = await new Promise((resolve, reject) => canvas.toBlob(
            (jpeg) => jpeg?.type === "image/jpeg" ? resolve(jpeg) : reject(new Error("JPEG encode failed")),
            "image/jpeg", 0.9
          ));
          if (jpeg.size < blob.size) {
            blob = jpeg;
            outputItem = { ...item, name: item.name.replace(/\.[^.]+$/, ".jpg") };
          } else {
            console.log(`${TAG} JPEG 体积未减小，保留原图`, item.name);
          }
        } catch (error) {
          console.warn(`${TAG} JPEG 转换失败，保留原图`, item.name, error);
        } finally {
          bitmap?.close();
          if (canvas) { canvas.width = 0; canvas.height = 0; }
        }
      }
      console.log(`${TAG} fetched ${item.index}/${items.length}`, item.name, `${(blob.size / 1048576).toFixed(2)}MB`);
      return { ok: true, item: outputItem, blob };
    } catch (e) {
      console.error(`${TAG} FAIL`, item.name, e);
      return { ok: false, item };
    }
  });
  const okList = fetched.filter((x) => x && x.ok);
  if (!okList.length) return;

  const JSZip = await ensureJSZip();
  const zip = new JSZip();
  for (const { item, blob } of okList) zip.file(`${PREFIX}/${item.name}`, blob);
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const a = document.createElement("a");
  const obj = URL.createObjectURL(zipBlob);
  a.href = obj; a.download = `${PREFIX}-共${okList.length}张.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 30000);
  console.log(`${TAG} ✅ ${PREFIX}-共${okList.length}张.zip（${(zipBlob.size / 1048576).toFixed(1)} MB）共 ${okList.length} 张`);
})();
