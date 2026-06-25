# vitest-forall

Vitest 上で **∀検証（Z3 形式検証）** を **∃検証（fast-check）** と同じテストレイヤーに統合するライブラリ。

ユニットテストは「∃（この例で動く）」しか保証しない。書き忘れたケースは素通りする。
`vitest-forall` は「∀（あらゆる入力で成り立つ）」を Z3 で証明し、**それを Vitest のテストとして登録する**。
`test`（∃）と `verify`（∀）が同一ランナー・同一レポート・同一台帳に並ぶ。

> 設計の詳細は [`initial-design.md`](./initial-design.md)、開発方針は [`CLAUDE.md`](./CLAUDE.md) を参照。

## 仕組み

**「性質 P を ∀ で証明したい」⇔「¬P が UNSAT（充足不能）であることを示す」。**
SAT が返れば、その model が **反例の具体値**。Z3 が `unknown`（判定不能）を返した領域は
fast-check の ∃ 例示へ自動で降格する。

## インストール

```bash
pnpm add -D vitest
pnpm add z3-solver fast-check
```

`vitest` は **peerDependency**（任意）です。`verify()` を使うには Vitest が必要ですが、
純粋関数 `evaluate()` だけを使うなら Vitest なしでも動きます（下記「Vitest 非依存で使う」参照）。

## 使い方

```ts
import { test, expect } from 'vitest';
import { verify, int } from 'vitest-forall';
import { withdraw, classify } from './wallet';

// ∃: この具体例で成り立つ
test('withdraw: 100 から 30 引くと 70', () => {
  expect(withdraw(100, 30)).toBe(70);
});

// ∀: あらゆる入力で残高は負にならないことを Z3 で証明
verify('残高は出金後も負にならない', {
  negation: (z) => {
    const b = z.Int.const('balance');
    const w = z.Int.const('amount');
    const pre = z.And(b.ge(0), w.ge(0), w.le(b));
    return z.And(pre, z.Not(b.sub(w).ge(0))); // ¬(差が非負) が UNSAT なら ∀ 成立
  },
});

// unknown → fast-check の ∃ 例示へ降格
verify('classify: 出力は low/mid/high のいずれか', {
  negation: () => {
    throw new Error('実関数の出力制約は Z3 の対象外');
  },
  fallback: {
    arb: [int()],
    prop: (s) => ['low', 'mid', 'high'].includes(classify(s)),
  },
});
```

実行すると ∃ と ∀ が同じレポートに並ぶ:

```
✓ withdraw: 100 から 30 引くと 70
✓ ∀ 残高は出金後も負にならない
✓ ∀ classify: 出力は low/mid/high のいずれか
```

反例が見つかると、その具体値とともにテストが赤くなる:

```
✗ ∀ 残高は出金後も負にならない
  → 反例が存在: (define-fun balance () Int 0) (define-fun amount () Int 1) ...
```

## API

| API | 説明 |
|---|---|
| `verify(name, spec)` | `spec` を Z3 で検証し Vitest の `test` として登録する薄い殻 |
| `evaluate(spec)` | ★純粋関数。判定を `Verdict` 値で返す。Vitest 非依存（テストの核） |
| `int({ ge, le, ne })` / `real(...)` | fallback 用の制約付き fast-check arbitrary |

### `VerifySpec`

| フィールド | 型 | 説明 |
|---|---|---|
| `negation` | `(z) => Bool` | 性質の **否定**。UNSAT なら ∀ 成立 |
| `fallback?` | `{ arb, prop }` | `unknown` 時に走らせる fast-check の ∃ 検証 |
| `timeout?` | `number` | Z3 タイムアウト(ms)。CI 安定化に推奨 |

### `Verdict`（`evaluate` の戻り値）

| `status` | 意味 |
|---|---|
| `proved` | ¬P が UNSAT → ∀ 成立 |
| `refuted` | SAT / ∃ 失敗 → `counterexample` あり |
| `fallback-passed` | unknown → fast-check で例示 OK |
| `error` | unknown かつ `fallback` 未指定 |

## Vitest 非依存で使う（`/core` サブパス）

`evaluate()` は判定を `Verdict` 値で返す純粋関数で、Vitest に依存しません。
ルートエントリ（`vitest-forall`）は `verify()` 経由で `vitest` を読み込むため、
Vitest を入れずにコアだけ使いたい場合は **`vitest-forall/core`** から import します。

```ts
import { evaluate } from 'vitest-forall/core'; // vitest を一切読み込まない

const verdict = await evaluate({
  negation: (z) => {
    const b = z.Int.const('b');
    return z.And(b.neq(0), b.eq(0));
  },
});
// verdict.status === 'proved'
```

## 得意領域と制約

- **得意**: 線形算術・整数/実数・比較・論理結合。
- **苦手（→ `unknown` で fast-check へ降格）**: 非線形（変数同士の乗算）・複雑な文字列制約・ループ。
- **数値**: JS の `number` は IEEE double。境界値は VC 生成層（Phase B）で吸収予定。
- **タイムアウト**: Z3 は最悪ケースで指数的に遅い。`timeout` の設定を推奨。

## 開発

```bash
pnpm install      # 依存導入 + git hook 装着
pnpm test:watch   # TDD（Red→Green を即時確認）
pnpm verify       # typecheck + test（pre-push と同じ）
```
