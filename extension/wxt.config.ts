import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  entrypointsDir: "entrypoints",
  manifest: {
    name: "豆包下载",
    description: "任意豆包对话页一键打包下载全部高清大图（ZIP）",
    permissions: ["storage", "tabs", "scripting"],
    host_permissions: [
      "https://www.doubao.com/*",
      "https://doubao.com/*",
      "https://*.doubao.com/*",
      "https://*.byteimg.com/*",
    ],
    action: {
      default_title: "豆包下载",
    },
  },
});
