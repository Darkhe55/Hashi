/**
 * 搭桥 —— SVG 渲染
 */

import { cellCenter, originOf, squareMetrics, cellSizeOf } from '../core/board'
import type {
  BoardMetrics,
  FrameEdgeHint,
  GameState,
  HitTarget,
  PlaybackFrame,
  Puzzle,
  ValidationResult,
} from '../core/types'
import {
  asHashiPuzzle,
  asHashiState,
  buildEdges,
  incidentEdges,
  type HashiPuzzle,
  type HashiResult,
} from './types'

export interface IslandBounds {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

/**
 * 回放时的候选约束提示：把「这条边至少 1 座 / 至多 1 座」画成
 * 实线 + 虚线 / 单虚线，玩家不用从文字里脑补隐藏的推理状态。
 */
interface ReplayOverlay {
  hints: FrameEdgeHint[]
  focus: number
}

let replayOverlay: ReplayOverlay | null = null

export function setReplayOverlay(frame: PlaybackFrame | null): void {
  if (!frame) {
    replayOverlay = null
    return
  }
  replayOverlay = { hints: frame.hints ?? [], focus: frame.focusIsland ?? -1 }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function ghostNote(min: number, max: number): string {
  if (min === max) return `确定为 ${min} 座`
  if (min >= 1 && max === 2) return '至少 1 座、可能 2 座'
  if (min === 0 && max === 1) return '至多 1 座（也可能不架）'
  return '尚未确定（0–2 座）'
}

/** 只围住真正有数字的岛；空格不参与留白计算 */
export function islandBounds(p: HashiPuzzle): IslandBounds | null {
  let minCol = Infinity
  let minRow = Infinity
  let maxCol = -1
  let maxRow = -1
  const cells = p.width * p.height
  for (let i = 0; i < cells; i++) {
    if ((p.islands?.[i] ?? 0) <= 0) continue
    const col = i % p.width
    const row = Math.floor(i / p.width)
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  if (maxCol < 0) return null
  return { minCol, minRow, maxCol, maxRow }
}

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const p = asHashiPuzzle(puzzle)
  const cell = 54
  const pad = 24
  const b = islandBounds(p)
  if (!b) return squareMetrics(p.width, p.height, { cell, pad })
  return squareMetrics(p.width, p.height, {
    cell,
    pad,
    padLeft: pad - b.minCol * cell,
    padTop: pad - b.minRow * cell,
    padRight: pad - (p.width - 1 - b.maxCol) * cell,
    padBottom: pad - (p.height - 1 - b.maxRow) * cell,
  })
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
): string {
  const p = asHashiPuzzle(puzzle)
  const s = asHashiState(state)
  const r = result as HashiResult
  const m = metricsFor(puzzle)
  const o = originOf(m)
  const { w: cw, h: ch } = cellSizeOf(m)
  const bad = new Set(r.badCells ?? [])
  const edges = buildEdges(p.islands ?? [], p.width, p.height)
  const incident = incidentEdges(edges, p.width * p.height)
  const parts: string[] = []
  const b = islandBounds(p)
  const rect = b
    ? {
        x: o.x + b.minCol * cw,
        y: o.y + b.minRow * ch,
        w: (b.maxCol - b.minCol + 1) * cw,
        h: (b.maxRow - b.minRow + 1) * ch,
      }
    : { x: o.x, y: o.y, w: cw * p.width, h: ch * p.height }
  const dotRadius = Math.max(0.9, cw * 0.016)

  parts.push(`<defs>
    <linearGradient id="hsBoardFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fffdf9" />
      <stop offset="100%" stop-color="#fbf5e9" />
    </linearGradient>
    <radialGradient id="hsIslandFill" cx="36%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#fffefb" />
      <stop offset="62%" stop-color="#f7eedb" />
      <stop offset="100%" stop-color="#ece0c6" />
    </radialGradient>
    <pattern id="hsDots" patternUnits="userSpaceOnUse" x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}">
      <circle cx="${(cw / 2).toFixed(2)}" cy="${(ch / 2).toFixed(2)}" r="${dotRadius.toFixed(2)}" fill="#cfc7b7" opacity="0.55" />
    </pattern>
  </defs>`)

  parts.push(
    `<rect class="hs-board-bg" x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${rect.w.toFixed(2)}" height="${rect.h.toFixed(2)}" rx="12" />`,
    `<rect class="hs-board-dots" x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${rect.w.toFixed(2)}" height="${rect.h.toFixed(2)}" rx="12" fill="url(#hsDots)" />`,
  )

  // 桥：每条候选桥一个分组，自带命中区与悬停提示
  const hintByEdge = new Map<number, FrameEdgeHint>()
  if (replayOverlay) for (const h of replayOverlay.hints) hintByEdge.set(h.edge, h)
  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e]!
    const count = s.bridges[e] ?? 0
    const ca = cellCenter(m, edge.a)
    const cb = cellCenter(m, edge.b)
    const dx = cb.x - ca.x
    const dy = cb.y - ca.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const nx = -uy
    const ny = ux
    const offsets = count === 2 ? [-cw * 0.095, cw * 0.095] : [0]

    parts.push(`<g class="hs-edge" data-edge="${e}" data-count="${count}">`)
    if (count > 0) {
      for (const off of offsets) {
        const x1 = ca.x + nx * off
        const y1 = ca.y + ny * off
        const x2 = cb.x + nx * off
        const y2 = cb.y + ny * off
        parts.push(
          `<line class="hs-bridge-halo" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`,
          `<line class="hs-bridge" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`,
        )
      }
    }

    if (count === 0) {
      parts.push(
        `<line class="hs-hint hs-hint-empty" x1="${ca.x.toFixed(2)}" y1="${ca.y.toFixed(2)}" x2="${cb.x.toFixed(2)}" y2="${cb.y.toFixed(2)}" />`,
      )
    } else if (count === 1) {
      parts.push(
        `<line class="hs-hint hs-hint-glow" x1="${ca.x.toFixed(2)}" y1="${ca.y.toFixed(2)}" x2="${cb.x.toFixed(2)}" y2="${cb.y.toFixed(2)}" />`,
      )
    } else {
      const mx = (ca.x + cb.x) / 2
      const my = (ca.y + cb.y) / 2
      const arm = cw * 0.16
      parts.push(
        `<g class="hs-hint hs-hint-double">`,
        `<line x1="${(mx - arm).toFixed(2)}" y1="${(my - arm).toFixed(2)}" x2="${(mx + arm).toFixed(2)}" y2="${(my + arm).toFixed(2)}" />`,
        `<line x1="${(mx - arm).toFixed(2)}" y1="${(my + arm).toFixed(2)}" x2="${(mx + arm).toFixed(2)}" y2="${(my - arm).toFixed(2)}" />`,
        `</g>`,
      )
    }

    // 命中区两端内缩，避免在岛心处抢到相邻边的悬停
    const inset = Math.min(cw * 0.3, len * 0.28)
    const hitWidth = Math.max(18, cw * 0.7)
    parts.push(
      `<line class="hs-edge-hit" x1="${(ca.x + ux * inset).toFixed(2)}" y1="${(ca.y + uy * inset).toFixed(2)}" x2="${(cb.x - ux * inset).toFixed(2)}" y2="${(cb.y - uy * inset).toFixed(2)}" stroke-width="${hitWidth.toFixed(2)}" />`,
    )
    parts.push(`</g>`)

    // 回放提示：把这条边的上下限画出来 ——
    // 至少 1 座 = 一条实线 + 一条虚线；至多 1 座 = 一条虚线。
    const hint = hintByEdge.get(e)
    if (hint) {
      const segs: Array<{ off: number; cls: string }> = []
      if (hint.min === hint.max) {
        const need = Math.max(0, hint.min - count)
        for (let k = 0; k < need; k++) {
          const off = hint.min === 2 ? (k === 0 ? -cw * 0.095 : cw * 0.095) : 0
          segs.push({ off, cls: 'hs-ghost-line' })
        }
      } else if (hint.min >= 1 && hint.max === 2) {
        if (count === 0) {
          segs.push(
            { off: -cw * 0.095, cls: 'hs-ghost-line' },
            { off: cw * 0.095, cls: 'hs-ghost-line hs-ghost-dash' },
          )
        } else if (count === 1) {
          segs.push({ off: cw * 0.095, cls: 'hs-ghost-line hs-ghost-dash' })
        }
      } else if (hint.min === 0 && hint.max === 1) {
        if (count === 0) segs.push({ off: 0, cls: 'hs-ghost-line hs-ghost-dash' })
      } else if (hint.min === 0 && hint.max === 2) {
        if (count === 0) segs.push({ off: 0, cls: 'hs-ghost-line hs-ghost-unknown' })
      }
      if (segs.length > 0) {
        const note = hint.note || ghostNote(hint.min, hint.max)
        parts.push(`<g class="hs-ghost" data-edge="${e}"><title>${escapeXml(note)}</title>`)
        for (const seg of segs) {
          const x1 = ca.x + nx * seg.off
          const y1 = ca.y + ny * seg.off
          const x2 = cb.x + nx * seg.off
          const y2 = cb.y + ny * seg.off
          parts.push(
            `<line class="${seg.cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`,
          )
        }
        parts.push(`</g>`)
      }
    }
  }

  // 岛：桥数已达标的岛自动变灰
  for (let i = 0; i < p.width * p.height; i++) {
    const clue = p.islands?.[i] ?? 0
    if (clue <= 0) continue
    let sum = 0
    for (const e of incident[i]!) sum += s.bridges[e] ?? 0
    const satisfied = sum === clue
    const cls = `${satisfied ? ' satisfied' : ''}${bad.has(i) ? ' bad' : ''}`
    const c = cellCenter(m, i)
    const rad = cw * 0.265
    parts.push(
      `<circle class="hs-island-shadow" cx="${c.x.toFixed(2)}" cy="${(c.y + cw * 0.035).toFixed(2)}" r="${rad.toFixed(2)}" />`,
      `<circle class="hs-island${cls}" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${rad.toFixed(2)}" />`,
      `<text class="hs-number${cls}" x="${c.x.toFixed(2)}" y="${(c.y + 1.5).toFixed(2)}" style="font-size:${(m.cell * 0.4).toFixed(2)}px">${clue}</text>`,
    )
    if (replayOverlay?.focus === i) {
      parts.push(
        `<circle class="hs-island-focus" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(rad + cw * 0.1).toFixed(2)}" />`,
      )
    }
  }

  return `<svg class="board-svg hs-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(m: BoardMetrics, puzzle: Puzzle, x: number, y: number): HitTarget | null {
  const p = asHashiPuzzle(puzzle)
  const edges = buildEdges(p.islands ?? [], p.width, p.height)
  const tolerance = m.cell * 0.35
  let best = -1
  let bestDist = Infinity
  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e]!
    const ca = cellCenter(m, edge.a)
    const cb = cellCenter(m, edge.b)
    const d = distToSegment(x, y, ca.x, ca.y, cb.x, cb.y)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
  }
  if (best < 0 || bestDist > tolerance) return null
  return { index: best, kind: 'edge' }
}
