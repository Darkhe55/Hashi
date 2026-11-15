/**
 * 搭桥 —— 回溯求解器
 */

import type { Puzzle, SolveResult } from '../core/types'
import { checkSolution, propagate } from './rules.ts'
import { buildEdges } from './types.ts'
import { incidentEdges, type BridgeEdge, type HashiPuzzle, type HashiState } from './types.ts'

export interface CountOutcome {
  count: number
  nodes: number
  timedOut: boolean
}

function search(
  islands: number[],
  edges: BridgeEdge[],
  limit: number,
  maxNodes: number,
): { solutions: number[][]; nodes: number; timedOut: boolean } {
  const vals = new Array<number>(edges.length).fill(-1)
  const incident = incidentEdges(edges, islands.length)
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false

  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    if (!propagate(vals, islands, edges)) return

    let target = -1
    let best = Infinity
    for (let i = 0; i < islands.length; i++) {
      const clue = islands[i] ?? 0
      if (clue <= 0) continue
      const unknown = incident[i]!.filter((e) => vals[e] === -1)
      if (!unknown.length) continue
      let sum = 0
      for (const e of incident[i]!) if (vals[e]! > 0) sum += vals[e]!
      if (clue - sum <= 0) continue
      if (unknown.length < best) {
        best = unknown.length
        target = unknown[0]!
      }
    }
    if (target < 0) {
      for (let e = 0; e < edges.length; e++) {
        if (vals[e] === -1) {
          target = e
          break
        }
      }
    }
    if (target < 0) {
      const out = vals.map((v) => (v > 0 ? v : 0))
      if (checkSolution(out, islands, edges).ok) solutions.push(out)
      return
    }

    for (const value of [2, 1, 0]) {
      const backup = vals.slice()
      vals[target] = value
      dfs()
      for (let e = 0; e < edges.length; e++) vals[e] = backup[e]!
      if (solutions.length >= limit || timedOut) break
    }
  }

  dfs()
  return { solutions, nodes, timedOut }
}

export function countSolutions(
  islands: number[],
  edges: BridgeEdge[],
  limit = 2,
  maxNodes = 500_000,
): CountOutcome {
  const out = search(islands, edges, limit, maxNodes)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}

export function findSolution(
  islands: number[],
  edges: BridgeEdge[],
  maxNodes = 2_000_000,
): number[] | null {
  const out = search(islands, edges, 1, maxNodes)
  return out.solutions[0] ?? null
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = puzzle as HashiPuzzle
  if (!p.islands || p.islands.length !== p.width * p.height) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const edges = buildEdges(p.islands, p.width, p.height)
  const out = search(p.islands, edges, 1, maxNodes)
  const bridges = out.solutions[0]
  if (!bridges) return { solved: false, solution: null, nodes: out.nodes, timedOut: out.timedOut }
  return { solved: true, solution: makeState(p, bridges), nodes: out.nodes, timedOut: out.timedOut }
}

export function makeState(puzzle: HashiPuzzle, bridges: number[]): HashiState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    bridges: bridges.map((v) => Math.max(0, Math.min(2, v | 0))),
  }
}
