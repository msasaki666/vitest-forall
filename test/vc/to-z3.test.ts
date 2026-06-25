import { describe, expect, test } from 'vitest';
import { evaluate } from '../../src/core';
import { int } from '../../src/arbitraries';
import { getZ3Context } from '../../src/z3-context';
import {
  add,
  and,
  forall,
  ge,
  gt,
  implies,
  intVar,
  le,
  mul,
  not,
  realVar,
  sub,
} from '../../src/vc/parser';
import { NonlinearError, toZ3 } from '../../src/vc/to-z3';

// VC生成層の結合テスト（設計書 §5・§9-8）。
// toZ3 は中間表現(IR)を Z3 式へ変換する純粋関数。検証の原理は evaluate と同じく
// 「性質 P を ∀ で示す」⇔「¬P が UNSAT」。よって negation に not(P) を渡し、
// proved（恒真）/ refuted（反例あり）を Verdict 値で肯定的に検査する（スイートを赤くしない）。
describe('toZ3: 中間表現 → Z3式（線形算術）', () => {
  test('恒真な線形不等式は proved（∀ 成立）', async () => {
    // ∀ a:int. a + 1 > a
    const a = intVar('a');
    const v = await evaluate({ negation: (z) => toZ3(z, not(gt(add(a, 1), a))) });
    expect(v.status).toBe('proved');
  });

  test('反証可能な性質は refuted で具体的な反例 model を返す', async () => {
    // ∀ a:int. a > 0 は偽（a = 0 が反例）
    const a = intVar('a');
    const v = await evaluate({ negation: (z) => toZ3(z, not(gt(a, 0))) });
    expect(v.status).toBe('refuted');
    if (v.status === 'refuted') expect(v.counterexample).toContain('Int');
  });

  test('and / or / implies / not を組み合わせた性質を変換できる', async () => {
    // ∀ b,w:int. (b>=0 ∧ w>=0 ∧ w<=b) → b - w >= 0
    const b = intVar('b');
    const w = intVar('w');
    const p = implies(and(ge(b, 0), ge(w, 0), le(w, b)), ge(sub(b, w), 0));
    const v = await evaluate({ negation: (z) => toZ3(z, not(p)) });
    expect(v.status).toBe('proved');
  });

  test('定数倍（線形な乗算）は扱える', async () => {
    // ∀ a:int. a>=0 → 2*a >= a
    const a = intVar('a');
    const p = implies(ge(a, 0), ge(mul(2, a), a));
    const v = await evaluate({ negation: (z) => toZ3(z, not(p)) });
    expect(v.status).toBe('proved');
  });

  test('実数ソートの性質も扱える', async () => {
    // ∀ x:real. x>0 → x + x > x
    const x = realVar('x');
    const p = implies(gt(x, 0), gt(add(x, x), x));
    const v = await evaluate({ negation: (z) => toZ3(z, not(p)) });
    expect(v.status).toBe('proved');
  });

  test('int と real が混在する項は real ソートへ持ち上げて扱える', async () => {
    // ∀ i:int, x:real. x>=0 → i + x >= i
    // add(int, real) のように int 項が先に来ても real に揃え、Int/Real 混在で error に劣化させない。
    const i = intVar('i');
    const x = realVar('x');
    const p = implies(ge(x, 0), ge(add(i, x), i));
    const v = await evaluate({ negation: (z) => toZ3(z, not(p)) });
    expect(v.status).toBe('proved');
  });

  test('リテラルのみの比較でも小数があれば real に揃える', async () => {
    // gt(2.5, 2): 両辺リテラルだが片方が小数。int 既定のままだと Int/Real 混在で error に劣化する。
    // 2.5 > 2 は真なので not(...) は UNSAT → proved。
    const v = await evaluate({ negation: (z) => toZ3(z, not(gt(2.5, 2))) });
    expect(v.status).toBe('proved');
  });

  test('変数同士の積は NonlinearError を投げる（線形限定の境界）', async () => {
    const z = await getZ3Context();
    const a = intVar('a');
    const b = intVar('b');
    expect(() => toZ3(z, ge(mul(a, b), 0))).toThrow(NonlinearError);
  });

  test('非線形を含む spec は evaluate 内で unknown に畳まれ、fallback 無しなら error', async () => {
    // 非線形 → toZ3 が throw → evaluate が握り潰さず unknown 扱い → fallback 未指定で error
    const a = intVar('a');
    const b = intVar('b');
    const v = await evaluate({ negation: (z) => toZ3(z, ge(mul(a, b), 0)) });
    expect(v.status).toBe('error');
  });
});

describe('forall: ∀ DSL から VerifySpec を組む', () => {
  test('成立する性質は proved（内部で性質を否定して UNSAT 判定）', async () => {
    const spec = forall({ balance: 'int', amount: 'int' }, ({ balance, amount }) =>
      implies(
        and(ge(balance, 0), ge(amount, 0), le(amount, balance)),
        ge(sub(balance, amount), 0),
      ),
    );
    const v = await evaluate(spec);
    expect(v.status).toBe('proved');
  });

  test('成立しない性質は refuted', async () => {
    const spec = forall({ a: 'int' }, ({ a }) => gt(a, 0));
    const v = await evaluate(spec);
    expect(v.status).toBe('refuted');
  });

  test('非線形だが成立する性質は fallback-passed（自動 ∃ 降格）', async () => {
    // ∀ a,b:int. (a≥0 ∧ b≥0) → a*b ≥ 0。変数同士の積で Z3 は unknown。
    // fallback 未指定でも IR から ∃ 検証が自動合成され、反例なしで fallback-passed。
    const spec = forall({ a: 'int', b: 'int' }, ({ a, b }) =>
      implies(and(ge(a, 0), ge(b, 0)), ge(mul(a, b), 0)),
    );
    const v = await evaluate(spec);
    expect(v.status).toBe('fallback-passed');
  });

  test('非線形で成立しない性質は fallback で反例を見つけ refuted', async () => {
    // ∀ a,b:int. a*b ≥ 0 は偽（a=1, b=-1）。Z3 は unknown → 自動 ∃ 降格が反例を検出。
    const spec = forall({ a: 'int', b: 'int' }, ({ a, b }) => ge(mul(a, b), 0));
    const v = await evaluate(spec);
    expect(v.status).toBe('refuted');
  });

  test('明示した fallback は自動合成より優先される', async () => {
    // 自動合成なら反例が出る性質でも、利用者が prop:()=>true の fallback を渡せばそれを使う。
    const spec = forall({ a: 'int', b: 'int' }, ({ a, b }) => ge(mul(a, b), 0), {
      fallback: { arb: [int()], prop: () => true },
    });
    const v = await evaluate(spec);
    expect(v.status).toBe('fallback-passed');
  });
});
