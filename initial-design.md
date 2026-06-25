# vitest-forall 設計書（Claude Code 実装指示）

> Vitest 上で「∀検証（Z3形式検証）」を「∃検証（fast-check）」と同じテストレイヤーに統合するライブラリ。
> 本書は実装エージェント（Claude Code）が着手できる粒度で記述する。PoC・メタテストとも検証済み。

---

## 0. このプロジェクトが解く問題

ユニットテストは「∃（この例で動く）」しか保証しない。書き忘れたケースは素通りする。
本ライブラリは「∀（あらゆる入力で成り立つ）」を Z3 で証明し、**それを Vitest のテストとして登録する**。

- 検証を独立した別レイヤーに置くと、テストカバレッジと別に「証明カバレッジ」が生まれ MECE 管理が崩壊する。
- よって `test`（∃）と `verify`（∀）を **同一ランナー・同一レポート・同一台帳** に並べる。これが本設計の中核思想。

非ゴール（やらないこと）:
- 型システムへの介入（`type Nat = i64 where v>=0` のような型注釈はやらない）。制約はテスト側に閉じる。
- 任意 TS 関数の記号実行（パス制約の自動抽出）。研究領域なので **スコープ外**。

命名: パッケージ／リポジトリ名は **`vitest-forall`**。`package.json` の `keywords` に
`z3` / `smt` / `formal-verification` / `property-testing` を入れ、検索性を補う。
（`vite-plugin-*` は Vite プラグインの規則であり混同しないこと。`@vitest/*` は公式予約。）

---

## 1. 確定済みの技術選定（PoC 実測）

| 項目 | 選定 | 根拠 |
|---|---|---|
| 検証器 | `z3-solver` v4.16.0（公式 WASM バインディング） | Node で∀証明・反例生成が動作確認済み |
| 実行環境 | **Node（Vitest 標準）** | ブラウザの SharedArrayBuffer / 特殊ヘッダ問題を回避できる |
| ∃フォールバック | `fast-check` v4.8.0 | Z3 が `unknown` を返す領域を例示で埋める |
| ランナー | `vitest` v4.1.9 | カスタム API はただの `test()` ラッパーで登録可能 |
| 高レベル API | `Context('main')` 経由（Z3Py 風） | `Int.const` / `And` / `Or` / `Not` / `ge` 等が使える |

インストール:
```bash
npm i -D vitest
npm i z3-solver fast-check
```

---

## 2. アーキテクチャ（4層）

```
┌─ verify() DSL ────────── 公開 API。test() を呼ぶ薄い殻。ここはテストしない
├─ evaluate() コア ───────── ★ 純粋関数。Vitest非依存。判定結果を Verdict 値で返す
│                            └ メタテストの主対象。全分岐をここで検証する
├─ VC生成層（Phase B）────── TSの述語 → Z3式 への変換（線形算術限定）
├─ z3-solver (WASM) ─────── 既製。否定のUNSAT判定＝∀証明
└─ fast-check ───────────── 既製。unknown 時の∃フォールバック
```

**設計の要諦**: 判定ロジックを `test()` から切り離し、純粋関数 `evaluate()` に置く。
これにより「テストツール自身のテスト」が `expect(verdict).toBe(...)` で書け、
「反例を出して fail するべきケース」をスイートを赤くせず値として検査できる（§7参照）。

検証の原理:
**「性質 P を ∀ で証明したい」⇔「¬P が UNSAT（充足不能）であることを示す」。**
SAT が返れば、その model が **反例の具体値**。

---

## 3. 実装フェーズ（この順で進める）

### Phase A — 最小実装（数日）★まず動かす
ユーザーが Z3 式を直接書く方式。VC 生成層なしで成立する。**PoC で実証済み。これを製品の土台にする。**

```ts
verify('safeDiv: 除数0は到達不能', {
  negation: (z) => { const b = z.Int.const('b'); return z.And(b.neq(0), b.eq(0)); },
});
```

成果物: `evaluate()` コア、`verify()` 殻、Z3 遅延初期化、sat/unsat/unknown 分岐、反例整形、fast-check フォールバック、**メタテスト一式**。

### Phase B — 制約DSL + 述語パーサ（数週間）
ユーザーが `a + b > 100` のような **TS 式に近い述語** を書き、それを Z3 式へ機械変換する層を足す。
**対象を線形算術・整数/実数・比較・論理結合に限定する**（後述の制約参照）。実用の 8 割をカバー。

### Phase C — 記号実行 ✗ やらない
実関数本体からパス制約を自動抽出する方式。難易度が別物。**捨てる。**

---

## 4. API 仕様

### コア型 `Verdict`（純粋関数の出力）

```ts
export type Verdict =
  | { status: 'proved' }                              // UNSAT → ∀成立
  | { status: 'refuted'; counterexample: string }     // SAT/∃失敗 → 反例あり
  | { status: 'fallback-passed' }                     // unknown→fast-checkで例示OK
  | { status: 'error'; reason: string };              // unknown かつ fallback未指定
```

### `evaluate(spec): Promise<Verdict>` — 純粋関数（テスト対象の核）

```ts
export async function evaluate(spec: VerifySpec): Promise<Verdict>;
```

判定ロジック（確定仕様）:
1. `negation(z)` を solver に add → `check()`（式構築が例外なら `unknown` 扱い）
2. `unsat` → `{ status: 'proved' }`
3. `sat` → model を整形し `{ status: 'refuted', counterexample }`
4. `unknown` かつ `fallback` あり → fast-check 実行。成功 `fallback-passed` / 失敗 `refuted`
5. `unknown` かつ `fallback` なし → `{ status: 'error' }`

### `verify(name, spec): void` — Vitest登録の薄い殻

```ts
export function verify(name: string, spec: VerifySpec): void;
// 内部: test(`∀ ${name}`, async () => { evaluate を呼び、proved/fallback-passed は return、
//        refuted は反例を throw、error は reason を throw })
```

### `VerifySpec`

```ts
type VerifySpec = {
  negation: (z: Z3Context) => BoolExpr;                 // 性質の否定（UNSATなら∀成立）
  fallback?: { arb: fc.Arbitrary<any>[]; prop: (...xs: any[]) => boolean };
  timeout?: number;                                     // Z3タイムアウト(ms)。CI安定化に必須級
};
```

---

## 5. ディレクトリ構成

```
vitest-forall/
├── src/
│   ├── index.ts          # 公開エクスポート（verify, int, real, ...）
│   ├── core.ts           # ★ evaluate(): 純粋判定関数。Vitest非依存
│   ├── verify.ts         # verify(): core を test() で包む薄い殻
│   ├── z3-context.ts     # Z3 遅延初期化・シングルトン・タイムアウト設定
│   ├── vc/               # Phase B: VC生成層
│   │   ├── parser.ts     #   TS述語AST → 中間表現
│   │   └── to-z3.ts      #   中間表現 → Z3式（線形算術のみ対応）
│   └── arbitraries.ts    # int()/real() など制約付き fast-check arbitrary
├── examples/
│   ├── wallet.ts         # テスト対象サンプル
│   └── wallet.test.ts    # verify + test 同居サンプル
├── test/
│   ├── core.test.ts      # ★ メタテスト: evaluate() の全分岐
│   └── verify.smoke.test.ts # 殻のスモーク（provedで緑になる）
└── package.json
```

---

## 6. 動作確認済み PoC

### テスト対象 `examples/wallet.ts`
```ts
export function withdraw(balance: number, amount: number): number {
  return balance - amount;
}
export function safeDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}
export function classify(score: number): 'low' | 'mid' | 'high' {
  if (score < 30) return 'low';
  if (score < 70) return 'mid';
  return 'high';
}
```

### コア `src/core.ts`（純粋判定関数）
```ts
import { init } from 'z3-solver';
import fc from 'fast-check';

let ctx: any;
async function z3() {
  if (!ctx) ctx = (await init()).Context('main');
  return ctx;
}

export type Verdict =
  | { status: 'proved' }
  | { status: 'refuted'; counterexample: string }
  | { status: 'fallback-passed' }
  | { status: 'error'; reason: string };

export async function evaluate(spec: {
  negation: (z: any) => any;
  fallback?: { arb: any[]; prop: (...xs: any[]) => boolean };
}): Promise<Verdict> {
  const z = await z3();
  let res: string;
  try {
    const s = new z.Solver();
    s.add(spec.negation(z));
    res = await s.check();
  } catch { res = 'unknown'; }

  if (res === 'unsat') return { status: 'proved' };
  if (res === 'sat') {
    const s = new z.Solver();
    s.add(spec.negation(z));
    await s.check();
    return { status: 'refuted', counterexample: s.model().toString().replace(/\s+/g, ' ') };
  }
  if (spec.fallback) {
    try {
      fc.assert(fc.property(...spec.fallback.arb, spec.fallback.prop));
      return { status: 'fallback-passed' };
    } catch (e: any) {
      return { status: 'refuted', counterexample: String(e?.message ?? e) };
    }
  }
  return { status: 'error', reason: 'unknown かつ fallback 未指定' };
}
```

### 殻 `src/verify.ts`
```ts
import { test } from 'vitest';
import { evaluate } from './core';

export function verify(name: string, spec: any) {
  test(`∀ ${name}`, async () => {
    const v = await evaluate(spec);
    if (v.status === 'proved' || v.status === 'fallback-passed') return;
    if (v.status === 'refuted') throw new Error(`反例が存在: ${v.counterexample}`);
    throw new Error(v.reason);
  });
}
```

### 利用例 `examples/wallet.test.ts`
```ts
import { test, expect } from 'vitest';
import fc from 'fast-check';
import { withdraw, safeDiv, classify } from './wallet';
import { verify } from '../src/verify';

test('withdraw: 100から30引くと70', () => {          // ∃ 例示
  expect(withdraw(100, 30)).toBe(70);
});

verify('残高は出金後も負にならない', {                  // ∀ 証明
  negation: (z) => {
    const b = z.Int.const('balance'), w = z.Int.const('amount');
    const pre = z.And(b.ge(0), w.ge(0), w.le(b));
    return z.And(pre, z.Not(b.sub(w).ge(0)));
  },
});

verify('classify: 全scoreが分類される', {              // ∀ 網羅性
  negation: (z) => {
    const s = z.Int.const('score');
    return z.Not(z.Or(s.lt(30), z.And(s.ge(30), s.lt(70)), s.ge(70)));
  },
});

verify('classify: 出力は3種のいずれか', {              // unknown→∃降格
  negation: () => { throw 'skip'; },
  fallback: { arb: [fc.integer()], prop: (s: number) => ['low','mid','high'].includes(classify(s)) },
});
```

### 期待結果
```
✓ withdraw: 100から30引くと70
✓ ∀ 残高は出金後も負にならない
✓ ∀ classify: 全scoreが分類される
✓ ∀ classify: 出力は3種のいずれか（fallback例示）
```

---

## 7. メタテスト（テストツール自身のテスト）★実証済み

### 方針
**`verify()` でなく純粋関数 `evaluate()` をテストする。** `verify` を直接叩くと
「test の中で test」の入れ子になり、反例ケースが本物の fail としてスイートを赤くする。
`evaluate()` は結果を `Verdict` 値で返すため、**失敗すべきケースも `expect` で肯定**できる。

### 押さえる分岐 `test/core.test.ts`
```ts
import { test, expect, describe } from 'vitest';
import fc from 'fast-check';
import { evaluate } from '../src/core';

describe('evaluate: ∀検証エンジンの判定', () => {
  test('恒真な否定はUNSAT → proved', async () => {
    const v = await evaluate({ negation: (z) => {
      const b = z.Int.const('b'); return z.And(b.neq(0), b.eq(0)); } });
    expect(v.status).toBe('proved');
  });

  test('偽な性質はSAT → refuted で反例を返す', async () => {
    const v = await evaluate({ negation: (z) => {
      const b = z.Int.const('balance'), w = z.Int.const('amount');
      const pre = z.And(b.ge(0), w.ge(0), w.le(b));
      return z.And(pre, z.Not(b.sub(w).ge(10))); } });
    expect(v.status).toBe('refuted');
    if (v.status === 'refuted') expect(v.counterexample).toContain('Int');
  });

  test('unknown → fallback成功で fallback-passed', async () => {
    const v = await evaluate({ negation: () => { throw 'x'; },
      fallback: { arb: [fc.integer()], prop: (_n: number) => true } });
    expect(v.status).toBe('fallback-passed');
  });

  test('unknown かつ fallback未指定 → error', async () => {
    const v = await evaluate({ negation: () => { throw 'x'; } });
    expect(v.status).toBe('error');
  });

  test('fallbackのpropが偽 → refuted', async () => {
    const v = await evaluate({ negation: () => { throw 'x'; },
      fallback: { arb: [fc.integer()], prop: (_n: number) => false } });
    expect(v.status).toBe('refuted');
  });
});
```

| ケース | 期待 Verdict | 狙い |
|---|---|---|
| 恒真な性質 | `proved` | UNSAT→証明成功の正常系 |
| 偽な性質 | `refuted` + 反例 | fail させずに反例返却を確認 |
| unknown→fallbackあり | `fallback-passed` | 降格パスの結線 |
| unknown→fallbackなし | `error` | 設定ミスを握り潰さない |
| fallbackのpropが偽 | `refuted` | ∃側の反例検出 |

### 殻のスモーク `test/verify.smoke.test.ts`
`verify()` 自体は数行なので、最小1本だけ:「proved な spec を渡すと、登録された `∀ ...` テストが緑になる」。
※ `arb: []`（空配列）を `fc.property` に渡すとエラーになる。メタテストの arbitrary は必ず実体（`fc.integer()` 等）を入れること。

---

## 8. 既知の制約（割り切り。設計に織り込む）

- **得意領域のみ**: 線形算術・整数/実数・比較・論理結合。**非線形（変数同士の乗算）・複雑な文字列制約・ループは `unknown`** → fast-check へ降格。
- **数値の壁**: JS の `number` は IEEE double。`int64/uint64` は BigInt 表現。境界値検証ではこの差異を VC 生成層で吸収する。
- **タイムアウト必須**: Z3 は最悪ケースで指数的に遅い。`spec.timeout` を必ず設定し、CI では検証対象をスコープする。
- **初期化コスト**: `init()` は重い（初回数秒〜十数秒）。Context はシングルトンで使い回す。メタテストは `testTimeout` を伸ばす。
- **スレッド非対応**: `z3-solver` は逐次実行（長時間 API は順番待ち）。並列 worker 数に注意。

---

## 9. タスク分解（Issue 化の単位）

1. **scaffold**: package.json / tsconfig / vitest.config、依存導入、CI で `vitest run` が通る空箱
2. **z3-context.ts**: 遅延初期化シングルトン + タイムアウト設定 + 後始末
3. **core.ts**: `evaluate()` 純粋関数（§4・§6 準拠）と `Verdict` 型
4. **verify.ts**: `evaluate` を test() で包む殻
5. **メタテスト**: `test/core.test.ts`（§7 の5分岐）+ 殻スモーク1本
6. **arbitraries.ts**: `int({ge,le,ne})` 等、制約付き arbitrary（fallback 用）
7. **examples + README**: ∀/∃ の使い分け、得意/不得意領域、最小例
8. （Phase B）**vc/parser.ts + vc/to-z3.ts**: 線形述語 → Z3 式変換、`forall`/`prop` DSL
9. （Phase B）**フォールバック自動化**: `unknown` 時に arbitrary を自動推論して fast-check 実行

---

## 10. 受け入れ条件（Definition of Done / Phase A）

- [ ] `npm i -D vitest && npm i z3-solver fast-check` 後、`npx vitest run` で §6 サンプルが緑
- [ ] `evaluate()` の5分岐メタテスト（§7）が全て緑
- [ ] ∀証明が `proved`、偽の性質で **具体的な反例 model** を伴う `refuted`
- [ ] `unknown` 時に fast-check へ降格、`fallback` 未指定なら `error`
- [ ] `test`（∃）と `verify`（∀）が同一レポートに並ぶ
- [ ] タイムアウトが効き、CI が常に有限時間で終了する

---

## 付録: 設計判断の要約

- **なぜ型でなくテスト関数か**: プロダクションコードを汚さず段階導入でき、∃テストと同じ台帳に乗る（MECE）。代償の「呼び出し側の静的強制」は既存 TS 型 + zod で足りる。
- **なぜ evaluate を分離するか**: テストツールをテスト可能にするため。判定を値（Verdict）で返せば、失敗ケースもアサーションで検査でき、入れ子 test 問題を回避できる。
- **なぜ Mumei のような新言語にしないか**: 中核理論（refinement types + SMT）は同じだが、言語ごと作ると導入摩擦が跳ね上がる。Kani / CrossHair / Hypothesis が示す通り、**普及するのはテストランナーに同居した形**。
- **AI 連携の余地**: `negation` / 述語の記述を LLM に書かせ、Z3 が真偽を機械判定するループ。MCP / Claude Code 資産と接続する拡張余地がある（別 Issue）。
