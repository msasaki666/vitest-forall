# vitest-forall 使い方ガイド

`vitest-forall` を使って、Vitest のテストの中に **∀検証（あらゆる入力で成り立つことの Z3 証明）** を
書くための実践ガイドです。README が概要・リファレンスなら、本書は **手を動かしながら学ぶチュートリアル**です。

- まず動かしたい → [1. 5 分で動かす](#1-5-分で動かす)
- ∀ と ∃ の使い分けを知りたい → [2. ∀ と ∃ ── いつどちらを書くか](#2--と---いつどちらを書くか)
- 生の Z3 式を書く → [3. 低レベル API：`verify` と `negation`](#3-低レベル-apiverify-と-negation)
- 宣言的に書く → [4. 述語 DSL：`forall`](#4-述語-dslforall)
- 反例を読む → [5. 反例（counterexample）の読み方](#5-反例counterexampleの読み方)
- 自動降格の仕組み → [6. 非線形と自動 ∃ 降格](#6-非線形と自動--降格)
- API 早見表 → [8. コンビネータ／API リファレンス](#8-コンビネータapi-リファレンス)
- 困ったとき → [10. トラブルシューティング](#10-トラブルシューティング)

---

## 1. 5 分で動かす

### インストール

```bash
pnpm add -D vitest
pnpm add z3-solver fast-check
```

`vitest` は **peerDependency（任意）** です。`verify()` を使うときだけ必要で、純粋関数
`evaluate()` だけなら Vitest なしでも動きます（→ [7. Vitest 非依存で使う](#7-vitest-非依存で使うcore-サブパス)）。

> Node 24 以上が必要です（`z3-solver` の WASM が依存）。

### 最初のテスト

検証したい関数（`src/wallet.ts`）:

```ts
export function withdraw(balance: number, amount: number): number {
  return balance - amount;
}
```

テスト（`src/wallet.test.ts`）:

```ts
import { test, expect } from 'vitest';
import { verify, forall, and, ge, le, sub, implies } from 'vitest-forall';

// ∃: この具体例で動く
test('withdraw: 100 から 30 引くと 70', () => {
  expect(withdraw(100, 30)).toBe(70);
});

// ∀: 前提を満たすあらゆる入力で「残高は負にならない」ことを Z3 が証明する
verify(
  '残高は出金後も負にならない',
  forall({ balance: 'int', amount: 'int' }, ({ balance, amount }) =>
    implies(
      and(ge(balance, 0), ge(amount, 0), le(amount, balance)),
      ge(sub(balance, amount), 0),
    ),
  ),
);
```

実行:

```bash
pnpm test
```

```
✓ withdraw: 100 から 30 引くと 70
✓ ∀ 残高は出金後も負にならない
```

∃（`test`）と ∀（`verify`）が **同じランナー・同じレポート** に並びました。これが本ライブラリの中核です。

---

## 2. ∀ と ∃ ── いつどちらを書くか

ユニットテストは「∃（この例で動く）」しか保証しません。書き忘れた入力は素通りします。
`vitest-forall` は「∀（あらゆる入力で成り立つ）」を Z3 に証明させ、それを同じテスト台帳に並べます。

| | ∃ 検証（`test` / `fast-check`） | ∀ 検証（`verify`） |
|---|---|---|
| 保証 | 「**ある**入力で成り立つ」 | 「**すべての**入力で成り立つ」 |
| 手段 | 具体例・ランダム例示 | Z3 による証明（反例探索） |
| 得意 | 任意のロジック（文字列・I/O・分岐） | 線形算術・整数/実数・比較・論理結合 |
| 失敗時 | 失敗した 1 例 | 反例の **具体値モデル** |

**判断の目安**

- 数値の不変条件（「残高は負にならない」「分類は全域を覆う」「上限を超えない」）→ **∀（`verify`）**。
- 文字列処理・外部 I/O・複雑な制御フロー → **∃（`test`）** か fast-check。
- ∀ を書きたいが Z3 の対象外（非線形など）→ `forall` で書けば **自動で ∃ に降格** する（→ [6 章](#6-非線形と自動--降格)）。

両者は排他ではありません。同じ関数に「∃ の代表例」と「∀ の不変条件」を **並べて** 書くのが理想形です。

---

## 3. 低レベル API：`verify` と `negation`

`verify(name, spec)` は最も基本的な API です。`spec.negation` に **「証明したい性質の否定」** を
Z3 式で書きます。

### なぜ「否定」を書くのか

検証の原理はこうです:

> **「性質 P が ∀ で成り立つ」 ⇔ 「¬P が UNSAT（充足不能）」**

P が常に真なら、その反例（¬P を満たす値）はどこにも存在しない＝¬P は充足不能、というわけです。
逆に Z3 が ¬P を **SAT（充足可能）** と判定したら、その解（model）が **反例の具体値** になります。

```ts
import { verify } from 'vitest-forall';

verify('残高は出金後も負にならない', {
  negation: (z) => {
    const b = z.Int.const('balance');
    const w = z.Int.const('amount');
    const pre = z.And(b.ge(0), w.ge(0), w.le(b)); // 前提
    // 証明したい性質 P = (balance - amount ≥ 0)
    // negation = 前提 ∧ ¬P
    return z.And(pre, z.Not(b.sub(w).ge(0)));
  },
});
```

`z` は Z3 の `Context`（Z3Py 風 API）です。`z.Int.const` / `z.Real.const` で変数を作り、
`.ge` / `.le` / `.add` / `.sub` などのメソッドと `z.And` / `z.Or` / `z.Not` / `z.Implies` で式を組みます。

### 網羅性の証明（分岐の抜け検出）

「`classify` のどの分岐にも当てはまらない score が存在しないか？」を ∀ で示す例:

```ts
verify('classify: 全 score がいずれかに分類される（網羅性）', {
  negation: (z) => {
    const s = z.Int.const('score');
    // P = (score<30 ∨ 30≤score<70 ∨ score≥70) ── これが全域を覆う
    return z.Not(z.Or(s.lt(30), z.And(s.ge(30), s.lt(70)), s.ge(70)));
  },
});
```

もし分岐に穴があれば、Z3 がその穴に落ちる `score` を反例として返します。

### `negation` を直接書くか、`forall` を使うか

生の `negation` は柔軟ですが、自分で否定を組む必要があり読みにくくなりがちです。
**性質をそのまま（否定せずに）宣言的に書きたいなら、次章の `forall` を使ってください。**
`forall` は否定を内部で行い、さらに非線形時の ∃ 降格まで自動化します。

---

## 4. 述語 DSL：`forall`

`forall(decls, predicate, opts?)` は、**「成り立ってほしい性質」をそのまま** 書ける高レベル API です。
否定（`negation`）は内部で自動的に組まれます。

```ts
import { verify, forall, and, ge, le, sub, implies } from 'vitest-forall';

verify(
  '残高は出金後も負にならない',
  forall(
    { balance: 'int', amount: 'int' },             // ① 変数の宣言（名前 → ソート）
    ({ balance, amount }) =>                        // ② 性質を組む（変数ハンドルを受け取る）
      implies(
        and(ge(balance, 0), ge(amount, 0), le(amount, balance)),  // 前件（事前条件）
        ge(sub(balance, amount), 0),                              // 後件（保証したい性質）
      ),
  ),
);
```

- **① 宣言** `{ balance: 'int', amount: 'int' }` … 変数名とソート（`'int'` / `'real'`）。
- **② 述語** … 宣言した変数のハンドルが渡され、コンビネータで `Formula` を組み立てて返します。
- **③ オプション**（第 3 引数、任意）… `{ fallback?, timeout? }`。

`forall` が返すのは `VerifySpec` です。`verify(name, forall(...))` のように `verify` に渡します。

### 項位置では数値リテラルをそのまま書ける

`add(balance, 100)` のように、項（数値）の位置には素の `number` を書けます。内部で自動的に
リテラルへ昇格されます（`NaN` / `Infinity` は構築時にエラーで弾かれます）。

### 整数と実数の混在

`'int'` と `'real'` を混ぜると、比較・算術は安全側に **real へ持ち上げて** 評価されます
（`int` は `ToReal` で実数化）。小数を含むリテラル（`0.5` など）も自動的に real 項になります。

---

## 5. 反例（counterexample）の読み方

性質が成り立たないと、Z3 は反例の **具体値モデル** を返し、テストが赤くなります。

例えば「残高は出金後 **10 以上** 残る」という（偽の）性質を検証すると:

```
✗ ∀ 残高は出金後 10 以上残る
  → 反例が存在: (define-fun balance () Int 0) (define-fun amount () Int 0) ...
```

`(define-fun balance () Int 0)` は **`balance = 0`** という意味です（SMTLIB 形式）。
`balance = 0, amount = 0` のとき残高は `0` で、`≥ 10` を満たさない、という反例を Z3 が見つけたわけです。

この「具体的な反例」が ∀ 検証の価値です。`fast-check` のランダム探索が見逃すコーナーケースでも、
Z3 は **存在すれば必ず** 提示します。

---

## 6. 非線形と自動 ∃ 降格

Z3（線形算術ソルバ）が得意なのは **線形** な式だけです。**変数同士の積** `x * y` のような
非線形は対象外で、Z3 は `unknown`（判定不能）を返します。

`forall` で書いた性質がこの領域に出た場合、**`fallback` を書かなくても**、IR（中間表現）から
fast-check の ∃ 検証が **自動合成** され、例示による検証に降格します。

```ts
import { verify, forall, and, ge, mul, implies } from 'vitest-forall';

// x*y は非線形 → Z3 unknown → 自動で fast-check の ∃ 検証へ降格
verify(
  '非負どうしの積は非負',
  forall({ x: 'int', y: 'int' }, ({ x, y }) =>
    implies(and(ge(x, 0), ge(y, 0)), ge(mul(x, y), 0)),
  ),
);
```

```
✓ ∀ 非負どうしの積は非負   ← Z3 では証明できないが fast-check の例示で緑
```

> 注意: 降格後は **∃ の保証**（例示で反例が見つからなかった）に格下げされます。Z3 の「∀ 証明」
> ではありません。レポート上は同じ緑ですが、保証の強さが違う点は意識してください。

### 前件が生成範囲に反映される

`implies` の **前件（事前条件）** に書いた範囲制約（`ge` / `le` / `eq` / `ne`）は、自動生成される
fast-check の arbitrary にも反映されます。上の例なら `x ≥ 0, y ≥ 0` が反映され、探索が前件領域に集中します。

- 安全側の設計: 前件を確実に境界化できないとき（変数同士の比較など）は **無制約（全域生成）** に倒します。
  広く生成しても、前件を外れた値は `implies` が空虚に真へ畳むだけで、偽の反例は生まれません。
- 整数のみの式は **BigInt で厳密評価** されます（`number` の `2^53` 桁落ちで、恒真な整数法則を
  誤って反例扱いしないため）。実数・混在式は `number` 近似評価です。

### `mul` の線形ルール

`mul` は **少なくとも一方が定数** なら線形として Z3 で扱えます（`mul(2, x)` は OK）。
両辺が変数（`mul(x, y)`）のときだけ非線形になり、降格対象になります。

### 明示 `fallback` を優先したいとき

自動合成より自分で書いた `fallback` を優先させたい場合は、`forall` の第 3 引数で渡します:

```ts
forall(
  { x: 'int' },
  ({ x }) => /* ... */,
  { fallback: { arb: [int({ ge: 0 })], prop: (x) => /* ... */ } },
);
```

---

## 7. Vitest 非依存で使う（`/core` サブパス）

`evaluate(spec)` は判定を `Verdict` 値で返す **純粋関数** で、Vitest に依存しません。
ルートエントリ（`vitest-forall`）は `verify()` 経由で `vitest` を読み込むため、Vitest を入れずに
コアだけ使いたいときは **`vitest-forall/core`** から import します。

```ts
import { evaluate } from 'vitest-forall/core'; // vitest を一切読み込まない

const verdict = await evaluate({
  negation: (z) => {
    const b = z.Int.const('b');
    return z.And(b.neq(0), b.eq(0)); // 恒真な否定 → UNSAT
  },
});

console.log(verdict.status); // 'proved'
```

### `Verdict` の全分岐

`evaluate` は例外を投げず、判定を必ず以下のいずれかの値で返します（全域関数）。

| `status` | 意味 | `verify` での扱い |
|---|---|---|
| `proved` | ¬P が UNSAT → ∀ 成立 | テスト緑 |
| `refuted` | SAT / ∃ 失敗 → `counterexample` あり | `反例が存在: ...` で fail |
| `fallback-passed` | unknown → fast-check の例示が通った | テスト緑 |
| `error` | unknown かつ `fallback` 未指定（`reason` あり） | `reason` で fail |

> `forall` を使うと変数がある限り fallback が自動合成されるため、通常 `error` には落ちません。
> `error` は生の `negation` を使い、判定不能なのに `fallback` を書き忘れた **設定ミス** を表します。

このように「失敗すべきケース」も `expect(verdict.status).toBe('refuted')` と **値で肯定的に検査** できる
のが `evaluate` を分離している理由です（テストツール自身をテストできる）。

---

## 8. コンビネータ／API リファレンス

### 公開関数・値

| API | 説明 |
|---|---|
| `verify(name, spec)` | `spec` を Z3 で検証し Vitest の `test` として登録する薄い殻 |
| `evaluate(spec)` | ★純粋関数。判定を `Verdict` 値で返す。Vitest 非依存 |
| `forall(decls, predicate, opts?)` | 述語 DSL で性質を書き `VerifySpec` を組む（否定は内部／unknown 時は自動降格） |
| `int(c?)` / `real(c?)` | fallback 用の制約付き fast-check arbitrary |
| `getZ3Context()` | Z3 `Context` を遅延初期化して返す（シングルトン） |
| `toZ3(z, formula)` | `Formula`（IR）を Z3 式へ変換する低レベル関数 |
| `DEFAULT_TIMEOUT_MS` | `timeout` 未指定時の既定 Z3 タイムアウト（`10_000` ms） |

### `forall` のコンビネータ

| 種別 | コンビネータ |
|---|---|
| 変数 | `intVar(name)` / `realVar(name)`（`forall` 内ではハンドルが渡るので通常は不要） |
| リテラル | `lit(value)`（項位置の `number` は自動昇格するので明示は任意） |
| 算術 | `add` / `sub` / `mul`（定数倍のみ線形）/ `neg` |
| 比較 | `lt` / `le` / `gt` / `ge` / `eq` / `ne` |
| 論理 | `and(...)` / `or(...)` / `not(f)` / `implies(ante, cons)` |

- `and` / `or` は可変長。空の `and()` は真、空の `or()` は偽（恒等元）。
- 比較・算術の項位置には `number` をそのまま書けます（`ge(balance, 0)`）。

### `VerifySpec`

| フィールド | 型 | 説明 |
|---|---|---|
| `negation` | `(z) => Bool` | 性質の **否定**。UNSAT なら ∀ 成立 |
| `fallback?` | `{ arb, prop }` | `unknown` 時に走らせる fast-check の ∃ 検証 |
| `timeout?` | `number` | Z3 タイムアウト(ms)。未指定でも既定 `10_000` ms |

### `int` / `real` の制約

```ts
int({ ge: 0, le: 100, ne: 50 }); // 0〜100 の整数、ただし 50 を除く
real({ ge: 0 });                 // 0 以上の実数（NaN / Infinity は常に除外）
```

| 制約 | 意味 |
|---|---|
| `ge` | 下限（含む） |
| `le` | 上限（含む） |
| `ne` | この値は生成しない |

---

## 9. よくあるパターン集

### 不変条件（invariant）

```ts
// ∀ n: int. n ≥ 0 → abs(n) == n のような「常に成り立つべき関係」
verify(
  '非負入力では絶対値は恒等',
  forall({ n: 'int' }, ({ n }) => implies(ge(n, 0), eq(n, n))),
);
```

### 境界・上限の保証

```ts
// ∀ x: int. 0≤x≤100 → 0 ≤ clamp(x) ≤ 100 のような範囲保証
verify(
  'クランプ結果は範囲内',
  forall({ x: 'int' }, ({ x }) =>
    implies(and(ge(x, 0), le(x, 100)), and(ge(x, 0), le(x, 100))),
  ),
);
```

### 網羅性（分岐の抜け検出）

生の `negation` で「どの分岐にも当てはまらない値が存在しないこと」を示すのが簡潔です
（→ [3 章の例](#網羅性の証明分岐の抜け検出)）。

### ∃ と ∀ を並べる

```ts
test('代表例', () => expect(f(2)).toBe(4));            // ∃
verify('常に非負', forall({ x: 'int' }, ({ x }) => ge(mul(x, x), 0))); // ∀（自動降格）
```

---

## 10. トラブルシューティング

### 初回実行が遅い

`z3-solver` の `init()` は WASM 読み込みで初回数秒〜十数秒かかります。`Context` は
シングルトンで使い回されるため、2 回目以降は速くなります。メタテストでは `testTimeout` を伸ばしてください。

### `error`（unknown かつ fallback 未指定）になる

生の `negation` が非線形などで `unknown` を返したのに `fallback` を書いていません。
`forall` に書き換える（変数があれば自動降格する）か、`fallback` を明示してください。

### `unknown` ばかりで Z3 が証明してくれない

性質が Z3 の得意領域（**線形算術・整数/実数・比較・論理結合**）の外にある可能性が高いです。
**変数同士の積・複雑な文字列制約・ループ** は対象外で、`forall` なら自動で fast-check に降格します。
証明（`proved`）が欲しい場合は、性質を線形な形に書き換えられないか検討してください。

### タイムアウトする / CI が終わらない

既定で `10_000` ms（`DEFAULT_TIMEOUT_MS`）のタイムアウトが効き、超過すると `unknown` 扱いで
fast-check に降格します。重い検証は `spec.timeout`（または `forall` の第 3 引数）で調整し、
CI では検証対象をスコープしてください。

### 反例が出るが「正しい」はずなのに……

- 前件（`implies` の左）が緩すぎて、想定外の入力まで含めていないか確認してください。
- 実数を含む式は `number` 近似評価のため、Z3 の厳密な有理数演算と稀に食い違うことがあります
  （厳密な実数評価はスコープ外）。境界値は整数で表現できないか検討してください。

---

## 11. さらに詳しく

- 設計思想・アーキテクチャ（4 層）・検証の原理 → [`initial-design.md`](../initial-design.md)
- 概要・最小例・API 早見 → [`README.md`](../README.md)
- 開発方針（TDD・関数型・メタテスト） → [`CLAUDE.md`](../CLAUDE.md)
- 動くサンプル → [`examples/wallet.test.ts`](../examples/wallet.test.ts)
</content>
</invoke>
