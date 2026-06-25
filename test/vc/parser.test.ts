import { describe, expect, test } from 'vitest';
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
  neg,
  not,
  or,
  realVar,
  sub,
} from '../../src/vc/parser';

// 述語DSL の単体テスト（設計書 §5・§9-8）。
// ここでは Z3 を介さず「DSL コンストラクタが期待どおりの中間表現(IR)を組むか」だけを純粋に検査する。
// IR は不変なプレーンオブジェクトの直和型なので toEqual で構造を肯定的に確認できる。
describe('述語DSL: 中間表現(IR)の構築', () => {
  test('intVar / realVar は sort 付きの var ノードを作る', () => {
    expect(intVar('a')).toEqual({ kind: 'var', name: 'a', sort: 'int' });
    expect(realVar('x')).toEqual({ kind: 'var', name: 'x', sort: 'real' });
  });

  test('数値リテラルは項位置で lit ノードに自動昇格される', () => {
    expect(add(intVar('a'), 3)).toEqual({
      kind: 'add',
      left: { kind: 'var', name: 'a', sort: 'int' },
      right: { kind: 'lit', value: 3 },
    });
  });

  test('算術コンストラクタ sub / mul / neg は対応するノードを作る', () => {
    const a = intVar('a');
    expect(sub(a, 1)).toEqual({ kind: 'sub', left: a, right: { kind: 'lit', value: 1 } });
    expect(mul(2, a)).toEqual({ kind: 'mul', left: { kind: 'lit', value: 2 }, right: a });
    expect(neg(a)).toEqual({ kind: 'neg', term: a });
  });

  test('比較コンストラクタは op 付きの cmp ノードを作る', () => {
    const a = intVar('a');
    expect(gt(a, 100)).toEqual({ kind: 'cmp', op: 'gt', left: a, right: { kind: 'lit', value: 100 } });
    expect(lt(a, 0)).toEqual({ kind: 'cmp', op: 'lt', left: a, right: { kind: 'lit', value: 0 } });
    expect(ge(a, 0)).toEqual({ kind: 'cmp', op: 'ge', left: a, right: { kind: 'lit', value: 0 } });
    expect(le(a, 9)).toEqual({ kind: 'cmp', op: 'le', left: a, right: { kind: 'lit', value: 9 } });
    expect(eq(a, 5)).toEqual({ kind: 'cmp', op: 'eq', left: a, right: { kind: 'lit', value: 5 } });
    expect(ne(a, 5)).toEqual({ kind: 'cmp', op: 'ne', left: a, right: { kind: 'lit', value: 5 } });
  });

  test('論理結合 and / or は items 配列、not / implies は専用形を作る', () => {
    const p = gt(intVar('a'), 0);
    const q = lt(intVar('a'), 10);
    expect(and(p, q)).toEqual({ kind: 'and', items: [p, q] });
    expect(or(p, q)).toEqual({ kind: 'or', items: [p, q] });
    expect(not(p)).toEqual({ kind: 'not', formula: p });
    expect(implies(p, q)).toEqual({ kind: 'implies', ante: p, cons: q });
  });
});
