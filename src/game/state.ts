/**
 * 搭桥 —— 状态
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asHashiPuzzle,
  asHashiState,
  buildEdges,
  decodeBridges,
  encodeBridges,
  type HashiState,
} from './types'

export function createEmptyState(puzzle: Puzzle): HashiState {
  const p = asHashiPuzzle(puzzle)
  const count = buildEdges(p.islands ?? [], p.width, p.height).length
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    bridges: new Array<number>(count).fill(0),
  }
}

export function cloneState(state: GameState): HashiState {
  const s = asHashiState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    bridges: s.bridges.slice(),
  }
}

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asHashiState(state)
  const v = s.bridges[target.index] ?? 0
  return v >= 2 ? 0 : v + 1
}

export function rightClickValue(): number {
  return 0
}

export function applyMove(state: GameState, move: Move): void {
  const s = asHashiState(state)
  if (move.index < 0 || move.index >= s.bridges.length) return
  s.bridges[move.index] = Math.max(0, Math.min(2, move.to | 0))
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asHashiState(state).bridges[index] ?? 0
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asHashiState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    edgeCount: s.bridges.length,
    bridges: encodeBridges(s.bridges),
  }
}

export function deserializeState(data: Record<string, unknown>): HashiState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  if (data.width < 2 || data.height < 2) return null
  const expected = typeof data.edgeCount === 'number' ? data.edgeCount : 0
  if (expected <= 0) return null
  const bridges = typeof data.bridges === 'string' ? decodeBridges(data.bridges, expected) : null
  if (!bridges) return null
  return { puzzleId: data.puzzleId, width: data.width, height: data.height, bridges }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asHashiState(state)
  const sol = asHashiState(solution)
  for (let i = 0; i < s.bridges.length; i++) {
    if ((s.bridges[i] ?? 0) !== (sol.bridges[i] ?? 0)) {
      return { index: i, from: s.bridges[i] ?? 0, to: sol.bridges[i] ?? 0 }
    }
  }
  return null
}
