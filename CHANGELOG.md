# Changelog

本プロジェクトの主要な変更を記録する。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

## [0.1.0] - 2026-06-26

初回公開。Phase A（生 `negation` 検証）+ Phase B（述語 DSL `forall` と自動 ∃ 降格）を収録。

### Added

- `verify(name, spec)` — ∀検証を Vitest の `test` として登録する薄い殻。
- `evaluate(spec)` — 判定を `Verdict` 値で返す純粋関数（Vitest 非依存）。`vitest-forall/core` から
  Vitest なしで利用可能。
- 述語 DSL `forall(decls, predicate, opts?)` とコンビネータ（`add`/`sub`/`mul`/`neg`、
  `lt`/`le`/`gt`/`ge`/`eq`/`ne`、`and`/`or`/`not`/`implies`）。
- 非線形（変数同士の積など）領域の **fast-check への自動 ∃ 降格**（IR からの fallback 合成、前件範囲の反映）。
- 制約付き arbitrary `int({ ge, le, ne })` / `real(...)`。
- 既定 Z3 タイムアウト `DEFAULT_TIMEOUT_MS`（`10_000` ms）。
- 使い方ガイド [`docs/guide.md`](./docs/guide.md)。

### Packaging

- `tsup` で `dist/` に ESM(`.js`) + 型定義(`.d.ts`) を出力するビルドを追加。
- エントリ: `vitest-forall`（ルート）と `vitest-forall/core`（Vitest 非依存）。
- `z3-solver` / `fast-check` は dependencies、`vitest` は optional peerDependency。

[Unreleased]: https://github.com/msasaki666/vitest-forall/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/msasaki666/vitest-forall/releases/tag/v0.1.0
</content>
