/**
 * 通用自定义题板编辑器
 *
 * 支持四种模式（adapter.custom.mode）：
 *   cell    = 单元格填值（默认）
 *   region  = 单元格填区域号（外观同 cell，游戏自行解释）
 *   picture = 单元格画图案（外观同 cell）
 *   edge    = 编辑格子之间的边（水平/竖直边，索引顺序见 core/board.ts）
 *   none    = 不支持自定义题板
 *
 * 键盘录入约定（cell/region/picture）：
 *   数字键 0-9 由 adapter.custom.keyForDigit 决定含义；
 *   . / Backspace / Delete 清空；方向键移动；Enter/Tab 下一格；
 *   Home/End 行首/行尾；Esc 关闭。
 */

import type { GameAdapter, Puzzle } from './types'
import {
  edgeCount,
  horizontalEdgeIndex,
  verticalEdgeIndex,
} from './board'

export interface CustomHost {
  setStatus(text: string, tone?: 'ok' | 'bad' | 'solving' | ''): void
  message(text: string, tone?: string): void
  loadPuzzle(p: Puzzle): void
  savePuzzle(p: Puzzle): void
  solveCurrent(): void
  runLogic(): void
}

export class CustomEditor {
  private w = 5
  private h = 5
  private grid: Array<number | null> = []
  private edges: Array<number | null> = []
  private cursor = 0
  private adapter: GameAdapter
  private selectedEl: HTMLElement | null = null
  private cellGridBound = false
  private editingId: string | null = null
  private editingName: string | null = null

  constructor(adapter: GameAdapter, private host: CustomHost) {
    this.adapter = adapter
  }

  private mode(): 'cell' | 'region' | 'picture' | 'edge' | 'none' {
    return this.adapter.custom.mode ?? 'cell'
  }

  isOpen(): boolean {
    const panel = document.getElementById('custom-editor')
    return !!panel && !panel.hidden
  }

  close(): void {
    const panel = document.getElementById('custom-editor')
    if (panel) panel.hidden = true
  }

  // —— 单元格模式 ——

  private setCell(i: number, value: number | null): void {
    if (i < 0 || i >= this.grid.length) return
    this.grid[i] = value
    const btn = document.querySelector<HTMLButtonElement>(`.custom-cell[data-i="${i}"]`)
    if (!btn) return
    const cls = this.adapter.custom.cellClass?.(value) ?? ''
    btn.textContent = this.adapter.custom.cellLabel(value)
    btn.className = `custom-cell${cls ? ` ${cls}` : ''}${value === null ? ' empty' : ''}${i === this.cursor ? ' selected' : ''}`
  }

  private selectCell(i: number): void {
    const max = this.w * this.h
    if (max <= 0) return
    this.cursor = Math.max(0, Math.min(max - 1, i))
    this.selectedEl?.classList.remove('selected')
    const btn = document.querySelector<HTMLButtonElement>(`.custom-cell[data-i="${this.cursor}"]`)
    btn?.classList.add('selected')
    this.selectedEl = btn
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private moveCursor(dx: number, dy: number): void {
    const w = this.w
    const row = Math.floor(this.cursor / w)
    const col = this.cursor % w
    this.selectCell((row + dy) * w + (col + dx))
  }

  private readSize(): { w: number; h: number } {
    const wEl = document.getElementById('custom-w') as HTMLInputElement | null
    const hEl = document.getElementById('custom-h') as HTMLInputElement | null
    const meta = this.adapter.meta
    const w = Math.max(meta.customMinW, Math.min(meta.customMaxW, Number(wEl?.value) || 5))
    const h = Math.max(meta.customMinH, Math.min(meta.customMaxH, Number(hEl?.value) || 5))
    if (wEl) wEl.value = String(w)
    if (hEl) hEl.value = String(h)
    return { w, h }
  }

  // —— 边模式 ——

  private setEdge(e: number, value: number | null): void {
    if (e < 0 || e >= this.edges.length) return
    this.edges[e] = value
    const btn = document.querySelector<HTMLButtonElement>(`.custom-edge[data-edge="${e}"]`)
    if (!btn) return
    btn.textContent = this.adapter.custom.edgeLabel?.(value) ?? (value == null ? '' : String(value))
    btn.classList.toggle('empty', value === null)
    const cls = this.adapter.custom.edgeClass?.(value) ?? ''
    const dir = btn.dataset.dir === 'v' ? ' v' : ' h'
    btn.className = `custom-edge${dir}${cls ? ` ${cls}` : ''}${value === null ? ' empty' : ''}`
  }

  private renderEdgeGrid(): void {
    const grid = document.getElementById('custom-grid')
    if (!grid) return
    const { w, h } = this.readSize()
    this.w = w
    this.h = h
    const count = edgeCount(w, h)
    if (this.edges.length !== count) this.edges = new Array<number | null>(count).fill(null)

    const cycle = this.adapter.custom.edgeValueCycle ?? [null, 1]
    const label = (v: number | null) =>
      this.adapter.custom.edgeLabel?.(v) ?? (v == null ? '' : String(v))
    const cls = (v: number | null) => this.adapter.custom.edgeClass?.(v) ?? ''
    const edgeButton = (e: number, dir: 'h' | 'v'): string => {
      const v = this.edges[e] ?? null
      return `<button type="button" class="custom-edge ${dir}${cls(v) ? ` ${cls(v)}` : ''}${v == null ? ' empty' : ''}" data-edge="${e}" data-dir="${dir}">${label(v)}</button>`
    }

    const items: string[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        items.push(`<div class="custom-node"></div>`)
        if (x + 1 < w) items.push(edgeButton(horizontalEdgeIndex(w, x, y), 'h'))
      }
      if (y + 1 < h) {
        for (let x = 0; x < w; x++) {
          items.push(edgeButton(verticalEdgeIndex(w, h, x, y), 'v'))
          if (x + 1 < w) items.push(`<div class="custom-edge-space"></div>`)
        }
      }
    }

    grid.className = 'custom-grid custom-edge-grid'
    grid.style.gridTemplateColumns = `repeat(${2 * w - 1}, 28px)`
    grid.innerHTML = items.join('')
    grid.querySelectorAll<HTMLButtonElement>('.custom-edge').forEach((btn) => {
      btn.addEventListener('click', () => {
        const e = Number(btn.dataset.edge)
        const cur = this.edges[e] ?? null
        const pos = cycle.indexOf(cur)
        const next = cycle[(pos + 1) % cycle.length] ?? null
        this.setEdge(e, next)
      })
    })
    grid.tabIndex = 0
  }

  // —— 渲染 ——

  /** 大网格用事件委托，避免给上万个格子分别绑定监听 */
  private bindCellGrid(): void {
    if (this.cellGridBound) return
    const grid = document.getElementById('custom-grid')
    if (!grid) return
    this.cellGridBound = true
    grid.addEventListener('click', (event) => {
      if (this.mode() === 'edge') return
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.custom-cell')
      if (!target) return
      const i = Number(target.dataset.i)
      this.selectCell(i)
      const cur = this.grid[i] ?? null
      const cycle = this.adapter.custom.valueCycle
      const pos = cycle.indexOf(cur)
      const next = cycle[(pos + 1) % cycle.length] ?? null
      this.setCell(i, next)
    })
    grid.addEventListener('focusin', (event) => {
      if (this.mode() === 'edge') return
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.custom-cell')
      if (target) this.selectCell(Number(target.dataset.i))
    })
  }

  renderGrid(): void {
    const grid = document.getElementById('custom-grid')
    if (!grid) return
    if (this.mode() === 'edge') {
      this.renderEdgeGrid()
      return
    }

    const { w, h } = this.readSize()
    this.w = w
    this.h = h
    if (this.grid.length !== w * h) {
      this.grid = new Array<number | null>(w * h).fill(null)
    }
    const cellSize = w > 60 || h > 60 ? 14 : w > 30 || h > 30 ? 22 : 36
    const fontSize = Math.max(8, Math.round(cellSize * 0.42))
    grid.className = 'custom-grid'
    grid.style.setProperty('--custom-cell', `${cellSize}px`)
    grid.style.setProperty('--custom-cell-font', `${fontSize}px`)
    grid.style.gridTemplateColumns = `repeat(${w}, ${cellSize}px)`
    grid.innerHTML = this.grid
      .map((v, i) => {
        const label = this.adapter.custom.cellLabel(v)
        const cls = this.adapter.custom.cellClass?.(v) ?? ''
        const sel = i === this.cursor ? ' selected' : ''
        return `<button type="button" class="custom-cell${cls ? ` ${cls}` : ''}${v === null ? ' empty' : ''}${sel}" data-i="${i}">${label}</button>`
      })
      .join('')
    this.selectedEl = grid.querySelector<HTMLElement>(`.custom-cell[data-i="${this.cursor}"]`)
    this.bindCellGrid()
    grid.tabIndex = 0
  }

  open(): void {
    const panel = document.getElementById('custom-editor')
    if (!panel) return
    if (this.mode() === 'none') {
      this.host.message('本游戏暂不支持自定义题板。', 'bad')
      return
    }
    if (this.mode() === 'edge' && !this.adapter.custom.makePuzzleFromEdges) {
      this.host.message('本游戏的边模式缺少 makePuzzleFromEdges 实现。', 'bad')
      return
    }
    panel.hidden = false
    const wEl = document.getElementById('custom-w') as HTMLInputElement | null
    const hEl = document.getElementById('custom-h') as HTMLInputElement | null
    if (wEl) wEl.value = String(this.w)
    if (hEl) hEl.value = String(this.h)
    if (this.cursor >= this.w * this.h) this.cursor = 0
    this.renderGrid()
    const editing = this.editingId ? `正在编辑「${this.editingName ?? this.editingId}」。` : ''
    this.host.message(`${editing}键盘：方向键移动 · ${this.adapter.custom.hint}`)
    document.getElementById('custom-grid')?.focus()
  }

  /** 把已保存的自定义题读回编辑器；保存时覆盖原 id */
  edit(p: Puzzle): void {
    const toGrid = this.adapter.custom.toGrid
    if (!toGrid) {
      this.host.message('本游戏不支持编辑自定义题。', 'bad')
      return
    }
    const restored = toGrid(p)
    if (!restored) {
      this.host.message('无法还原这道题的题面。', 'bad')
      return
    }
    const meta = this.adapter.meta
    if (restored.width > meta.customMaxW || restored.height > meta.customMaxH) {
      this.host.message(`题面超过最大尺寸 ${meta.customMaxW}×${meta.customMaxH}。`, 'bad')
      return
    }
    this.w = restored.width
    this.h = restored.height
    this.grid = restored.grid.slice()
    this.cursor = 0
    this.editingId = p.id
    this.editingName = p.name
    const panel = document.getElementById('custom-editor')
    if (panel) panel.hidden = false
    const wEl = document.getElementById('custom-w') as HTMLInputElement | null
    const hEl = document.getElementById('custom-h') as HTMLInputElement | null
    if (wEl) wEl.value = String(this.w)
    if (hEl) hEl.value = String(this.h)
    this.renderGrid()
    this.host.message(`正在编辑「${p.name}」。保存会覆盖原题。`, 'ok')
    panel?.scrollIntoView({ block: 'nearest' })
    document.getElementById('custom-grid')?.focus()
  }

  /** 从粘贴文本填充编辑器，不自动保存 */
  importText(text: string): void {
    const parse = this.adapter.custom.parseText
    if (!parse) {
      this.host.message('本游戏不支持文本导入。', 'bad')
      return
    }
    const parsed = parse(text)
    if (!parsed) {
      this.host.message(
        `文本格式不对：每行用 0-8（0 / . / 空格为空），最多 ${this.adapter.meta.customMaxW}×${this.adapter.meta.customMaxH}。`,
        'bad',
      )
      return
    }
    this.w = parsed.width
    this.h = parsed.height
    this.grid = parsed.grid.slice()
    this.cursor = 0
    const wEl = document.getElementById('custom-w') as HTMLInputElement | null
    const hEl = document.getElementById('custom-h') as HTMLInputElement | null
    if (wEl) wEl.value = String(this.w)
    if (hEl) hEl.value = String(this.h)
    this.renderGrid()
    this.host.message(`已从文本导入 ${this.w}×${this.h}，确认后点「载入题板」或「保存到题库」。`, 'ok')
    document.getElementById('custom-grid')?.focus()
  }

  /** 删除题库条目时清掉编辑态 */
  clearEditing(id?: string): void {
    if (id && this.editingId !== id) return
    this.editingId = null
    this.editingName = null
  }

  regen(): void {
    this.editingId = null
    this.editingName = null
    const { w, h } = this.readSize()
    this.w = w
    this.h = h
    if (this.mode() === 'edge') {
      this.edges = new Array<number | null>(edgeCount(w, h)).fill(null)
      this.renderEdgeGrid()
    } else {
      this.grid = new Array<number | null>(w * h).fill(null)
      this.cursor = 0
      this.renderGrid()
    }
    this.host.message(`已生成 ${w}×${h} 新网格。${this.adapter.custom.hint}`)
    document.getElementById('custom-grid')?.focus()
  }

  // —— 键盘 ——

  /** 返回 true 表示已消费该按键（编辑器打开时优先处理） */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen()) return false
    const mode = this.mode()
    if (mode === 'edge') {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
        return true
      }
      return false
    }

    const k = e.key
    if (k >= '0' && k <= '9') {
      const value = this.adapter.custom.keyForDigit(Number(k))
      if (value !== undefined) {
        e.preventDefault()
        this.setCell(this.cursor, value)
        this.moveCursor(1, 0)
        return true
      }
    }
    if (k === '.' || k === 'Backspace' || k === 'Delete' || k === ' ') {
      e.preventDefault()
      this.setCell(this.cursor, null)
      if (k === 'Backspace') this.moveCursor(-1, 0)
      else this.moveCursor(1, 0)
      return true
    }
    if (k === 'ArrowLeft') {
      e.preventDefault()
      this.moveCursor(-1, 0)
      return true
    }
    if (k === 'ArrowRight') {
      e.preventDefault()
      this.moveCursor(1, 0)
      return true
    }
    if (k === 'ArrowUp') {
      e.preventDefault()
      this.moveCursor(0, -1)
      return true
    }
    if (k === 'ArrowDown') {
      e.preventDefault()
      this.moveCursor(0, 1)
      return true
    }
    if (k === 'Enter' || k === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) this.moveCursor(-1, 0)
      else this.moveCursor(1, 0)
      return true
    }
    if (k === 'Home') {
      e.preventDefault()
      this.selectCell(Math.floor(this.cursor / this.w) * this.w)
      return true
    }
    if (k === 'End') {
      e.preventDefault()
      this.selectCell(Math.floor(this.cursor / this.w) * this.w + this.w - 1)
      return true
    }
    if (k === 'Escape') {
      e.preventDefault()
      this.close()
      return true
    }
    return false
  }

  // —— 动作 ——

  private makePuzzle(existingId?: string): Puzzle | null {
    if (this.mode() === 'edge') {
      if (!this.adapter.custom.makePuzzleFromEdges) return null
      return this.adapter.custom.makePuzzleFromEdges(
        this.w,
        this.h,
        this.edges.slice(),
        existingId,
      )
    }
    return this.adapter.custom.makePuzzle(this.w, this.h, this.grid.slice(), existingId)
  }

  load(): void {
    const { w, h } = this.readSize()
    this.w = w
    this.h = h
    if (this.mode() === 'edge') {
      if (this.edges.length !== edgeCount(w, h)) {
        this.edges = new Array<number | null>(edgeCount(w, h)).fill(null)
        this.renderEdgeGrid()
        this.host.message('网格已重置，请先填好边。', 'bad')
        return
      }
    } else if (this.grid.length !== w * h) {
      this.grid = new Array<number | null>(w * h).fill(null)
      this.renderGrid()
      this.host.message('网格已重置，请先填好内容。', 'bad')
      return
    }
    const puzzle = this.makePuzzle(this.editingId ?? undefined)
    if (!puzzle) {
      this.host.message('无法从当前题板构造题目。', 'bad')
      return
    }
    if (this.editingName) puzzle.name = this.editingName
    this.editingId = puzzle.id
    this.editingName = puzzle.name
    this.host.loadPuzzle(puzzle)
  }

  save(): void {
    const { w, h } = this.readSize()
    if (this.mode() === 'edge') {
      if (this.edges.length !== edgeCount(w, h)) {
        this.host.message('请先生成网格并填好边。', 'bad')
        return
      }
    } else if (this.grid.length !== w * h) {
      this.host.message('请先生成网格并填好内容。', 'bad')
      return
    }
    const isEditing = !!this.editingId
    const stamp = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const generated = `自定义 · ${w}×${h} · ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
    const puzzle = this.makePuzzle(this.editingId ?? undefined)
    if (!puzzle) {
      this.host.message('无法从当前题板构造题目。', 'bad')
      return
    }
    puzzle.name = this.editingName ?? generated
    this.host.savePuzzle(puzzle)
    this.editingId = puzzle.id
    this.editingName = puzzle.name
    this.host.message(`已${isEditing ? '更新' : '保存'}到题库：「${puzzle.name}」。`, 'ok')
  }

  solve(): void {
    this.host.solveCurrent()
  }

  logic(): void {
    this.close()
    this.host.runLogic()
  }
}
