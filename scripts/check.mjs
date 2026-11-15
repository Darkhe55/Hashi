/**
 * 搭桥题库审计
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildEdges,
  decodeBridges,
  decodeIslands,
} from '../src/game/types.ts'
import { checkSolution, propagate } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const text = readFileSync(DATA_FILE, 'utf8')

const entries = []
const re =
  /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*width:\s*(\d+),\s*height:\s*(\d+),\s*difficulty:\s*'([^']+)',\s*series:\s*"([^"]+)",\s*board:\s*"([^"]*)",\s*solution:\s*"([^"]*)"\s*\}/g
let m
while ((m = re.exec(text)) !== null) {
  entries.push({
    id: m[1],
    name: m[2],
    width: Number(m[3]),
    height: Number(m[4]),
    difficulty: m[5],
    series: m[6],
    board: m[7],
    solution: m[8],
  })
}

let errors = 0
let warnings = 0
const ids = new Set()

for (const e of entries) {
  if (ids.has(e.id)) {
    console.error(`[check] 重复 id: ${e.id}`)
    errors++
  }
  ids.add(e.id)
  const cells = e.width * e.height
  const islands = decodeIslands(e.board, cells)
  if (!islands) {
    console.error(`[check] ${e.id} 题面编码非法`)
    errors++
    continue
  }
  const edges = buildEdges(islands, e.width, e.height)
  const bridges = decodeBridges(e.solution, edges.length)
  if (!bridges) {
    console.error(`[check] ${e.id} 参考解编码非法`)
    errors++
    continue
  }
  const ref = checkSolution(bridges, islands, edges)
  if (!ref.ok) {
    console.error(`[check] ${e.id} 参考解不合法`)
    errors++
    continue
  }

  const counted = countSolutions(islands, edges, 2, 1_500_000)
  if (counted.timedOut) {
    console.warn(`[check] ${e.id} 唯一解检查超时（${counted.nodes} 节点）`)
    warnings++
  } else if (counted.count !== 1) {
    console.error(`[check] ${e.id} 解不唯一：找到 ${counted.count} 个`)
    errors++
    continue
  }

  const vals = new Array(edges.length).fill(-1)
  const sat = propagate(vals, islands, edges)
  const decided = vals.every((v) => v !== -1)
  if (!sat) {
    console.error(`[check] ${e.id} 规则传播矛盾`)
    errors++
    continue
  }
  if (!decided) warnings++

  const islandCount = islands.filter((v) => v > 0).length
  const bridgeCount = bridges.reduce((a, b) => a + b, 0)
  console.log(
    `[check] ${e.id} ${e.width}×${e.height} 岛 ${islandCount} 桥 ${bridgeCount} · 解唯一 · 逻辑${decided ? '可推满' : '需回溯'} · ${counted.nodes} 节点`,
  )
}

console.log(`[check] 共 ${entries.length} 题，错误 ${errors}，警告 ${warnings}`)
if (entries.length === 0) console.warn('[check] 题库为空，请先运行 npm run gen。')
if (errors > 0) process.exitCode = 1
