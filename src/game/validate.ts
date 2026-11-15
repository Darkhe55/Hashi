/**
 * 搭桥 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { checkSolution } from './rules'
import {
  asHashiPuzzle,
  asHashiState,
  buildEdges,
  type HashiResult,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): HashiResult {
  const s = asHashiState(state)
  const p = asHashiPuzzle(puzzle)
  const edges = buildEdges(p.islands ?? [], p.width, p.height)
  const out = checkSolution(s.bridges, p.islands ?? [], edges)
  return {
    solved: out.ok,
    badCells: out.badCells,
    islandIssues: out.islandIssues,
    disconnected: out.disconnected,
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as HashiResult
  if (r.solved) return ['完成']
  const bits: string[] = []
  const overfilled = r.islandIssues.filter((x) => x.actual > x.expected).length
  if (overfilled > 0) bits.push(`${overfilled} 个岛桥太多`)
  if (r.islandIssues.length === 0 && r.disconnected) bits.push('还有岛未连通')
  if (bits.length === 0) {
    bits.push(
      r.islandIssues.length > 0 ? `还有 ${r.islandIssues.length} 个岛需要搭桥` : '继续搭桥',
    )
  }
  return bits
}
