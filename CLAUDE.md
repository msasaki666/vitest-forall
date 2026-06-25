# CLAUDE.md

このリポジトリで作業する Claude Code 向けの指針。全体設計は [`initial-design.md`](./initial-design.md) を参照。

## プロジェクト概要

`vitest-forall` = Vitest 上で「∀検証（Z3 形式検証）」を「∃検証（fast-check）」と同じテストレイヤーに統合するライブラリ。
中核は純粋関数 `evaluate()`（判定を `Verdict` 値で返す）と、それを `test()` で包む薄い殻 `verify()`。

## 開発の基本方針（最優先）

- **TDD を基本とする**: テストを先に書く。Red → Green → Refactor を必ず回す。
- **関数型プログラミングで書く**: ロジックは純粋関数に寄せ、副作用は端へ隔離する。

この 2 つは独立ではない。**純粋関数は最もテストしやすい単位**であり、TDD と関数型は互いを強化する。

## コマンド

```bash
pnpm install      # 依存導入。lefthook の git hook も自動装着される
pnpm test:watch   # TDD 中はこれを回す（Red→Green を即時確認）
pnpm test         # 一回実行（vitest run）
pnpm typecheck    # 型チェック（tsc --noEmit）
pnpm verify       # typecheck + test（pre-push で走るのと同じ）
```

- **Node 24**（`.node-version` / `.nvmrc`）、**パッケージマネージャは pnpm**（npm/yarn は使わない）。
- 単一の検証を試すときは `pnpm test <path>` や `pnpm test -t "<test名>"`。

## TDD フロー（必ずこの順）

1. **Red**: 失敗するテストを 1 本書き、`pnpm test` で**赤を確認する**。赤を見ずに実装へ進まない。
2. **Green**: 通すための**最小限**の実装を書く。きれいさは後回し。
3. **Refactor**: 緑を保ったまま重複除去・命名改善・純粋化。

- 粒度は小さく。1 つの振る舞い＝1 つの assert を目安に、1 サイクルを短く回す。
- 分岐を増やすときは「その分岐を要求するテスト」を先に足す。
- **バグ修正は再現テストを先に書く**（Red）→ 直す（Green）。リグレッションを永続的に防ぐ。

## 何をテストするか（このライブラリ特有・重要）

- **`verify()` でなく `evaluate()` をテストする**。`verify()` は内部で `test()` を呼ぶため、
  直接叩くと「test の中の test」になり、反例ケースが本物の fail としてスイートを赤くする。
- `evaluate()` は `Verdict` 値を返す純粋関数。**失敗すべきケースも `expect(v.status).toBe('refuted')` で肯定的に検査**する。
- `evaluate()` の全分岐（`proved` / `refuted` / `fallback-passed` / `error`）を各ケースで網羅する（設計書 §7）。
- `verify()` 自身は数行の殻なので、スモーク 1 本（proved spec で緑になる）だけでよい。

## 関数型の指針

- **純粋関数を第一に**。ロジックは入力→出力が決まる関数へ集約する（`evaluate()` 等）。
- **イミュータブル**。引数を破壊変更しない。`const` 既定、再代入を避ける。
- **直和型で状態を表す**。`Verdict` のような discriminated union を `status` で網羅分岐し、握り潰さない。
- **全域関数に寄せる**。想定外は例外で落とさず `Verdict` に畳み込んで値で返す（例: unknown かつ fallback なし → `error`）。
- **副作用を隔離する**。Z3 の `init()`/`Solver`、fast-check の `fc.assert`、Vitest の `test()` 登録は
  境界モジュール（`z3-context.ts` / `verify.ts`）に閉じ込め、コアの純粋性を守る。
- **割り切り**: z3-solver の API は命令的。無理に抽象化せず、その命令的コードを純粋関数の内部に閉じ込めて
  外には `Verdict` だけを出す。関数内のローカルな可変は「外から観測できなければ純粋」として許容。モナド等は導入しない。

## コーディング規約

- TypeScript strict。`any` は原則禁止（z3-solver の緩い型のみ局所許容し、境界で `Verdict` 等へ変換）。
- 公開 API は型を明示。命名は設計書の用語（`proved`/`refuted`/`fallback-passed`/`error`、∀/∃）に揃える。
- コメントは「なぜ」を書く。「何を」はコードで語る。

## Git / hook

- **pre-push で `pnpm verify`（typecheck + test）が自動実行**される（lefthook、`lefthook.yml`）。CI は持たず品質ゲートを hook に寄せている。
- **赤いまま push しない**。コミットは小さく意味単位で（TDD の 1〜数サイクルごと）。
- 開発ブランチの指定がある場合はそれに従い、勝手に他ブランチへ push しない。

## 作業完了の条件（Definition of Done）

- 追加/変更した振る舞いにテストがある（先に Red を出した）
- `pnpm verify` が緑（typecheck + 全テスト）
- 新しい分岐は `evaluate()` のメタテストで網羅されている
- 副作用が境界に隔離され、コアの純粋性が保たれている
- `any` を増やしていない（やむを得ない箇所は局所化し理由をコメント）
