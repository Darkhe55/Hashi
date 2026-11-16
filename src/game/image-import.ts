/**
 * 搭桥 —— 从图片导入题目
 *
 * 思路：题目图片里的岛是深色空心圆。把图片画到 canvas，取暗色像素的
 * 连通块，筛出近正方形、空心（填充率低）的连通块作为岛。再由岛心坐标
 * 拟合行列间距，得到每个岛的 (col, row)。
 * 圆内的数字用系统字体模板做字形匹配自动读出（1-8），置信度低的留给
 * 使用者手填/修正。自定义题允许任意输入，保存时不强制唯一解。
 */

import type { ImageImportHost } from '../core/types'
import { MAX_CUSTOM_SIZE, type HashiPuzzle } from './types'

interface Ring {
  x: number
  y: number
  r: number
}

/** 识别出的岛（含格坐标与自动读出的数字） */
export interface Island extends Ring {
  col: number
  row: number
  value: number | null
  /** 数字自动识别的置信度 0..1（null = 没读出数字） */
  confidence?: number | null
}

/** 图片识别出的整块岛阵 */
export interface IslandBoard {
  width: number
  height: number
  islands: Island[]
}

interface Component {
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Lattice {
  origin: number
  step: number
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 把相差不到 tol 的坐标并成一簇，返回每簇平均值 */
function cluster(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const value of sorted) {
    const group = groups[groups.length - 1]
    if (group && value - group[group.length - 1]! <= tol) group.push(value)
    else groups.push([value])
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length)
}

/** 用最小二乘拟合 origin + k * step，容忍个别空行/空列 */
function fitLattice(values: number[]): Lattice {
  if (!values.length) return { origin: 0, step: 0 }
  const origin = values[0]!
  if (values.length === 1) return { origin, step: 0 }

  let step = Infinity
  for (let i = 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!
    if (diff > 0 && diff < step) step = diff
  }
  if (!(step > 0) || !isFinite(step)) return { origin, step: 0 }

  let fittedOrigin = origin
  for (let pass = 0; pass < 3; pass++) {
    const ks = values.map((v) => Math.round((v - fittedOrigin) / step))
    const kMean = ks.reduce((a, b) => a + b, 0) / ks.length
    const vMean = values.reduce((a, b) => a + b, 0) / values.length
    let num = 0
    let den = 0
    for (let i = 0; i < values.length; i++) {
      const dk = ks[i]! - kMean
      num += dk * (values[i]! - vMean)
      den += dk * dk
    }
    if (!(den > 0)) break
    const next = num / den
    if (!(next > 0)) break
    step = next
    fittedOrigin = vMean - step * kMean
  }
  return { origin: fittedOrigin, step }
}

function components(
  mask: Uint8Array,
  w: number,
  h: number,
): { comps: Component[]; labels: Int32Array } {
  const seen = new Uint8Array(w * h)
  const labels = new Int32Array(w * h).fill(-1)
  const out: Component[] = []
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (mask[start] !== 1 || seen[start] === 1) continue
    const id = out.length
    seen[start] = 1
    labels[start] = id
    stack.push(start)
    let area = 0
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w
      const y = Math.floor(p / w)
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const q = ny * w + nx
          if (mask[q] === 1 && seen[q] !== 1) {
            seen[q] = 1
            labels[q] = id
            stack.push(q)
          }
        }
      }
    }
    out.push({ area, minX, minY, maxX, maxY })
  }
  return { comps: out, labels }
}

interface CanvasPixels {
  w: number
  h: number
  data: Uint8ClampedArray
}

function readCanvasPixels(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
): CanvasPixels | null {
  const sw = image.naturalWidth
  const sh = image.naturalHeight
  if (!sw || !sh) return null
  const scale = Math.min(1, 1500 / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(image, 0, 0, w, h)
  return { w, h, data: ctx.getImageData(0, 0, w, h).data }
}

function detectRings(pixels: CanvasPixels): Ring[] {
  const { w, h, data } = pixels
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const p = i * 4
    const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
    mask[i] = data[p + 3]! > 128 && lum < 120 ? 1 : 0
  }

  const { comps, labels } = components(mask, w, h)
  const rings: Ring[] = []
  for (let id = 0; id < comps.length; id++) {
    const c = comps[id]!
    const bw = c.maxX - c.minX + 1
    const bh = c.maxY - c.minY + 1
    const minDim = Math.min(bw, bh)
    const maxDim = Math.max(bw, bh)
    if (minDim < 16 || maxDim > Math.min(w, h) * 0.25) continue
    if (maxDim / minDim > 1.45) continue
    const fill = c.area / (bw * bh)
    if (fill < 0.04 || fill > 0.5) continue
    // 空心判定：自己的像素不出现在包围盒中心区域（圆心里的数字属于另一个连通块）
    const insetX = Math.max(1, Math.round(bw * 0.3))
    const insetY = Math.max(1, Math.round(bh * 0.3))
    let centerHit = false
    for (let y = c.minY + insetY; y <= c.maxY - insetY && !centerHit; y++) {
      for (let x = c.minX + insetX; x <= c.maxX - insetX; x++) {
        if (labels[y * w + x] === id) {
          centerHit = true
          break
        }
      }
    }
    if (centerHit) continue
    rings.push({ x: c.minX + bw / 2, y: c.minY + bh / 2, r: (bw + bh) / 4 })
  }

  const merged: Ring[] = []
  for (const ring of rings) {
    const near = merged.find(
      (m) => Math.hypot(m.x - ring.x, m.y - ring.y) < Math.min(m.r, ring.r) * 0.5,
    )
    if (!near) merged.push(ring)
  }
  return merged
}

/** 由岛心坐标拟合行列并映射到整数格坐标，得到整块岛阵 */
function buildIslandBoard(found: Ring[]): IslandBoard {
  const radius = median(found.map((r) => r.r))
  const xClusters = cluster(
    found.map((r) => r.x),
    radius * 0.45,
  )
  const yClusters = cluster(
    found.map((r) => r.y),
    radius * 0.45,
  )
  const lx = fitLattice(xClusters)
  const ly = fitLattice(yClusters)

  const raw = found.map((ring) => ({
    ...ring,
    col: lx.step > 0 ? Math.round((ring.x - lx.origin) / lx.step) : 0,
    row: ly.step > 0 ? Math.round((ring.y - ly.origin) / ly.step) : 0,
    value: null as number | null,
  }))
  const minCol = Math.min(...raw.map((r) => r.col))
  const minRow = Math.min(...raw.map((r) => r.row))
  const maxCol = Math.max(...raw.map((r) => r.col))
  const maxRow = Math.max(...raw.map((r) => r.row))

  const byCell = new Map<string, Island>()
  for (const ring of raw) {
    const col = ring.col - minCol
    const row = ring.row - minRow
    const key = `${col},${row}`
    const prev = byCell.get(key)
    if (!prev || ring.r > prev.r) {
      byCell.set(key, { ...ring, col, row, value: null })
    }
  }
  const islands = [...byCell.values()].sort((a, b) => a.row - b.row || a.col - b.col)
  return { width: maxCol - minCol + 1, height: maxRow - minRow + 1, islands }
}

export interface DetectResult {
  board: IslandBoard | null
  error: string | null
}

/** 从图片识别岛阵；失败时 error 是可展示给用户的原因 */
export function detectIslandBoard(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
): DetectResult {
  const pixels = readCanvasPixels(canvas, image)
  if (!pixels) return { board: null, error: '图片解码失败，请换一张 PNG/JPG 截图。' }
  const found = detectRings(pixels)
  if (!found.length) {
    return {
      board: null,
      error: '没有识别到圆点岛。请换一张背景更干净、圆点更清晰的题目图片。',
    }
  }
  return { board: buildIslandBoard(found), error: null }
}

// —— 圆内数字自动识别（系统字体模板匹配） ——

const GW = 12
const GH = 18
const DIGIT_FONTS = [
  'Arial',
  'Verdana',
  'Tahoma',
  'Segoe UI',
  'Calibri',
  'Helvetica',
  'DejaVu Sans',
  'sans-serif',
]

interface DigitTemplate {
  digit: number
  grid: Float32Array
  aspect: number
}

let digitTemplates: DigitTemplate[] | null = null

function normalizeDensity(
  data: Uint8ClampedArray,
  imgW: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  threshold: number,
): Float32Array {
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const grid = new Float32Array(GW * GH)
  for (let gy = 0; gy < GH; gy++) {
    const y0 = minY + Math.floor((gy * bh) / GH)
    const y1 = Math.max(y0, minY + Math.floor(((gy + 1) * bh) / GH) - 1)
    for (let gx = 0; gx < GW; gx++) {
      const x0 = minX + Math.floor((gx * bw) / GW)
      const x1 = Math.max(x0, minX + Math.floor(((gx + 1) * bw) / GW) - 1)
      let ink = 0
      let total = 0
      for (let y = y0; y <= y1; y++) {
        const base = y * imgW
        for (let x = x0; x <= x1; x++) {
          total++
          const p = (base + x) * 4
          const lum =
            0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
          if (data[p + 3]! > 128 && lum < threshold) ink++
        }
      }
      grid[gy * GW + gx] = total ? ink / total : 0
    }
  }
  return grid
}

function buildDigitTemplates(): DigitTemplate[] {
  const templates: DigitTemplate[] = []
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 160
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return templates
  for (const font of DIGIT_FONTS) {
    for (const weight of ['700', '400']) {
      for (let digit = 1; digit <= 8; digit++) {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, 160, 160)
        ctx.fillStyle = '#000'
        ctx.font = `${weight} 108px "${font}"`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(digit), 80, 84)
        const data = ctx.getImageData(0, 0, 160, 160).data
        let minX = 160
        let minY = 160
        let maxX = -1
        let maxY = -1
        for (let y = 0; y < 160; y++) {
          for (let x = 0; x < 160; x++) {
            const p = (y * 160 + x) * 4
            const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
            if (lum >= 128) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        if (maxX < minX) continue
        templates.push({
          digit,
          grid: normalizeDensity(data, 160, minX, minY, maxX, maxY, 128),
          aspect: (maxX - minX + 1) / (maxY - minY + 1),
        })
      }
    }
  }
  return templates
}

function gridDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!
    sum += d * d
  }
  return Math.sqrt(sum / a.length)
}

export interface DigitGuess {
  value: number | null
  confidence: number
}

/** 读每个岛圆内的数字；置信度低的 value 为 null（留给人工填写） */
export function recognizeIslandDigits(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  islands: Island[],
): DigitGuess[] {
  const pixels = readCanvasPixels(canvas, image)
  const fallback = islands.map(() => ({ value: null, confidence: 0 }))
  if (!pixels) return fallback
  if (!digitTemplates) digitTemplates = buildDigitTemplates()
  const templates = digitTemplates
  if (!templates.length) return fallback
  const { w, h, data } = pixels

  return islands.map((island) => {
    const cx = island.x
    const cy = island.y
    const r = island.r
    const limit = r * 0.8
    const x0 = Math.max(0, Math.floor(cx - limit))
    const x1 = Math.min(w - 1, Math.ceil(cx + limit))
    const y0 = Math.max(0, Math.floor(cy - limit))
    const y1 = Math.min(h - 1, Math.ceil(cy + limit))
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        if (dx * dx + dy * dy > limit * limit) continue
        const p = (y * w + x) * 4
        const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!
        if (data[p + 3]! <= 128 || lum >= 150) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < minX || maxY < minY) return { value: null, confidence: 0 }
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    // 数字应该落在圆心附近、大小与圆匹配；太小的噪点或贴边的圆环都丢掉
    if (bw < r * 0.18 || bh < r * 0.3) return { value: null, confidence: 0 }
    if (bw > r * 1.55 || bh > r * 1.75) return { value: null, confidence: 0 }

    const grid = normalizeDensity(data, w, minX, minY, maxX, maxY, 150)
    const aspect = bw / bh
    let bestDigit: number | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const tpl of templates) {
      const score = gridDistance(grid, tpl.grid) + Math.abs(aspect - tpl.aspect) * 0.18
      if (score < bestScore) {
        bestScore = score
        bestDigit = tpl.digit
      }
    }
    const confidence = Math.max(0, Math.min(1, 1 - bestScore / 0.5))
    return { value: bestDigit, confidence }
  })
}


export function mountImageImport(root: HTMLElement, host: ImageImportHost): void {
  root.innerHTML = `
    <div class="import-head">
      <h2>从图片导入</h2>
      <button class="btn" id="import-close" type="button">关闭</button>
    </div>
    <div class="import-row">
      <input type="file" id="import-file" accept="image/*" />
      <label class="import-name">名称 <input id="import-name" type="text" placeholder="自动命名" /></label>
    </div>
    <div class="import-hint">
      选一张题目截图，工具会自动找出圆点岛，并尝试读出圆内的数字（1-8）。
      自动识别会先填高置信度的数字；没读出的点岛后按 <kbd>1</kbd>-<kbd>8</kbd> 补填，
      <kbd>Backspace</kbd> 清除，方向键换岛。原始数字仍显示在图上，方便核对。
    </div>
    <div class="import-stage" id="import-stage" hidden>
      <canvas id="import-canvas"></canvas>
      <svg class="import-overlay" id="import-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
    <div class="import-keypad" id="import-keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8].map((d) => `<button type="button" data-digit="${d}">${d}</button>`).join('')}
      <button type="button" data-digit="0">清除</button>
    </div>
    <div class="import-info" id="import-info">还没有图片。</div>
    <div class="toolbar">
      <button class="btn" id="import-redetect" type="button">重新识别</button>
      <button class="btn primary" id="import-save" type="button">保存到题库并载入</button>
    </div>
    <div class="import-msg" id="import-msg"></div>
  `

  const canvas = document.getElementById('import-canvas') as HTMLCanvasElement
  const overlay = document.getElementById('import-overlay') as unknown as SVGSVGElement
  const stage = document.getElementById('import-stage') as HTMLElement
  const info = document.getElementById('import-info') as HTMLElement
  const nameInput = document.getElementById('import-name') as HTMLInputElement
  const fileInput = document.getElementById('import-file') as HTMLInputElement

  let islands: Island[] = []
  let width = 0
  let height = 0
  let selected = -1
  let puzzleId = ''
  let sourceImage: HTMLImageElement | null = null
  let objectUrl: string | null = null
  let fileBaseName = ''

  function render(): void {
    overlay.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`)
    const parts: string[] = []
    islands.forEach((island, i) => {
      const cls = i === selected ? ' selected' : ''
      parts.push(
        `<circle class="import-ring${cls}" data-i="${i}" cx="${island.x.toFixed(1)}" cy="${island.y.toFixed(1)}" r="${(island.r + 1.5).toFixed(1)}" />`,
      )
      if (island.value != null) {
        const bx = island.x + island.r * 0.95
        const by = island.y - island.r * 0.95
        const br = Math.max(7, island.r * 0.5)
        parts.push(
          `<circle class="import-badge-bg" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${br.toFixed(1)}" />`,
          `<text class="import-badge" x="${bx.toFixed(1)}" y="${(by + br * 0.08).toFixed(1)}" style="font-size:${(br * 1.2).toFixed(1)}px">${island.value}</text>`,
        )
      }
    })
    overlay.innerHTML = parts.join('')
    overlay.querySelectorAll<SVGCircleElement>('.import-ring').forEach((el) => {
      el.addEventListener('click', () => {
        selected = Number(el.dataset.i)
        render()
      })
    })
    const filled = islands.filter((x) => x.value != null).length
    const current = islands[selected]
    const where = current ? ` · 当前第 ${current.row + 1} 行第 ${current.col + 1} 列` : ''
    info.textContent = `识别到 ${islands.length} 个岛 · 网格 ${width}×${height} · 已填 ${filled}/${islands.length}${where}`
  }

  function detect(image: HTMLImageElement): void {
    const result = detectIslandBoard(canvas, image)
    sourceImage = image
    stage.hidden = false
    if (!result.board) {
      islands = []
      info.textContent = result.error ?? '识别失败'
      host.message(`识别失败：${result.error ?? '没有找到圆形岛'}`, 'bad')
      return
    }

    islands = result.board.islands.map((island) => ({ ...island }))
    width = result.board.width
    height = result.board.height

    // 圆内数字自动识别：只自动填高置信度的，其余留给使用者点岛补填
    const guesses = recognizeIslandDigits(canvas, image, islands)
    let auto = 0
    islands.forEach((island, i) => {
      const guess = guesses[i]
      if (!guess || guess.value == null) return
      island.confidence = guess.confidence
      if (guess.confidence >= 0.3) {
        island.value = guess.value
        auto++
      }
    })

    selected = 0
    puzzleId = `hashi-custom-image-${Date.now()}`
    if (!nameInput.value.trim()) {
      nameInput.value = fileBaseName
        ? `${fileBaseName} · ${width}×${height}`
        : `图片导入 · ${width}×${height}`
    }
    stage.hidden = false
    render()
    host.message(
      `识别完成：${islands.length} 个岛，${width}×${height}，自动读出 ${auto} 个数字` +
        `（其余请点岛补填）。`,
      'ok',
    )
  }

  function setDigit(value: number | null): void {
    const island = islands[selected]
    if (!island) return
    island.value = value
    if (value != null) {
      const next = islands.findIndex((item, i) => i > selected && item.value == null)
      if (next >= 0) selected = next
      else {
        const wrap = islands.findIndex((item) => item.value == null)
        if (wrap >= 0) selected = wrap
      }
    }
    render()
  }

  function moveSelection(delta: number): void {
    if (!islands.length) return
    selected = (selected + delta + islands.length) % islands.length
    render()
  }

  function save(): void {
    if (!islands.length) {
      host.message('请先选择图片并识别岛。', 'bad')
      return
    }
    const missing = islands.filter((item) => item.value == null).length
    if (missing) {
      host.message(`还有 ${missing} 个岛没有填数字。`, 'bad')
      return
    }
    if (width > MAX_CUSTOM_SIZE || height > MAX_CUSTOM_SIZE) {
      host.message(`题面超过最大尺寸 ${MAX_CUSTOM_SIZE}×${MAX_CUSTOM_SIZE}。`, 'bad')
      return
    }
    const cells = new Array<number>(width * height).fill(0)
    for (const island of islands) {
      cells[island.row * width + island.col] = island.value ?? 0
    }
    const puzzle: HashiPuzzle = {
      id: puzzleId,
      name: nameInput.value.trim() || `图片导入 · ${width}×${height}`,
      width,
      height,
      difficulty: 'custom',
      islands: cells,
    }
    host.loadPuzzle(puzzle)
    host.message('已保存到题库并载入（自定义题不检查唯一解）。', 'ok')
    host.close()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (root.closest('[hidden]')) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        host.close()
      }
      return
    }
    const key = e.key
    if (key >= '1' && key <= '8') {
      e.preventDefault()
      e.stopPropagation()
      setDigit(Number(key))
    } else if (key === '0' || key === 'Backspace' || key === 'Delete') {
      e.preventDefault()
      e.stopPropagation()
      setDigit(null)
    } else if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'Tab' || key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      moveSelection(1)
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      moveSelection(-1)
    } else if (key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      host.close()
    } else {
      // 面板打开时不要触发后面的游戏快捷键
      e.stopPropagation()
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = URL.createObjectURL(file)
    fileBaseName = file.name.replace(/\.[^.]+$/, '')
    nameInput.value = ''
    const image = new Image()
    image.onload = () => {
      fileInput.blur()
      detect(image)
    }
    image.onerror = () => {
      fileInput.blur()
      host.message('图片读取失败，请换一张试试。', 'bad')
    }
    image.src = objectUrl
  })

  document.getElementById('import-redetect')?.addEventListener('click', () => {
    if (!sourceImage) {
      host.message('请先选择图片。', 'bad')
      return
    }
    detect(sourceImage)
  })

  document.getElementById('import-close')?.addEventListener('click', () => host.close())
  document.getElementById('import-save')?.addEventListener('click', save)

  document.querySelectorAll<HTMLButtonElement>('#import-keypad button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = btn.dataset.digit
      setDigit(raw === '0' ? null : Number(raw))
    })
  })

  window.addEventListener('keydown', onKeyDown, true)
}

