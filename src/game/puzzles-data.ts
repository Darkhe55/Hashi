/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "hashi-lgdptt", name: "初识搭桥", width: 7, height: 7, difficulty: 'easy', series: "入门", board: "3040101000000020201030000000102010300000001030202", solution: "210001001111110111000111" },
  { id: "hashi-lgdptu", name: "双桥回廊", width: 7, height: 7, difficulty: 'easy', series: "入门", board: "2020102000000020102020000000303030200000002020102", solution: "101001111101111101010101" },
  { id: "hashi-lgdptv", name: "环岛连线", width: 7, height: 7, difficulty: 'medium', series: "进阶", board: "2010201000000040204010000000401020200000002010102", solution: "101111101101121000110001" },
  { id: "hashi-lgdptw", name: "桥数之谜", width: 7, height: 7, difficulty: 'medium', series: "进阶", board: "2020101000000020201030000000203020300000002020101", solution: "110101111110101010000111" },
  { id: "hashi-lgdptx", name: "搭桥之壁", width: 7, height: 7, difficulty: 'hard', series: "挑战", board: "1030301000000010301010000000103030300000001020201", solution: "111100111110000110101011" },
  { id: "hashi-lgdptz", name: "终局搭桥", width: 7, height: 7, difficulty: 'hard', series: "挑战", board: "2010202000000030202010000000203010100000001030202", solution: "101110110111110001100101" },
]
