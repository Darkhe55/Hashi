/**
 * 搭桥 —— 规则传播与校验
 */

import { incidentEdges, type BridgeEdge } from './types.ts'
import type { FrameEdgeHint } from '../core/types'

export type SetReason = 'bounds' | 'crossing' | 'connectivity'

/** 回放用的推理细节：让「上下界」步骤能说清为什么这条边必须是这个值 */
export interface SetDetail {
  kind: 'min' | 'max' | 'range' | 'crossing' | 'connectivity' | 'final'
  /** 触发这条推理的岛（格子下标）与它的数字 */
  island?: number
  clue?: number
  /** min：各候选边最小值之和；max：各候选边最大值之和 */
  sum?: number
  /** min：各候选边的最小值；max：各候选边的最大值 */
  parts?: number[]
  /** 与 parts 对应：每条边的取值上下限是被哪个岛限制的（用于回放解释） */
  partNotes?: string[]
  /** 这条边最终取到的值 */
  value?: number
  /** 触发岛上各候选边的当前上下限（回放时画成实线/虚线提示） */
  cands?: FrameEdgeHint[]
}

export type SetCallback = (edge: number, value: number, reason?: SetReason, detail?: SetDetail) => void

/** 只收窄取值域、尚未落子的推导回调（回放里作为「推理」帧展示） */
export type NarrowCallback = (
  edge: number,
  min: number,
  max: number,
  reason: SetReason,
  detail?: SetDetail,
) => void

const ALL_VALUES = 7
const isSingleton = (mask: number): boolean => mask === 1 || mask === 2 || mask === 4
const onlyValue = (mask: number): number => (mask === 1 ? 0 : mask === 2 ? 1 : 2)
const minValue = (mask: number): number => (mask & 1 ? 0 : mask & 2 ? 1 : 2)
const maxValue = (mask: number): number => (mask & 4 ? 2 : mask & 2 ? 1 : 0)

/**
 * 确定性传播。
 *
 * 每条候选桥维护 {0,1,2} 的取值域，反复做：
 * 1. 单岛度数上下界 / 唯一剩余边；
 * 2. 交叉封锁：必须为正的桥会封死所有与它交叉的边；
 * 3. 连通必经：候选图里的桥边必须为正。
 */
export function propagate(
  bridges: number[],
  islands: ArrayLike<number>,
  edges: BridgeEdge[],
  onSet?: SetCallback,
  onNarrow?: NarrowCallback,
): boolean {
  const total = edges.length
  const incident = incidentEdges(edges, islands.length)
  const dom = new Uint8Array(total)
  for (let e = 0; e < total; e++) {
    const v = bridges[e] ?? -1
    if (v === -1) dom[e] = ALL_VALUES
    else if (v === 0) dom[e] = 1
    else if (v === 1) dom[e] = 2
    else if (v === 2) dom[e] = 4
    else return false
  }

  let changed = true

  // 记录「这条边的上限 / 下限」是被哪个岛、用什么理由卡住的，方便回放解释
  const capNote: Array<string | null> = new Array(total).fill(null)
  const floorNote: Array<string | null> = new Array(total).fill(null)

  const commit = (e: number, reason: SetReason, detail?: SetDetail): boolean => {
    const mask = dom[e]!
    if (!isSingleton(mask)) return true
    const v = onlyValue(mask)
    const cur = bridges[e] ?? -1
    if (cur === -1) {
      // 先回调再写入，回放才能拿到「改之前」的值
      onSet?.(e, v, reason, detail)
      bridges[e] = v
      return true
    }
    return cur === v
  }

  const narrow = (e: number, mask: number, reason: SetReason, detail?: SetDetail): boolean => {
    const next = dom[e]! & mask
    if (next === 0) return false
    if (next === dom[e]) return true
    dom[e] = next
    changed = true
    if (!isSingleton(next)) {
      // 只收窄、还没确定数值：作为「推理」帧按顺序插入，让玩家先看到这一步
      const cands = detail?.cands?.map((c) =>
        c.edge === e
          ? {
              ...c,
              min: minValue(next),
              max: maxValue(next),
              note: capNote[e] ?? floorNote[e] ?? c.note,
            }
          : c,
      )
      const nextDetail: SetDetail | undefined = detail ? { ...detail } : undefined
      if (nextDetail && cands) nextDetail.cands = cands
      onNarrow?.(e, minValue(next), maxValue(next), reason, nextDetail)
    }
    return commit(e, reason, detail)
  }

  const edgeHint = (e: number): FrameEdgeHint => ({
    edge: e,
    min: minValue(dom[e]!),
    max: maxValue(dom[e]!),
    note: capNote[e] ?? floorNote[e] ?? '',
  })

  while (changed) {
    changed = false

    // 1) 单岛取值域传播
    for (let i = 0; i < islands.length; i++) {
      const clue = islands[i] ?? 0
      if (clue <= 0) continue
      const es = incident[i]!
      let minSum = 0
      let maxSum = 0
      for (const e of es) {
        minSum += minValue(dom[e]!)
        maxSum += maxValue(dom[e]!)
      }
      if (clue < minSum || clue > maxSum) return false
      if (clue === minSum) {
        const parts = es.map((e) => minValue(dom[e]!))
        const partNotes = es.map((e) => floorNote[e] ?? '')
        const cands = es.map((e) => edgeHint(e))
        for (let k = 0; k < es.length; k++) {
          const e = es[k]!
          if (
            !narrow(e, 1 << parts[k]!, 'bounds', {
              kind: 'min',
              island: i,
              clue,
              sum: minSum,
              parts,
              partNotes,
              cands,
              value: parts[k],
            })
          ) {
            return false
          }
        }
      }
      if (clue === maxSum) {
        const parts = es.map((e) => maxValue(dom[e]!))
        const partNotes = es.map((e, k) =>
          parts[k] === 0 ? '这条不能架桥' : (capNote[e] ?? ''),
        )
        const cands = es.map((e) => edgeHint(e))
        for (let k = 0; k < es.length; k++) {
          const e = es[k]!
          if (
            !narrow(e, 1 << parts[k]!, 'bounds', {
              kind: 'max',
              island: i,
              clue,
              sum: maxSum,
              parts,
              partNotes,
              cands,
              value: parts[k],
            })
          ) {
            return false
          }
        }
      }
      for (const e of es) {
        const d = dom[e]!
        const otherMin = minSum - minValue(d)
        const otherMax = maxSum - maxValue(d)
        let keep = 0
        if ((d & 1) !== 0 && otherMin <= clue && otherMax >= clue) keep |= 1
        if ((d & 2) !== 0 && 1 + otherMin <= clue && 1 + otherMax >= clue) keep |= 2
        if ((d & 4) !== 0 && 2 + otherMin <= clue && 2 + otherMax >= clue) keep |= 4
        if (keep === 0) return false
        // 记录上下限被哪个岛卡住、为什么（取最紧的一次），用于回放解释。
        // 不在这里递归拼接其它边的来历——推导顺序本身就是一条单独的「推理」帧。
        const maxBefore = maxValue(d)
        const maxAfter = maxValue(keep)
        if (maxAfter < maxBefore) {
          if (maxAfter === 0) {
            capNote[e] = `数字 ${clue} 的岛其它候选边最少已占 ${otherMin} 座，这条再架桥就超过 ${clue} 座`
          } else if (otherMin > 0) {
            capNote[e] = `数字 ${clue} 的岛其它候选边已至少 ${otherMin} 座，再加 2 座会超过 ${clue}`
          } else {
            capNote[e] = `数字 ${clue} 的岛：2 座就超过它需要的 ${clue} 座`
          }
        }
        const minBefore = minValue(d)
        const minAfter = minValue(keep)
        if (minAfter > minBefore) {
          floorNote[e] =
            clue > otherMax
              ? `数字 ${clue} 的岛其它候选边最多 ${otherMax} 座，还差 ${clue - otherMax} 座 → 这条至少 ${minAfter} 座`
              : `数字 ${clue} 的岛：这条不能为 0`
        }
        const cands = es.map((x) =>
          x === e
            ? {
                edge: x,
                min: minValue(keep),
                max: maxValue(keep),
                note: capNote[x] ?? floorNote[x] ?? '',
              }
            : edgeHint(x),
        )
        if (
          !narrow(e, keep, 'bounds', {
            kind: 'range',
            island: i,
            clue,
            value: isSingleton(keep) ? onlyValue(keep) : undefined,
            cands,
          })
        ) {
          return false
        }
      }
    }

    // 2) 交叉封锁
    const cellH = new Map<number, number[]>()
    const cellV = new Map<number, number[]>()
    for (let e = 0; e < total; e++) {
      const edge = edges[e]!
      const target = edge.horizontal ? cellH : cellV
      for (const c of edge.cells) {
        let list = target.get(c)
        if (!list) {
          list = []
          target.set(c, list)
        }
        list.push(e)
      }
    }
    for (const [cell, hs] of cellH) {
      const vs = cellV.get(cell)
      if (!vs) continue
      for (const h of hs) {
        for (const v of vs) {
          const hMust = (dom[h]! & 1) === 0
          const vMust = (dom[v]! & 1) === 0
          if (hMust && vMust) return false
          if (hMust && !narrow(v, 1, 'crossing', { kind: 'crossing', value: 0 })) return false
          if (vMust && !narrow(h, 1, 'crossing', { kind: 'crossing', value: 0 })) return false
        }
      }
    }

    // 3) 连通性：候选图必须连通，桥边必须为正
    const { bridges: cutEdges, components } = findCutEdges(dom, islands, edges)
    if (components > 1) return false
    for (const e of cutEdges) {
      if (!narrow(e, 6, 'connectivity', { kind: 'connectivity' })) return false
    }
  }

  for (let e = 0; e < total; e++) {
    if (dom[e] === 0) return false
    if (isSingleton(dom[e]!)) {
      if (!commit(e, 'bounds', { kind: 'final', value: onlyValue(dom[e]!) })) return false
    }
  }
  return true
}

/** 候选图上「删掉就会断开」的边；这些边在最终解里必须为正 */
function findCutEdges(
  dom: Uint8Array,
  islands: ArrayLike<number>,
  edges: BridgeEdge[],
): { bridges: number[]; components: number } {
  const n = islands.length
  const adj: Array<Array<[number, number]>> = Array.from({ length: n }, () => [])
  for (let e = 0; e < edges.length; e++) {
    if ((dom[e]! & 6) === 0) continue
    const edge = edges[e]!
    adj[edge.a]!.push([edge.b, e])
    adj[edge.b]!.push([edge.a, e])
  }

  const disc = new Int32Array(n).fill(-1)
  const low = new Int32Array(n)
  const parentEdge = new Int32Array(n).fill(-1)
  const cutEdges: number[] = []
  let timer = 0
  let components = 0

  for (let start = 0; start < n; start++) {
    if ((islands[start] ?? 0) <= 0 || disc[start] !== -1) continue
    components++
    disc[start] = low[start] = timer++
    const stack: Array<{ u: number; index: number }> = [{ u: start, index: 0 }]
    while (stack.length) {
      const frame = stack[stack.length - 1]!
      const u = frame.u
      const list = adj[u]!
      if (frame.index < list.length) {
        const [v, e] = list[frame.index]!
        frame.index++
        if (e === parentEdge[u]) continue
        if (disc[v] === -1) {
          disc[v] = low[v] = timer++
          parentEdge[v] = e
          stack.push({ u: v, index: 0 })
        } else if (disc[v]! < low[u]!) {
          low[u] = disc[v]!
        }
      } else {
        stack.pop()
        const parent = stack[stack.length - 1]
        if (parent) {
          if (low[u]! < low[parent.u]!) low[parent.u] = low[u]!
          if (low[u]! > disc[parent.u]!) cutEdges.push(parentEdge[u]!)
        }
      }
    }
  }

  return { bridges: cutEdges, components }
}

export interface HashiCheck {
  ok: boolean
  badCells: number[]
  islandIssues: Array<{ island: number; expected: number; actual: number }>
  disconnected: boolean
}

export function checkSolution(
  bridges: ArrayLike<number>,
  islands: ArrayLike<number>,
  edges: BridgeEdge[],
): HashiCheck {
  const incident = incidentEdges(edges, islands.length)
  const bad = new Set<number>()
  const issues: Array<{ island: number; expected: number; actual: number }> = []

  for (let i = 0; i < islands.length; i++) {
    const clue = islands[i] ?? 0
    if (clue <= 0) continue
    let sum = 0
    for (const e of incident[i]!) sum += bridges[e] ?? 0
    if (sum !== clue) {
      issues.push({ island: i, expected: clue, actual: sum })
      // 只有桥数超额才算「错误」；还没搭够只是「未完成」
      if (sum > clue) bad.add(i)
    }
  }

  const hCells = new Set<number>()
  const vCells = new Set<number>()
  for (let e = 0; e < edges.length; e++) {
    if ((bridges[e] ?? 0) <= 0) continue
    const edge = edges[e]!
    const target = edge.horizontal ? hCells : vCells
    for (const c of edge.cells) target.add(c)
  }
  for (const c of hCells) if (vCells.has(c)) bad.add(c)

  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let p = parent.get(x) ?? x
    if (p !== x) {
      p = find(p)
      parent.set(x, p)
    }
    return p
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  for (let e = 0; e < edges.length; e++) {
    if ((bridges[e] ?? 0) > 0) union(edges[e]!.a, edges[e]!.b)
  }
  let root = -1
  let disconnected = false
  let hasIslands = false
  for (let i = 0; i < islands.length; i++) {
    if ((islands[i] ?? 0) <= 0) continue
    hasIslands = true
    const r = find(i)
    if (root < 0) root = r
    else if (r !== root) {
      disconnected = true
      // 桥数都没搭对时，不把「没连通」当作错误高亮
      if (issues.length === 0) bad.add(i)
    }
  }

  return {
    badCells: Array.from(bad),
    islandIssues: issues,
    disconnected,
    ok: hasIslands && issues.length === 0 && !disconnected,
  }
}
