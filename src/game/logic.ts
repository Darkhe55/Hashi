/**
 * 搭桥 —— 逻辑解题回放
 */

import type { GameState, LogicPlan, Move, PlaybackFrame, Puzzle } from '../core/types'
import { checkSolution, propagate, type SetDetail, type SetReason } from './rules'
import { findSolution } from './solver'
import {
  asHashiPuzzle,
  asHashiState,
  buildEdges,
  type HashiState,
} from './types'

type LogicReason = SetReason | 'search' | 'complete'

/** 一次回放里最多插入多少条「纯推理」帧（超出后只回放落子帧） */
const MAX_INFER_FRAMES = 160

function ruleFor(value: number, reason: LogicReason): number {
  if (reason === 'crossing') return 3
  if (reason === 'connectivity') return 4
  if (reason === 'search') return 8
  if (reason === 'complete') return 9
  return value > 0 ? 1 : 2
}

function labelFor(value: number, reason: LogicReason, detail?: SetDetail): string {
  if (reason === 'crossing') return '交叉封锁：与必须架的桥交叉，这条线不能架桥'
  if (reason === 'connectivity') {
    return value > 0 ? '连通必经：不架桥会把岛群断开，这条线必须架桥' : '连通必经：这条线不能架桥'
  }
  if (reason === 'search') return '回溯试探：该桥最终数量'
  if (reason === 'complete') return '补全：该桥最终数量'
  if (detail?.kind === 'max') {
    const parts = (detail.parts ?? []).join(' + ')
    return `上界凑满：需要 ${detail.clue} 座桥的岛，候选边上限 ${parts} = ${detail.sum} → 每条边取最大（这条 ${value} 座）`
  }
  if (detail?.kind === 'min') {
    const parts = (detail.parts ?? []).join(' + ')
    return `下界凑满：需要 ${detail.clue} 座桥的岛，候选边下限 ${parts} = ${detail.sum} → 每条边取最小（这条 ${value} 座）`
  }
  if (detail?.kind === 'range') {
    if (detail.clue !== undefined) {
      return `上下界：需要 ${detail.clue} 座桥的岛，这条边只能取 ${value} 座（其它取值会让该岛凑不满或超额）`
    }
    return '上下界：这条边只能取固定值'
  }
  return value > 0 ? '上下界：这个岛还需要桥' : '上下界：这条线已经不需要'
}

function inferLabel(min: number, max: number, reason: LogicReason, note: string): string {
  const suffix = note ? `（${note}）` : ''
  if (reason === 'crossing') return `域收窄：这条边不能架桥${suffix}`
  if (reason === 'connectivity') return `域收窄：这条边必须架桥${suffix}`
  if (max === 0) return `域排除：这条边不能架桥${suffix}`
  if (min >= 1 && max === 2) return `域收窄：这条边至少 ${min} 座${suffix}`
  if (min === 0 && max === 1) return `域收窄：这条边至多 ${max} 座${suffix}`
  return `域收窄：这条边只能取 ${min}–${max} 座${suffix}`
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asHashiPuzzle(puzzle)
  const s = asHashiState(initialState)
  const islands = p.islands ?? []
  const edges = buildEdges(islands, p.width, p.height)
  const total = edges.length
  const frames: PlaybackFrame[] = []
  const grid = new Array<number>(total).fill(-1)
  const touched = new Array<boolean>(total).fill(false)
  let streak = 0
  let inferCount = 0

  const onSet = (index: number, value: number, reason: LogicReason, detail?: SetDetail): void => {
    touched[index] = true
    if (grid[index] === value) return
    const from = s.bridges[index] ?? 0
    grid[index] = value
    if (from === value) return
    streak++
    const move: Move = { index, from, to: value }
    frames.push({
      rule: ruleFor(value, reason),
      label: labelFor(value, reason, detail),
      move,
      streak,
      hints: detail?.cands,
      focusIsland: detail?.island,
    })
  }

  const onInfer = (
    edge: number,
    min: number,
    max: number,
    reason: LogicReason,
    detail?: SetDetail,
  ): void => {
    // 大盘面推导步可能很多，超过上限后只回放落子帧，避免回放过长
    if (inferCount >= MAX_INFER_FRAMES) return
    inferCount++
    streak++
    const note = detail?.cands?.find((c) => c.edge === edge)?.note ?? ''
    frames.push({
      rule: reason === 'crossing' ? 3 : reason === 'connectivity' ? 4 : 5,
      kind: 'infer',
      label: inferLabel(min, max, reason, note),
      streak,
      hints: detail?.cands,
      focusIsland: detail?.island,
    })
  }

  if (
    !propagate(
      grid,
      islands,
      edges,
      (e, v, reason, detail) => onSet(e, v, reason ?? 'bounds', detail),
      onInfer,
    )
  ) {
    return { puzzleId: p.id, frames: [], finalState: null, ruleSteps: 0, saturated: false }
  }

  let saturated = true
  if (grid.some((v) => v === -1)) {
    saturated = false
    const solution = findSolution(islands, edges, 2_000_000)
    if (!solution) {
      return { puzzleId: p.id, frames: [], finalState: null, ruleSteps: 0, saturated: false }
    }
    for (let e = 0; e < total; e++) {
      if (grid[e] !== -1) continue
      onSet(e, solution[e]!, 'search')
    }
  }

  const bridges = grid.map((v) => (v > 0 ? v : 0))
  if (!checkSolution(bridges, islands, edges).ok) {
    return { puzzleId: p.id, frames: [], finalState: null, ruleSteps: 0, saturated: false }
  }
  for (let e = 0; e < total; e++) {
    if (touched[e]) continue
    const from = s.bridges[e] ?? 0
    if (bridges[e] === from) continue
    streak++
    frames.push({
      rule: 9,
      label: '补全：该桥最终数量',
      move: { index: e, from, to: bridges[e]! },
      streak,
    })
  }

  const finalState: HashiState = {
    puzzleId: s.puzzleId,
    width: p.width,
    height: p.height,
    bridges,
  }
  return { puzzleId: p.id, frames, finalState, ruleSteps: frames.length, saturated }
}
