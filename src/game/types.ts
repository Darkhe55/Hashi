/**
 * 搭桥（Hashi）—— 类型
 *
 * islands[i]：0 空格，1..8 岛屿数字。
 * bridges[e]：候选桥 0/1/2 座。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

/** 自定义题板最大边长 */
export const MAX_CUSTOM_SIZE = 120

export interface HashiPuzzle extends Puzzle {
  islands: number[]
  solutionBridges?: string
}

export interface HashiState extends GameState {
  bridges: number[]
}

export interface BridgeEdge {
  a: number
  b: number
  horizontal: boolean
  /** 桥经过的中间格（不含两端岛） */
  cells: number[]
}

export interface HashiResult extends ValidationResult {
  badCells: number[]
  islandIssues: Array<{ island: number; expected: number; actual: number }>
  disconnected: boolean
}

export function asHashiPuzzle(p: Puzzle): HashiPuzzle {
  return p as HashiPuzzle
}

export function asHashiState(s: GameState): HashiState {
  return s as HashiState
}

/** 建立候选桥：同行或同列、中间没有其他岛的成对岛屿 */
export function buildEdges(islands: ArrayLike<number>, w: number, h: number): BridgeEdge[] {
  const edges: BridgeEdge[] = []
  for (let y = 0; y < h; y++) {
    let prev = -1
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if ((islands[idx] ?? 0) === 0) continue
      if (prev >= 0) {
        const cells: number[] = []
        for (let cx = (prev % w) + 1; cx < x; cx++) cells.push(y * w + cx)
        edges.push({ a: prev, b: idx, horizontal: true, cells })
      }
      prev = idx
    }
  }
  for (let x = 0; x < w; x++) {
    let prev = -1
    for (let y = 0; y < h; y++) {
      const idx = y * w + x
      if ((islands[idx] ?? 0) === 0) continue
      if (prev >= 0) {
        const cells: number[] = []
        for (let cy = Math.floor(prev / w) + 1; cy < y; cy++) cells.push(cy * w + x)
        edges.push({ a: prev, b: idx, horizontal: false, cells })
      }
      prev = idx
    }
  }
  return edges
}

export function encodeIslands(islands: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < islands.length; i++) out += String(islands[i]! | 0)
  return out
}

export function decodeIslands(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const v = text.charCodeAt(i) - 48
    if (v < 0 || v > 8) return null
    out[i] = v
  }
  return out
}

export function encodeBridges(bridges: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < bridges.length; i++) out += String(Math.max(0, Math.min(2, bridges[i]! | 0)))
  return out
}

export function decodeBridges(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const v = text.charCodeAt(i) - 48
    if (v < 0 || v > 2) return null
    out[i] = v
  }
  return out
}

/** 每个岛关联的候选边 */
export function incidentEdges(edges: BridgeEdge[], size: number): number[][] {
  const out: number[][] = Array.from({ length: size }, () => [])
  for (let e = 0; e < edges.length; e++) {
    out[edges[e]!.a]!.push(e)
    out[edges[e]!.b]!.push(e)
  }
  return out
}
