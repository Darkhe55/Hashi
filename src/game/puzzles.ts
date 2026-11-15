/**
 * 搭桥 —— 题库
 */

import type { Difficulty, GameState, Puzzle } from '../core/types'
import { RAW_PUZZLES } from './puzzles-data'
import {
  buildEdges,
  decodeBridges,
  decodeIslands,
  type HashiPuzzle,
  type HashiState,
} from './types'

export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series?: string
  board: string
  solution?: string
}

export function decodePuzzle(raw: RawPuzzle): HashiPuzzle | null {
  const expected = raw.width * raw.height
  const islands = decodeIslands(raw.board, expected)
  if (!islands) return null
  return {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    islands,
    solutionBridges: raw.solution,
  }
}

export const builtinPuzzles: Puzzle[] = (RAW_PUZZLES as RawPuzzle[])
  .map(decodePuzzle)
  .filter((p): p is HashiPuzzle => p !== null)

export function getReferenceSolution(id: string): GameState | null {
  const raw = (RAW_PUZZLES as RawPuzzle[]).find((p) => p.id === id)
  if (!raw || typeof raw.solution !== 'string') return null
  const puzzle = decodePuzzle(raw)
  if (!puzzle) return null
  const edges = buildEdges(puzzle.islands, puzzle.width, puzzle.height)
  const bridges = decodeBridges(raw.solution, edges.length)
  if (!bridges) return null
  const state: HashiState = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    bridges,
  }
  return state
}
