import { defineConfig } from 'tsup';

// 公開用ビルド設定。src/ の TypeScript を dist/ の ESM(.js) + 型定義(.d.ts) へ変換する。
//
// なぜ tsup（バンドラ）か: ソースは `from './verify'` のように拡張子なしの相対 import を使う。
// 素の tsc 出力はこれを `./verify.js` へ書き換えないため ESM ランタイムで壊れる。tsup は
// 解決・結合してくれるのでそのまま動く成果物になる。
//
// z3-solver / fast-check（dependencies）と vitest（peerDependency）は external のまま残す
// （tsup の既定）。これにより WASM はバンドルに取り込まれず、`/core` も vitest を引き込まない。
export default defineConfig({
  // 2 エントリ。ルート（verify を含む）と、vitest 非依存の core サブパス。
  entry: { index: 'src/index.ts', core: 'src/core.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  treeshake: true,
});
