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
    // 打开侧边栏（与点击工具栏图标相同）。用 Alt+Shift+D，避开 Linux GNOME 的 Ctrl+Alt+D「显示桌面」。
    commands: {
      "open-download": {
        description: "打开图片下载",
        suggested_key: { default: "Alt+Shift+I" },
      },
      "open-compose": {
        description: "打开内容发布（上传 GitHub）",
        suggested_key: { default: "Alt+Shift+U" },
      },
      _execute_action: {
        description: "打开豆包下载侧边栏",
        suggested_key: {
          default: "Alt+Shift+D",
          windows: "Alt+Shift+D",
          mac: "Alt+Shift+D",
          linux: "Alt+Shift+D",
          chromeos: "Alt+Shift+D",
        },
      },
    },
  },
});
