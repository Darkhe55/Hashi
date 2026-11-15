/**
 * ════════════════════════════════════════════════════════════════════
 *  搭桥（Hashi）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态：每条候选桥 0/1/2 座。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { mountImageImport } from './image-import'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard, setReplayOverlay } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  decodeIslands,
  encodeIslands,
  MAX_CUSTOM_SIZE,
  type HashiPuzzle,
} from './types'

const meta = {
  title: '搭桥',
  tagline: '在岛屿之间架桥，使每个岛的数字等于桥数，且所有岛连成一体',
  footerNote:
    '规则：在同行或同列的两个岛之间架直线桥，桥不能穿过其他岛；两岛之间最多两座桥；桥不能交叉。每个岛的数字等于与它相连的桥数；所有岛必须连成一个整体。点击两个岛之间的线切换 0 / 1 / 2 座桥。',
  storageKeyPrefix: 'hashi',
  customIdPrefix: 'hashi-custom-',
  customMinW: 2,
  customMinH: 2,
  customMaxW: MAX_CUSTOM_SIZE,
  customMaxH: MAX_CUSTOM_SIZE,
  targetKind: 'edge' as const,
  interactionHint: '点击两个岛之间的连线段切换 0 / 1 / 2 座桥；右键清除。',
}

/** 文本导入：每行一格，0 / . / 空格为空，1-8 为岛 */
function parseCustomText(
  text: string,
): { width: number; height: number; grid: Array<number | null> } | null {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (!lines.length) return null
  const width = Math.max(0, ...lines.map((line) => line.length))
  const height = lines.length
  if (width < 2 || height < 2 || width > MAX_CUSTOM_SIZE || height > MAX_CUSTOM_SIZE) {
    return null
  }
  const grid = new Array<number | null>(width * height).fill(null)
  for (let y = 0; y < height; y++) {
    const line = lines[y]!
    for (let x = 0; x < line.length; x++) {
      const ch = line[x]!
      if (ch === '0' || ch === '.' || ch === '_' || ch === ' ') continue
      if (ch < '1' || ch > '8') return null
      grid[y * width + x] = Number(ch)
    }
  }
  return { width, height, grid }
}

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: [null, 1, 2, 3, 4, 5, 6, 7, 8],
  keyForDigit: (digit) => (digit === 0 ? null : digit >= 1 && digit <= 8 ? digit : undefined),
  cellLabel: (v) => (v == null ? '' : String(v)),
  hint: '点击循环：空 → 1 → … → 8；键盘 1-8 填岛，0 / Backspace 清空。保存不要求唯一解。',
  parseText: parseCustomText,
  toGrid: (p) => {
    const hp = p as HashiPuzzle
    if (!hp.islands || hp.islands.length !== hp.width * hp.height) return null
    return {
      width: hp.width,
      height: hp.height,
      grid: Array.from(hp.islands, (v) => (v > 0 ? v : null)),
    }
  },
  makePuzzle: (w, h, grid, existingId) => {
    const islands = new Array<number>(w * h).fill(0)
    for (let i = 0; i < islands.length && i < grid.length; i++) {
      const v = grid[i]
      islands[i] = v == null ? 0 : Math.max(0, Math.min(8, v))
    }
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      islands,
    } satisfies HashiPuzzle
  },
  encodePuzzle: (p) => {
    const hp = p as HashiPuzzle
    return { board: encodeIslands(hp.islands ?? []) }
  },
  decodePuzzle: (record) => {
    const width = typeof record.width === 'number' ? record.width : 0
    const height = typeof record.height === 'number' ? record.height : 0
    const board = typeof record.board === 'string' ? record.board : ''
    if (width < 2 || height < 2) return null
    if (width > MAX_CUSTOM_SIZE || height > MAX_CUSTOM_SIZE) return null
    const islands = decodeIslands(board, width * height)
    if (!islands) return null
    const puzzle: HashiPuzzle = {
      id: typeof record.id === 'string' ? record.id : '',
      name: typeof record.name === 'string' ? record.name : `图片导入 · ${width}×${height}`,
      width,
      height,
      difficulty: 'custom',
      islands,
    }
    return puzzle
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.to === 0) playDrop(streak)
  else playPluck(streak, 0.8 + move.to * 0.2)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  imageImport: {
    label: '图片导入',
    open: (panel, host) => mountImageImport(panel, host),
  },
  playForMove,
  onReplayFrame: setReplayOverlay,
}
