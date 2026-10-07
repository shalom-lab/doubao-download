# 豆包下载（WXT）

正式交付为 **侧边栏**（点击扩展图标打开 Chrome Side Panel）。说明见 [../README.md](../README.md)。

安装包在 [GitHub Releases](https://github.com/shalom-lab/doubao-download/releases)：下载 `*-chrome.zip` 解压后加载已解压扩展。推送 tag `vX.Y.Z` 会自动发版。

```bash
npm install
npm run dev
npm run build    # → .output/chrome-mv3
npm run zip      # → .output/doubao-download-*-chrome.zip
```
