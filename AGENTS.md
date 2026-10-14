# 使用豆包下载扩展

开始前：到 https://github.com/shalom-lab/doubao-download 的 [Releases](https://github.com/shalom-lab/doubao-download/releases) 下载**最新** `doubao-download-*-chrome.zip`；若本机已装旧版，先在 `chrome://extensions` 删除旧扩展，再解压并「加载已解压的扩展程序」安装新版。

面向 Cursor / Grok Bot 等 Agent：在豆包网页里下载高清图，或把文案+图片提交到 GitHub。

## 1. 目标任务

- **谁**：操作本机已安装「豆包下载」Chrome 扩展的 Agent（或指导人类点一下）。
- **达成**：在 `https://www.doubao.com/chat/{数字}` 对话页完成「打包 ZIP」或「提交到 GitHub」。
- **完工标准**：
  - 下载：浏览器出现 `{前缀}-共N张.zip`，或侧边栏状态为完成。
  - 发布：侧边栏「上传任务」出现任务，角标有进度；不必等上传跑完。
- **非目标**：不替人类改 GitHub Token；不扫侧边栏其它会话的缩略图；不依赖 PPT 页逻辑。

## 2. 背景信息

### 打开方式（最容易错）

1. 当前标签必须是豆包对话：`https://www.doubao.com/chat/` + 数字。
2. **优先快捷键**打开右侧 Side Panel：`Alt+Shift+D`（Mac 同为 Option+Shift+D）。与点工具栏扩展图标效果相同。
3. 也可点 Chrome **工具栏**上的扩展图标（豆包下载 / 常显示为豆状图标）。
4. **不是**页面内弹窗；打开后看浏览器**右侧栏**，不是网页中间。
5. 快捷键无效时：打开 `chrome://extensions/shortcuts`，给「豆包下载」绑定 `Alt+Shift+D`。

### 侧边栏三个 Tab（从左到右）

| 顺序 | `aria-label` / title | 用途 | Agent 是否常用 |
|------|----------------------|------|----------------|
| 1 | 图片下载 | 勾选图 →「打包下载」ZIP | 要下图时用 |
| 2 | 内容发布（默认打开） | `contents` / `reply_words` + 勾选图 →「提交到 GitHub」 | 要上传时用 |
| 3 | GitHub 设置 | repo / 分支 / Token | **一般人类处理**，Agent 勿改除非用户明确要求 |

顶部还有：「大于 2MB 的图片转为 JPEG（下载 / 上传）」复选框（默认勾选）。

### 关键选择器（侧边栏 DOM）

下载页：

- 切换 Tab：`button[data-tab="download|compose|settings"]`
- 前缀：`#prefix`
- 获取图片：`#scan-download-images`
- 全选 / 全不选：`#download-select-all` / `#download-select-none`
- 打包：`#run`
- 状态：`#status`；进度：`#progress-card` / `#phase` / `#progress-msg`

发布页：

- 正文：`#contents`；回复词：`#reply_words`
- 读剪贴板：`#read-clipboard`
- 获取图片：`#scan-images`
- 提交：`#submit-content`
- 状态：`#compose-status`；任务列表：`#upload-jobs`

### 图片勾选

- **单击**缩略图主体：勾选 / 取消。
- **右键**：批量「这张及之前 / 及之后」选中或取消。
- 可拖拽排序；ZIP / 上传顺序按勾选后的列表顺序。

## 3. 工作要求

- 先确认标签页是豆包 `/chat/数字`；否则停下来让用户打开。
- **默认打开的是「内容发布」Tab**；要下载必须先点左侧第一个 Tab「图片下载」。
- 第三个「GitHub 设置」交给人类；Agent 不主动填 Token。
- 用点击侧边栏 UI 完成操作：优先点带 `aria-label` 的 Tab 与 `#run` / `#submit-content`，再读 `#status` / `#compose-status` 判断成败。

## 4. 工作流程

### Step 1 — 确认页面

确认当前为 `https://www.doubao.com/chat/{数字}`。不是则请用户切到目标对话。

### Step 2 — 打开 Side Panel

按 `Alt+Shift+D`，或点工具栏「豆包下载」图标；等待**右侧**侧边栏出现（不是页面弹层）。无效则检查 `chrome://extensions/shortcuts`。

### Step 3A — 下载 ZIP

1. 点 Tab `aria-label="图片下载"`（`data-tab="download"`）。
2. （可选）填 `#prefix`，如 `0001`。
3. 若列表为空：点「获取图片」。
4. 按需全选 / 右键区间勾选 / 拖拽排序。
5. 点「打包下载」`#run`。
6. 看 `#status` / 进度条直到完成；ZIP 名形如 `0001-共10张.zip`。

### Step 3B — 提交 GitHub

1. 点 Tab `aria-label="内容发布"`（通常已打开）。
2. 确认 `#contents` / `#reply_words`；可用「读取剪贴板」。
3. 「获取图片」→ 勾选要上传的图。
4. 确认人类已在「GitHub 设置」保存过 repo + Token。
5. 点「提交到 GitHub」`#submit-content`。
6. 看 `#compose-status` 与「上传任务」；提交成功即可，上传可在后台继续。

### Step 4 — 失败快检

| 现象 | 处理 |
|------|------|
| 点图标没反应 | Chrome ≥ 114；扩展已加载；看右侧而非网页中间 |
| 0 张图 | 点「获取图片」；仍空可先在对话点开一张大图后再获取 |
| 提交被拒 | 人类去设置页检查 repo/Token |
| 扩展刚重载 | 刷新豆包页或再点一次获取/打包 |
