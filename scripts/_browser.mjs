/**
 * 测试脚本共用的浏览器定位：优先 EDGE_PATH，其次常见系统路径。
 * 仓库里不写死某台机器的安装位置。
 */
import fs from 'node:fs'

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export function browserPath() {
  const hit = CANDIDATES.filter(Boolean).find((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
  if (!hit) {
    throw new Error('未找到 Edge / Chrome，可通过环境变量 EDGE_PATH 指定可执行文件')
  }
  return hit
}
