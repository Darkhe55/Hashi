/**
 * 搭桥题库生成器
 *
 * 16 个岛放在 7×7 的偶数坐标上；先取随机生成树保证连通，
 * 再随机加第二座桥/额外边，最后检查桥数题是否唯一。
 */

import type { Difficulty } from '../core/types'
import { countSolutions } from './solver.ts'
import { buildEdges, encodeBridges, encodeIslands } from './types.ts'

interface GenSpec {
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  extra: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

const SPECS: GenSpec[] = [
  { seed: 0x4d534801, difficulty: 'easy', name: '初识搭桥', series: '入门', extra: 0.18 },
  { seed: 0x4d534802, difficulty: 'easy', name: '双桥回廊', series: '入门', extra: 0.24 },
  { seed: 0x4d534803, difficulty: 'medium', name: '环岛连线', series: '进阶', extra: 0.3 },
  { seed: 0x4d534804, difficulty: 'medium', name: '桥数之谜', series: '进阶', extra: 0.36 },
  { seed: 0x4d534805, difficulty: 'hard', name: '搭桥之壁', series: '挑战', extra: 0.34 },
  { seed: 0x4d534807, difficulty: 'hard', name: '终局搭桥', series: '挑战', extra: 0.3 },
]

export interface GeneratedPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

function attempt(spec: GenSpec, rng: () => number, w: number, h: number): GeneratedPuzzle | null {
  const coords = [0, 2, 4, 6]
  const nodes: number[] = []
  for (const y of coords) for (const x of coords) nodes.push(y * w + x)

  const graph: Array<[number, number]> = []
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const i = gy * 4 + gx
      if (gx + 1 < 4) graph.push([i, i + 1])
      if (gy + 1 < 4) graph.push([i, i + 4])
    }
  }

  const parent = Array.from({ length: 16 }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)))
  const vals = new Array<number>(graph.length).fill(0)
  const order = shuffle(graph.map((_, i) => i), rng)
  const tree = new Set<number>()
  for (const gi of order) {
    const [a, b] = graph[gi]!
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) continue
    parent[rb] = ra
    vals[gi] = 1
    tree.add(gi)
  }

  for (let gi = 0; gi < graph.length; gi++) {
    if (tree.has(gi)) {
      if (rng() < spec.extra * 0.25) vals[gi] = 2
      continue
    }
    const roll = rng()
    if (roll < spec.extra) vals[gi] = 1
    else if (roll < spec.extra * 0.35) vals[gi] = 2
  }

  const degrees = new Array<number>(16).fill(0)
  for (let gi = 0; gi < graph.length; gi++) {
    const v = vals[gi]!
    degrees[graph[gi]![0]]! += v
    degrees[graph[gi]![1]]! += v
  }
  if (degrees.some((d) => d < 1 || d > 8)) return null

  const islands = new Array<number>(w * h).fill(0)
  for (let n = 0; n < 16; n++) islands[nodes[n]!] = degrees[n]!
  const edges = buildEdges(islands, w, h)

  const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`)
  const byPair = new Map<string, number>()
  for (let gi = 0; gi < graph.length; gi++) {
    byPair.set(key(nodes[graph[gi]![0]]!, nodes[graph[gi]![1]]!), vals[gi]!)
  }
  const bridges = edges.map((e) => byPair.get(key(e.a, e.b)) ?? 0)

  const counted = countSolutions(islands, edges, 2, 400_000)
  if (counted.timedOut || counted.count !== 1) return null

  return {
    id: `hashi-${spec.seed.toString(36)}`,
    name: spec.name,
    width: w,
    height: h,
    difficulty: spec.difficulty,
    series: spec.series,
    board: encodeIslands(islands),
    solution: encodeBridges(bridges),
  }
}

export function generatePuzzles(): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = []
  for (const spec of SPECS) {
    const t0 = Date.now()
    const rng = mulberry32(spec.seed)
    let made: GeneratedPuzzle | null = null
    for (let tries = 0; tries < 300 && !made; tries++) made = attempt(spec, rng, 7, 7)
    if (!made) throw new Error(`[搭桥 gen] ${spec.name} 生成失败`)
    const count = made.board.split('').filter((c) => c !== '0').length
    const totalBridges = made.solution.split('').reduce((a, c) => a + Number(c), 0)
    console.log(
      `[搭桥 gen] ${spec.name}：岛 ${count}，桥 ${totalBridges}，${Date.now() - t0}ms`,
    )
    out.push(made)
  }
  return out
}
