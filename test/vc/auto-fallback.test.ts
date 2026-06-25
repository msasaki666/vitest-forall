import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  add,
  and,
  ge,
  gt,
  implies,
  intVar,
  le,
  lt,
  mul,
  ne,
  or,
} from '../../src/vc/parser';
import { buildAutoFallback, inferConstraints } from '../../src/vc/auto-fallback';

// 自動フォールバック層（設計書 §9-9）。
// Z3 が unknown を返した forall を、IR から fast-check の ∃ 検証へ機械的に降格させる。
// ここでは「制約推論」と「Fallback 合成」を Z3 抜きで純粋に検査する。
describe('inferConstraints: implies の前件から変数の範囲を推論する', () => {
  test('implies でなければ制約なし（全域生成）', () => {
    // 前件＝事前条件は implies のときだけ意味を持つ。単独の性質は無制約で探索する。
    expect(inferConstraints(gt(intVar('a'), 0))).toEqual({});
  });

  test('前件の ge / le から下限・上限を取る', () => {
    const a = intVar('a');
    const property = implies(and(ge(a, 0), le(a, 100)), gt(add(a, 1), a));
    expect(inferConstraints(property)).toEqual({ a: { ge: 0, le: 100 } });
  });

  test('gt / lt は境界を含む向きへ緩める（安全側：偽の反例を作らない）', () => {
    // gt(a,0) を ge:0 に緩めても、a=0 は前件偽で空虚に真になるだけ。逆に狭めると反例を取りこぼす。
    const a = intVar('a');
    expect(inferConstraints(implies(gt(a, 0), gt(a, -1)))).toEqual({ a: { ge: 0 } });
    expect(inferConstraints(implies(lt(a, 9), gt(a, -1)))).toEqual({ a: { le: 9 } });
  });

  test('定数が左・変数が右の比較も向きを反転して扱う', () => {
    // ge(5, a) は 5 >= a すなわち a <= 5。
    const a = intVar('a');
    expect(inferConstraints(implies(ge(5, a), gt(a, -100)))).toEqual({ a: { le: 5 } });
  });

  test('eq は上下限で挟み、ne はそのまま除外値にする', () => {
    const a = intVar('a');
    expect(inferConstraints(implies(ne(a, 0), gt(a, -100)))).toEqual({ a: { ne: 0 } });
  });

  test('複数の下限は max、複数の上限は min（区間の交わり）を取る', () => {
    const a = intVar('a');
    const property = implies(and(ge(a, 0), ge(a, 5), le(a, 100), le(a, 50)), gt(a, -1));
    expect(inferConstraints(property)).toEqual({ a: { ge: 5, le: 50 } });
  });

  test('変数同士・複合項の比較は推論をスキップする（無制約のまま＝安全）', () => {
    // le(a, b) は単一変数の数値境界に落とせない。落とせない前件は捨て、全域生成に委ねる。
    const a = intVar('a');
    const b = intVar('b');
    expect(inferConstraints(implies(le(a, b), gt(add(a, b), a)))).toEqual({});
  });

  test('or を含む前件は安全に推論できないので無視する', () => {
    const a = intVar('a');
    expect(inferConstraints(implies(or(ge(a, 0), le(a, -10)), gt(a, -100)))).toEqual({});
  });
});

describe('buildAutoFallback: IR から Fallback を合成する', () => {
  test('変数がなければ undefined（生成する arbitrary が無い）', () => {
    expect(buildAutoFallback({}, gt(add(0, 1), 0))).toBeUndefined();
  });

  test('prop は性質を具体値で評価する（反例があれば false）', () => {
    // ∀ a,b. a*b >= 0 は偽（a=1,b=-1）。prop はその具体値で false を返せること。
    const fallback = buildAutoFallback({ a: 'int', b: 'int' }, ge(mul(intVar('a'), intVar('b')), 0));
    expect(fallback).toBeDefined();
    if (!fallback) return;
    expect(fallback.arb).toHaveLength(2);
    const prop = fallback.prop as (...xs: number[]) => boolean;
    expect(prop(3, 4)).toBe(true);
    expect(prop(1, -1)).toBe(false);
  });

  test('合成した arbitrary は推論した範囲を尊重する', () => {
    // implies(0<=a<=10, ...) なら a の生成は [0,10] に収まる。前件領域に探索を集中させる狙い。
    const a = intVar('a');
    const fallback = buildAutoFallback(
      { a: 'int' },
      implies(and(ge(a, 0), le(a, 10)), gt(add(a, 1), a)),
    );
    expect(fallback).toBeDefined();
    if (!fallback) return;
    fc.assert(
      fc.property(fallback.arb[0], (value) => {
        const n = value as number;
        return n >= 0 && n <= 10;
      }),
    );
  });
});
