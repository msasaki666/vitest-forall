import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  add,
  and,
  eq,
  ge,
  gt,
  implies,
  intVar,
  le,
  lt,
  mul,
  ne,
  or,
  type Sort,
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

describe('堅牢性: プロトタイプ汚染と充足不能区間', () => {
  test('__proto__ という変数名でも prop は実数値で評価する（偽の反例を作らない）', () => {
    // env を素の {} で組むと env['__proto__']=v が握り潰され、評価が NaN 化して全 false になる。
    // すると 0*0≥0 のような真の性質まで「反例あり」と誤判定する。これを防ぐ。
    // 本物の own キー '__proto__' を持つ decls を組む（object リテラルの `__proto__:` は
    // プロトタイプ設定構文で own キーにならないため defineProperty で明示的に置く）。
    const decls: Record<string, Sort> = { x: 'int' };
    Object.defineProperty(decls, '__proto__', { value: 'int', enumerable: true });
    const fallback = buildAutoFallback(decls, ge(mul(intVar('__proto__'), intVar('x')), 0));
    expect(fallback).toBeDefined();
    if (!fallback) return;
    const prop = fallback.prop as (...xs: number[]) => boolean;
    expect(prop(0, 0)).toBe(true); // 0*0 ≥ 0 は真。NaN 化して false を返してはいけない
    expect(prop(2, 3)).toBe(true);
    expect(prop(1, -1)).toBe(false); // 1*-1 = -1 は本物の反例
  });

  test('constructor という変数名でも正しく評価する', () => {
    const decls: Record<string, Sort> = {};
    decls['constructor'] = 'int';
    const fallback = buildAutoFallback(decls, ge(intVar('constructor'), 0));
    expect(fallback).toBeDefined();
    if (!fallback) return;
    const prop = fallback.prop as (...xs: number[]) => boolean;
    expect(prop(5)).toBe(true);
    expect(prop(-1)).toBe(false);
  });

  test('__proto__ を含む前件は推論結果のプロトタイプを書き換えない', () => {
    const c = inferConstraints(
      implies(and(ge(intVar('__proto__'), 5), le(intVar('__proto__'), 9)), gt(intVar('a'), 0)),
    );
    expect(Object.getPrototypeOf(c)).toBeNull(); // プロトタイプ汚染が起きていない
    expect(c['a']).toBeUndefined(); // 無関係な a に範囲が漏れない
  });

  test('充足不能な区間（下限 > 上限）は制約を落として全域生成へ戻す', () => {
    // implies(5≤a≤3, …) は前件が偽 → 空虚に真。空の arbitrary を作って例外を投げてはいけない。
    const a = intVar('a');
    const property = implies(and(ge(a, 5), le(a, 3)), gt(a, -100));
    expect(inferConstraints(property)['a']).toBeUndefined();
    expect(() => buildAutoFallback({ a: 'int' }, property)).not.toThrow();
  });

  test('eq と ne が同じ値で衝突する区間も落とす（空 arbitrary 回避）', () => {
    // eq(a,5) → [5,5]、ne(a,5) で 5 を除外 → 生成可能値ゼロ。前件は充足不能 → 空虚に真。
    const a = intVar('a');
    const property = implies(and(eq(a, 5), ne(a, 5)), gt(a, -100));
    expect(inferConstraints(property)['a']).toBeUndefined();
    expect(() => buildAutoFallback({ a: 'int' }, property)).not.toThrow();
  });

  test('int 変数の端数下限は整数ドメインへ丸める（fc.integer の例外回避 / Codex P2 第2弾）', () => {
    // ge(a, 0.5) をそのまま int(c) に渡すと fc.integer が min=0.5 で例外。ceil で整数化する。
    // a≥0.5 ⇔ 整数 a≥1 なので ceil は整数解集合を変えない（厳密）。
    const a = intVar('a');
    const property = implies(ge(a, 0.5), gt(a, -100));
    expect(() => buildAutoFallback({ a: 'int' }, property)).not.toThrow();
    const fallback = buildAutoFallback({ a: 'int' }, property);
    if (!fallback) return;
    fc.assert(
      fc.property(fallback.arb[0], (v) => Number.isInteger(v as number) && (v as number) >= 1),
    );
  });

  test('整数解が無い端数区間は落として全域生成（0.1<a<0.9 は整数上で充足不能）', () => {
    const a = intVar('a');
    const property = implies(and(gt(a, 0.1), lt(a, 0.9)), gt(a, -100));
    expect(() => buildAutoFallback({ a: 'int' }, property)).not.toThrow();
  });

  test('整数式は厳密演算で評価する（桁あふれで偽の反例を出さない / Codex P2）', () => {
    // (a*b)*c == a*(b*c) は整数で恒真。だが 32bit 値の積は 2^53 を超え number では桁落ちし、
    // Z3 の無限精度整数と食い違って「偽の反例」になる。BigInt で厳密評価して防ぐ。
    const a = intVar('a');
    const b = intVar('b');
    const c = intVar('c');
    const assoc = eq(mul(mul(a, b), c), mul(a, mul(b, c)));
    const fallback = buildAutoFallback({ a: 'int', b: 'int', c: 'int' }, assoc);
    expect(fallback).toBeDefined();
    if (!fallback) return;
    const prop = fallback.prop as (...xs: number[]) => boolean;
    // Codex が挙げた具体反例。number 評価だと false（偽の反例）になる。
    expect(prop(-1585091834, 727911282, -600332116)).toBe(true);
  });
});
