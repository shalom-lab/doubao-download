import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  entrypointsDir: "entrypoints",
  manifest: {
    name: "豆包下载",
    description: "当前豆包对话高清图 ZIP 下载，以及本地队列后台上传 GitHub",
    permissions: ["storage", "tabs", "scripting", "clipboardRead", "alarms", "sidePanel"],
    host_permissions: [
      "https://www.doubao.com/*",
      "https://doubao.com/*",
      "https://*.doubao.com/*",
      "https://*.byteimg.com/*",
      "https://api.github.com/*",
    ],
    action: {
      default_title: "豆包下载",
    },
    commands: {
      "execute-download": {
        description: "执行打包下载（需打开图片下载页）",
        suggested_key: { default: "Ctrl+Shift+8" },
      },
      "execute-upload": {
        description: "执行提交到 GitHub（需打开内容发布页）",
        suggested_key: { default: "Ctrl+Shift+9" },
      },
      "open-download": {
        description: "打开图片下载",
        suggested_key: { default: "Alt+Shift+I" },
      },
      "open-compose": {
        description: "打开内容发布（上传 GitHub）",
        suggested_key: { default: "Alt+Shift+U" },
      },
    },
  },
});
