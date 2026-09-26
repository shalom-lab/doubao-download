/**
 * 可选：扩展安装后已打开的标签不会自动有脚本。
 * 下载已改为 popup → scripting.executeScript({ world: 'MAIN' })，
 * 不再依赖 isolated content script 长连接。
 *
 * 保留一个极简 background 即可。
 */
export default defineBackground(() => {
  console.log("[豆包下载] background ready");
});
