# 豆包下载

WXT 浏览器扩展。在 [豆包](https://www.doubao.com) 对话页点工具栏图标，打开 **Chrome 右侧边栏**（不是小弹窗），做两件事：

1. **图片下载**：只扫当前 `/chat/{id}` 会话的高清图，勾选并排好顺序后打成 ZIP。
2. **内容发布**：编辑 `contents` / `reply_words` 和图片，点提交先写入本地队列，后台再上传 GitHub。关掉侧边栏也会继续。

顶部可勾选「大于 2MB 转为 JPEG」（品质 90%，透明底改白；转完没变小或失败则留原图）。下载、Console 脚本、GitHub 上传共用。GitHub 仓库 / Token 在设置页。

需 **Chrome 114+**（Side Panel）。

---

## 图片下载

前缀填 `0001`、勾选 10 张时：

```
0001-共10张.zip
└── 0001/
    ├── 0001-01.png
    ├── 0001-02.png
    └── …
```

自动取最清晰一档：`image_raw*` → 官方保存 `image_dld*` / `cdld_wm*` → 预览 `cpreview_wm*`。只认当前会话消息区 / 大图预览里的 `byteimg.com` + `~tplv`，不扫对话列表、不吃 `performance` 残留。

打开侧边栏会自动获取当前对话缩略图（也可点「获取图片」）。默认全选，可 **全选 / 全不选**。点图片主体勾选或取消；右上角小方块同样可用。悬停后左下角出现放大按钮。拖拽调整顺序后，ZIP 内文件名按勾选后的顺序编号（`0001-01` 起）；拉图仍并行。

扩展失效时，可复制 Console 兜底脚本到豆包页粘贴（源文件 `scripts/doubao-console-batch-download.js`）。

---

## 内容发布

- 首次打开且 `contents` 为空时尝试读剪贴板；可手动改、再读剪贴板。
- 图片交互与下载页相同（勾选、全选、拖拽、悬停放大）。只有勾选的图会上传。草稿按会话存在本地。
- **提交**：立刻保存 IndexedDB 任务并反馈；拉图、转 JPEG、连 GitHub 都在后台。进度看「上传任务」（按**图片张数**计数，不含 JSON / Markdown）和扩展角标。相同内容不会重复建任务。
- 发布页会按当前对话 URL（`/chat/{数字}`）显示**已提交几次**。分两批勾选提交计 2 次；同一内容重复点提交不另计。次数存在本机，与上传任务列表的 10 条上限无关。
- **设置**：`owner/repo` 或仓库链接、可选分支、Token。Token 仅保存在本机，需要仓库 Contents 读写权限。未保存仓库/Token 时不能入队。

---

## 安装

### 从 Release 安装（推荐）

1. 打开 [Releases](https://github.com/shalom-lab/doubao-download/releases)，下载 `doubao-download-*-chrome.zip`
2. 解压到任意文件夹
3. Chrome 打开 `chrome://extensions` → 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选解压后的目录（含 `manifest.json`）
4. 点工具栏图标打开右侧边栏（需 Chrome 114+）

打 tag `vX.Y.Z`（或 Actions 里手动跑 **Release**）会自动构建 zip 并挂到 GitHub Release。

### 本地开发

```bash
cd extension
npm install
npm run dev       # 开发（自动打开带扩展的浏览器）
npm run build     # → .output/chrome-mv3/
npm run zip       # → .output/doubao-download-*-chrome.zip
```

手动加载开发产物：选 `extension/.output/chrome-mv3`。升级后请重新加载扩展；若豆包页还在跑旧脚本，刷新页面。

---

## 架构

```
侧边栏（下载 / 发布 / 设置）
  ├─ chrome.scripting.executeScript({ world: 'MAIN' })
  │     └─ doubao-main.js
  │           ├─ extract-hd.ts     当前会话高清图
  │           └─ zip-download.ts   并行 fetch + JPEG + JSZip（按列表顺序入包）
  └─ background（IndexedDB 队列）
        ├─ 先缓存图片与 JSON/MD
        └─ 再写入 GitHub Contents API
```

必须用 **MAIN world**：isolated content script 读不到页面 React 状态，会出现连不上或扫到 0 张。

控制台实验脚本：`scripts/doubao-console-batch-download.js`（同思路，无侧边栏勾选 UI）。

---

## 常见问题

**扫到 0 张？** 先点开大图预览，再打开侧边栏或点「获取图片」。

**提示无法注入 / 没有权限？** 确认当前标签是 `https://www.doubao.com/...`，重新加载扩展后再试。

**扩展刚重载？** 无需再刷新页面等 content script：侧边栏会每次用 MAIN world `executeScript` 注入。

**点图标没有弹窗？** 这是设计：面板在窗口右侧。若侧边栏没出现，确认 Chrome ≥ 114 且已授予 `sidePanel` 权限。

## GitHub 上传格式与恢复

- JSON / Markdown：`infoflow-data/Prompts/{UTC时间}-{随机后缀}.json` / `.md`。
- 图片：`infoflow-data/Images/Prompts/{同一标识}-{从0开始的序号}.{实际格式}`。
- `category` 固定为 `Prompts`；`contents` 写入 `content`，`reply_words` 独立保存；`notes` 为空，`url` 是采集时的豆包对话链接。
- `image` 为排序后的第一张，`images` 保持勾选后的编辑顺序，使用 `../Images/Prompts/…` 相对路径。无图片时分别为 `""` 和 `[]`。
- JSON 使用 UTF-8 和两个空格缩进。Markdown 输出 `Content`、多图时的 `Images`、有回复词时的 `Reply Words`。
- 首次入队时固定文件标识和 `savedAt`；图片处理结果缓存到 IndexedDB，全部准备好后先传图片，再传 JSON 和 Markdown。每个文件成功后保存进度，重试查询 SHA 并使用原路径。
- 「上传任务」进度为勾选图片张数，例如 `12/12 张`，不含 JSON / Markdown。列表可纵向滚动。
- 未完成任务会一直留在列表里（排队 / 失败可重试）。已完成的只保留最近 10 条，更早的会从本地队列删掉；重复提交去重也只对照这 10 条。
- 网络失败最多自动尝试三次，失败任务可手动重试。Token/权限错误直接显示失败。仓库设置改变后，旧任务保持原仓库，需恢复其设置才能重试。
- GitHub Contents API 逐文件写入，不是原子操作。失败时仓库可能已有部分文件；任务全部成功才显示完成。
- Token 仅向 `api.github.com` 发送，不注入豆包页面或写入任务文件。本地 Token 存储没有额外加密；请使用仅授权目标仓库 Contents 读写权限的 Token。
- 图片链接在缓存前仍可能过期，此时需要重新获取图片。尚未自动加载豆包未显示的历史消息。

### 上传回归测试

构建后运行 `node tests/upload-integration.cjs`（工作目录 `extension`）。需要 Playwright，可用 `PLAYWRIGHT_MODULE` 指定安装位置，`CHROME_PATH` 指定浏览器程序。测试使用真实浏览器和 IndexedDB，所有 GitHub 请求均为模拟，不向真实仓库写入。覆盖顺序、中文编码、默认分支、响应丢失重试、后台状态重建、重复提交、权限失败手动重试以及后台 JPEG 转换。
