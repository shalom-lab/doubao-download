# 豆包下载

WXT 浏览器插件：在任意 [豆包](https://www.doubao.com) 对话页，点击扩展图标打开 **popup**，一键扫描高清大图并 **并行打成 ZIP** 下载。

---

## 命名规则

前缀填 `0001`、检出 10 张时：

```
0001-共10张.zip
└── 0001/
    ├── 0001-01.png
    ├── 0001-02.png
    └── …
```

ZIP 文件名带张数；解压后仍是前缀文件夹。
自动取**最清晰**的一档（无需选择）：

1. `image_raw*`（原图）
2. 否则 `image_dld*` / `cdld_wm*`（官方保存）
3. 再否则 `cpreview_wm*`（预览大图）

同时兼容任意对话生成图（**不绑定目录名**）：

- **只收当前会话**：用 URL `/chat/{数字id}` 锁定；只扫消息区 / 大图预览
- 不扫侧边栏其它对话、不用 `performance` 残留（避免换对话后串台）
- 识别规则：`byteimg.com` + 高清 `~tplv` 模板
- 自动排除：icon、`image-qvalue`、头像等噪音

已在「奶奶的院子」「城市宣传图」「费马大定理」「童年小卖部」等对话验证。

---

## 安装

```bash
cd extension
npm install
npm run dev       # 开发（自动打开带扩展的浏览器）
npm run build     # → .output/chrome-mv3/
npm run zip       # 扩展分发包
```

手动加载：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `extension/.output/chrome-mv3`。

---

## 使用

1. 打开豆包对话，**先点开一张图**进入右侧大图预览（可选，但更容易拿到原图）  
2. 点击扩展图标 → 填前缀 → **打包下载**  
3. 面板显示查找 / 拉取 / 打包进度；下方有运行日志  

换对话重复即可。前缀保存在 `browser.storage.local`。ZIP 名如 `0001-共10张.zip`，包内仍是 `0001/`。

扩展失效时：点 **复制 Console 兜底脚本** → 豆包页 F12 Console 粘贴回车（脚本源：`scripts/doubao-console-batch-download.js`）。

---

## 架构

```
popup（UI + download log）
  └─ chrome.scripting.executeScript({ world: 'MAIN' })
        └─ doubao-main.js（页面主世界）
              ├─ extract-hd.ts     读 React Fiber / 签名 URL
              └─ zip-download.ts   并行 fetch + JSZip
```

必须用 **MAIN world**：isolated content script 读不到页面 React 状态，会出现连不上或扫到 0 张。

控制台实验脚本：`scripts/doubao-console-batch-download.js`（同思路）。

---

## 常见问题

**扫到 0 张？** 先点开大图预览，再打开 popup 下载。  

**提示无法注入 / 没有权限？** 确认当前标签是 `https://www.doubao.com/...`，重新加载扩展后再试。  

**扩展刚重载？** 无需再刷新页面等 content script：popup 会每次用 MAIN world `executeScript` 注入。
