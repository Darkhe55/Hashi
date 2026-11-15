/**
 * 搭桥 —— 从图片导入题目
 *
 * 思路：题目图片里的岛是深色空心圆。把图片画到 canvas，取暗色像素的
 * 连通块，筛出近正方形、空心（填充率低）的连通块作为岛。再由岛心坐标
 * 拟合行列间距，得到每个岛的 (col, row)。数字由使用者点击岛后按 1-8
 * 填写；自定义题允许任意输入，保存时不强制唯一解。
 */

import type { ImageImportHost } from '../core/types'
import { MAX_CUSTOM_SIZE, type HashiPuzzle } from './types'

interface Ring {
  x: number
  y: number
  r: number
}

interface Island extends Ring {
  col: number
  row: number
  value: number | null
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

function detectRings(canvas: HTMLCanvasElement, image: HTMLImageElement): Ring[] {
  const sw = image.naturalWidth
  const sh = image.naturalHeight
  if (!sw || !sh) return []
  const scale = Math.min(1, 1500 / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(image, 0, 0, w, h)

  const data = ctx.getImageData(0, 0, w, h).data
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
      选一张题目截图，工具会自动找出圆点岛。点击岛后按 <kbd>1</kbd>-<kbd>8</kbd> 填数字，
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
    const found = detectRings(canvas, image)
    sourceImage = image
    stage.hidden = false
    if (!found.length) {
      islands = []
      info.textContent = '没有识别到圆点岛。请换一张背景更干净、圆点更清晰的题目图片。'
      host.message('识别失败：没有找到圆形岛。', 'bad')
      return
    }

    const radius = median(found.map((r) => r.r))
    const xClusters = cluster(found.map((r) => r.x), radius * 0.45)
    const yClusters = cluster(found.map((r) => r.y), radius * 0.45)
    const lx = fitLattice(xClusters)
    const ly = fitLattice(yClusters)

    const raw = found.map((ring) => ({
      ...ring,
      col: lx.step > 0 ? Math.round((ring.x - lx.origin) / lx.step) : 0,
      row: ly.step > 0 ? Math.round((ring.y - ly.origin) / ly.step) : 0,
      value: null,
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
    islands = [...byCell.values()].sort((a, b) => a.row - b.row || a.col - b.col)
    width = maxCol - minCol + 1
    height = maxRow - minRow + 1
    selected = 0
    puzzleId = `hashi-custom-image-${Date.now()}`
    if (!nameInput.value.trim()) {
      nameInput.value = fileBaseName
        ? `${fileBaseName} · ${width}×${height}`
        : `图片导入 · ${width}×${height}`
    }
    stage.hidden = false
    render()
    host.message(`识别完成：${islands.length} 个岛，${width}×${height}。`, 'ok')
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
