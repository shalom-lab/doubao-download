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
  },
});
