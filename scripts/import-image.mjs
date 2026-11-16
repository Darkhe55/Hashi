/**
 * 搭桥（Hashi）题图导入命令行工具。
 *
 * 用法：
 *   node scripts/import-image.mjs <题图.(png|jpg)> [选项]
 *
 * 选项：
 *   --name 名称      题库名称（默认「图片导入 · 宽×高」）
 *   --id ID          指定题目 id（覆盖同 id 条目）
 *   --append         写入 data/library.json（默认只预览、不写盘）
 *   --verify         额外做唯一解校验（默认只预览；--append 时至少确认有解）
 *   --allow-multi    允许多解题目入库
 *   --allow-none     无解也允许入库（仅调试用）
 *   --map 修正       人工修正数字，逗号分隔，可重复：
 *                      r3c5=4   第 3 行第 5 列的岛填 4（1 基；0 表示清空）
 *   --min-conf N     自动识别数字的最低置信度（默认 0.55，低置信度留空）
 *   --max-nodes N    解题搜索节点上限（默认 500000）
 *   --out FILE       题库文件（默认 data/library.json）
 *   --json           输出机器可读结果
 *
 * 识别用的是与网页「图片导入」面板同一份 src/game/image-import.ts：
 * 起一个临时 Vite 开发服务器，用 Playwright 在本机 Edge/Chrome 里
 * 把图片交给 detectIslandBoard() + recognizeIslandDigits()，不加载游戏页面本身。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { PORT } from './_port.mjs'
import { MAX_CUSTOM_SIZE } from '../src/game/types.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS_PATH = '/scripts/_import-page.html'
const SERVER_PORT = PORT + 100

function usage(msg) {
  if (msg) console.error(`\n[import] ${msg}`)
  console.error(
    `\n用法：node scripts/import-image.mjs <题图> [--name 名称] [--id ID] [--append] [--verify]
      [--allow-multi] [--allow-none] [--map r3c5=4] [--min-conf 0.55] [--max-nodes N]
      [--out FILE] [--json]

  默认只预览识别出的岛阵与数字；--append 才写入 data/library.json。
  数字识别会先自动填高置信度的值，其余用 --map 人工补。`,
  )
  process.exit(1)
}

function parseArgs(argv) {
  const out = {
    image: null,
    name: null,
    id: null,
    append: false,
    verify: false,
    allowMulti: false,
    allowNone: false,
    maxNodes: 500_000,
    minConf: 0.3,
    out: 'data/library.json',
    json: false,
    maps: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) usage(`参数 ${a} 缺少值`)
      return v
    }
    if (a === '--name') out.name = next()
    else if (a === '--id') out.id = next()
    else if (a === '--append') out.append = true
    else if (a === '--verify') out.verify = true
    else if (a === '--allow-multi') out.allowMulti = true
    else if (a === '--allow-none') out.allowNone = true
    else if (a === '--json') out.json = true
    else if (a === '--max-nodes') out.maxNodes = Number(next()) || 500_000
    else if (a === '--min-conf') out.minConf = Number(next())
    else if (a === '--out') out.out = next()
    else if (a === '--map') {
      for (const token of next().split(',')) if (token.trim()) out.maps.push(token.trim())
    } else if (a === '--dry-run') {
      /* 兼容旧习惯：预览本来就是默认行为 */
    } else if (a.startsWith('--')) usage(`未知参数 ${a}`)
    else if (!out.image) out.image = a
    else usage(`多余参数 ${a}`)
  }
  if (!out.image) usage('请指定题图路径')
  if (!Number.isInteger(out.maxNodes) || out.maxNodes < 1000) usage('--max-nodes 需要 ≥ 1000')
  if (!(out.minConf >= 0 && out.minConf <= 1)) usage('--min-conf 需要 0..1')
  return out
}

function sniffMime(buf, file) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitReady(url, timeoutMs = 60_000) {
  const started = Date.now()
  for (;;) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) return true
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started > timeoutMs) return false
    await sleep(150)
  }
}

const args = parseArgs(process.argv.slice(2))
const imagePath = path.resolve(process.cwd(), args.image)
if (!existsSync(imagePath)) usage(`找不到图片：${imagePath}`)
const executablePath = findBrowser()
if (!executablePath) usage('找不到 Edge/Chrome，可用 EDGE_PATH 指定浏览器路径')

const imageBuf = readFileSync(imagePath)
const dataUrl = `data:${sniffMime(imageBuf, imagePath)};base64,${imageBuf.toString('base64')}`

const url = `http://127.0.0.1:${SERVER_PORT}${HARNESS_PATH}`
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(SERVER_PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore', windowsHide: true },
)
const stopServer = () => {
  try {
    vite.kill()
  } catch {
    /* ignore */
  }
}
process.on('exit', stopServer)
process.on('SIGINT', () => process.exit(130))

let browser
try {
  if (!(await waitReady(url))) {
    stopServer()
    usage(`临时 Vite 开发服务器没起来（端口 ${SERVER_PORT} 可能被占用）。`)
  }

  browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage()
  page.on('pageerror', () => {})
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const detected = await page.evaluate(
    async ({ dataUrl }) => {
      const mod = await import('/src/game/image-import.ts')
      const img = new Image()
      img.src = dataUrl
      await img.decode()
      const canvas = document.createElement('canvas')
      const result = mod.detectIslandBoard(canvas, img)
      if (!result.board) return { ok: false, error: result.error }
      const guesses = mod.recognizeIslandDigits(canvas, img, result.board.islands)
      return {
        ok: true,
        width: result.board.width,
        height: result.board.height,
        islands: result.board.islands.map((island, i) => ({
          col: island.col,
          row: island.row,
          x: island.x,
          y: island.y,
          r: island.r,
          guess: guesses[i] ?? { value: null, confidence: 0 },
        })),
      }
    },
    { dataUrl },
  )

  if (!detected.ok) {
    console.error(`[import] 识别失败：${detected.error}`)
    if (args.json) console.log(JSON.stringify({ ok: false, errors: [detected.error] }, null, 2))
    process.exit(1)
  }

  const { width, height } = detected
  if (width < 2 || height < 2) usage(`识别到 ${width}×${height} 岛阵，尺寸过小`)
  if (width > MAX_CUSTOM_SIZE || height > MAX_CUSTOM_SIZE) {
    usage(`识别到 ${width}×${height}，超过最大尺寸 ${MAX_CUSTOM_SIZE}`)
  }

  // 用置信度决定是否自动填数字
  const grid = new Array(width * height).fill(0)
  const report = []
  let auto = 0
  for (const island of detected.islands) {
    const guess = island.guess ?? { value: null, confidence: 0 }
    let value = null
    if (guess.value != null && guess.confidence >= args.minConf) {
      value = guess.value
      auto++
    }
    grid[island.row * width + island.col] = value ?? 0
    report.push({
      row: island.row + 1,
      col: island.col + 1,
      value,
      guess: guess.value,
      confidence: Number(guess.confidence.toFixed(2)),
    })
  }

  // —— 人工修正 ——
  if (args.maps.length) {
    for (const token of args.maps) {
      const m = /^r(\d+)c(\d+)=(-?\d+)$/.exec(token)
      if (!m) usage(`--map 格式无法识别：「${token}」（示例 r3c5=4）`)
      const row = Number(m[1]) - 1
      const col = Number(m[2]) - 1
      const value = Number(m[3])
      if (row < 0 || row >= height || col < 0 || col >= width) {
        usage(`--map ${token}：坐标超出 ${width}×${height}`)
      }
      if (value < 0 || value > 8) usage(`--map ${token}：数字应在 0..8（0 表示清空）`)
      if (grid[row * width + col] !== value) {
        console.log(
          `[import] --map：第 ${row + 1} 行第 ${col + 1} 列 ${grid[row * width + col] || '空'} → ${value || '空'}`,
        )
      }
      grid[row * width + col] = value
    }
  }

  const board = grid.join('')
  let missing = 0
  for (const island of detected.islands) {
    if (grid[island.row * width + island.col] === 0) missing++
  }

  if (!args.json) {
    console.log(`[import] 识别：${width}×${height}，${detected.islands.length} 个岛，自动读出 ${auto} 个数字`)
    if (missing) {
      console.log(`[import] 还有 ${missing} 个岛没有数字（可用 --map r行c列=数字 补）`)
    }
    console.log('[import] 岛阵（0 表示空格）：')
    for (let y = 0; y < height; y++) {
      console.log(
        '  ' +
          grid
            .slice(y * width, y * width + width)
            .map((v) => (v === 0 ? '.' : String(v)))
            .join(' '),
      )
    }
    const lowConf = report.filter((r) => r.value == null && r.guess != null)
    if (lowConf.length) {
      console.log(
        '[import] 低置信度候选：' +
          lowConf
            .slice(0, 12)
            .map((r) => `r${r.row}c${r.col}≈${r.guess}(${r.confidence})`)
            .join(' '),
      )
    }
  }

  if (missing) {
    if (args.append) {
      console.error(`[import] 还有 ${missing} 个岛没有数字，无法入库。请先用 --map 补齐。`)
      process.exit(1)
    }
    if (args.json) {
      console.log(
        JSON.stringify(
          { ok: true, width, height, board, auto, missing, islands: report },
          null,
          2,
        ),
      )
    } else {
      console.log('[import] 预览模式（数字不完整，不能入库）。加 --map 补齐后可 --append。')
    }
    process.exit(0)
  }

  // —— 解题校验 ——
  let solved = null
  if (args.append || args.verify) {
    const check = await page.evaluate(
      async ({ islands, w, h, verify, maxNodes }) => {
        const types = await import('/src/game/types.ts')
        const solver = await import('/src/game/solver.ts')
        const edges = types.buildEdges(islands, w, h)
        const limit = verify ? 2 : 1
        const out = solver.countSolutions(islands, edges, limit, maxNodes)
        return { count: out.count, nodes: out.nodes, timedOut: out.timedOut }
      },
      { islands: grid, w: width, h: height, verify: args.verify, maxNodes: args.maxNodes },
    )
    console.log(
      `[import] 解题校验：count=${check.count} 节点=${check.nodes}${check.timedOut ? '（超时）' : ''}`,
    )
    solved = check
    if (check.timedOut) {
      if (args.append) console.warn('[import] 警告：求解超时，未能确认是否有解。')
    } else if (check.count === 0) {
      console.error('[import] 该题面无解，请用 --map 核对数字。')
      if (!args.allowNone) process.exit(1)
    } else if (args.verify && check.count >= 2) {
      console.error(`[import] 解不唯一（至少 ${check.count} 个）。`)
      if (!args.allowMulti) process.exit(1)
    }
  }

  if (!args.append) {
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            width,
            height,
            board,
            auto,
            unique: solved ? solved.count === 1 && !solved.timedOut : null,
            islands: report,
          },
          null,
          2,
        ),
      )
    } else {
      console.log('[import] 预览模式，未写入。加 --append 写入 data/library.json。')
    }
    process.exit(0)
  }

  const id = args.id || `hashi-custom-image-${Date.now()}`
  const name = args.name || `图片导入 · ${width}×${height}`
  const entry = {
    id,
    name,
    width,
    height,
    difficulty: 'custom',
    savedAt: Date.now(),
    board,
  }
  const outFile = path.resolve(args.out)
  let library = []
  try {
    const raw = JSON.parse(readFileSync(outFile, 'utf8'))
    if (Array.isArray(raw)) library = raw
  } catch {
    /* 空题库 */
  }
  const index = library.findIndex((x) => x && x.id === entry.id)
  if (index >= 0) library[index] = entry
  else library.push(entry)
  mkdirSync(path.dirname(outFile), { recursive: true })
  const tmp = `${outFile}.tmp`
  writeFileSync(tmp, JSON.stringify(library, null, 2) + '\n', 'utf8')
  renameSync(tmp, outFile)

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          id,
          name,
          width,
          height,
          board,
          auto,
          unique: solved ? solved.count === 1 && !solved.timedOut : null,
          written: path.relative(process.cwd(), outFile),
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`[import] 已写入 ${args.out}：${id}（${name}）${index >= 0 ? '（覆盖）' : ''}`)
    console.log('[import] 浏览器里刷新页面即可在题库看到新题')
  }
} finally {
  if (browser) await browser.close().catch(() => {})
  stopServer()
}

