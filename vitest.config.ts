import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Z3 (z3-solver) は Node 上で動かす。ブラウザの SharedArrayBuffer / 特殊ヘッダ問題を回避（設計書 §1）。
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts', 'examples/**/*.test.ts'],
    // init() は重い（初回数秒〜十数秒）。Z3 検証も最悪ケースで遅いため testTimeout を伸ばす（設計書 §8）。
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // z3-solver は逐次実行（スレッド非対応）。worker 並列で詰まらないよう単一フォークに寄せる（設計書 §8）。
    // Vitest 4 では poolOptions が廃止され、トップレベルの maxWorkers / fileParallelism で制御する。
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
