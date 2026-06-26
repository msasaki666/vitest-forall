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
  lit,
  lt,
  mul,
  ne,
  neg,
  not,
  or,
  realVar,
  sub,
} from '../../src/vc/parser';
import { evalFormula, evalFormulaInt, evalTerm, isIntegerFormula } from '../../src/vc/eval';

// 述語 IR の純粋インタプリタ（設計書 §9-9 フォールバック自動化の基盤）。
// fast-check へ降格するとき、IR を具体値の環境で評価して真偽を出すのがこの層。
// Z3 を介さず、IR → 数値/真偽の写像だけを純粋に検査する（全分岐を肯定的に網羅）。
describe('evalTerm: 数値項を環境で評価する', () => {
  test('var は環境から値を引く', () => {
    expect(evalTerm(intVar('a'), { a: 7 })).toBe(7);
  });

  test('lit はその値', () => {
    expect(evalTerm(add(0, 3), { a: 0 })).toBe(3);
  });

  test('add / sub / mul / neg を再帰的に評価する', () => {
    const a = intVar('a');
    const b = intVar('b');
    const env = { a: 5, b: 2 };
    expect(evalTerm(add(a, b), env)).toBe(7);
    expect(evalTerm(sub(a, b), env)).toBe(3);
    expect(evalTerm(mul(a, b), env)).toBe(10); // 非線形でも評価器は計算できる（評価は線形限定でない）
    expect(evalTerm(neg(a), env)).toBe(-5);
  });

  test('環境に無い変数はエラーで落とす（握り潰さない）', () => {
    expect(() => evalTerm(intVar('missing'), {})).toThrow();
  });

  test('継承プロパティ（__proto__ / constructor）は変数値として読まない', () => {
    // env を素の {} で組むと env['__proto__'] は Object.prototype を返す（undefined でない）。
    // own プロパティだけを見て、継承値を「変数の値」と誤読しないこと（プロトタイプ汚染対策）。
    expect(() => evalTerm(intVar('__proto__'), {})).toThrow();
    expect(() => evalTerm(intVar('constructor'), {})).toThrow();
  });
});

describe('evalFormula: 真偽式を環境で評価する', () => {
  const a = intVar('a');

  test('比較演算 lt/le/gt/ge/eq/ne を評価する', () => {
    expect(evalFormula(lt(a, 5), { a: 3 })).toBe(true);
    expect(evalFormula(lt(a, 5), { a: 5 })).toBe(false);
    expect(evalFormula(le(a, 5), { a: 5 })).toBe(true);
    expect(evalFormula(gt(a, 5), { a: 9 })).toBe(true);
    expect(evalFormula(ge(a, 5), { a: 5 })).toBe(true);
    expect(evalFormula(eq(a, 5), { a: 5 })).toBe(true);
    expect(evalFormula(ne(a, 5), { a: 5 })).toBe(false);
  });

  test('and は全要素が真のとき真。空の and は恒真（恒等元）', () => {
    expect(evalFormula(and(gt(a, 0), lt(a, 10)), { a: 5 })).toBe(true);
    expect(evalFormula(and(gt(a, 0), lt(a, 10)), { a: 20 })).toBe(false);
    expect(evalFormula(and(), { a: 0 })).toBe(true);
  });

  test('or は一つでも真なら真。空の or は恒偽（恒等元）', () => {
    expect(evalFormula(or(gt(a, 100), lt(a, 0)), { a: -1 })).toBe(true);
    expect(evalFormula(or(gt(a, 100), lt(a, 0)), { a: 5 })).toBe(false);
    expect(evalFormula(or(), { a: 0 })).toBe(false);
  });

  test('not は真偽を反転する', () => {
    expect(evalFormula(not(gt(a, 0)), { a: -1 })).toBe(true);
  });

  test('implies は ¬前件 ∨ 後件（前件が偽なら空虚に真）', () => {
    const p = implies(ge(a, 0), gt(a, 0));
    expect(evalFormula(p, { a: 5 })).toBe(true); // 前件真・後件真
    expect(evalFormula(p, { a: 0 })).toBe(false); // 前件真・後件偽 → 反例
    expect(evalFormula(p, { a: -1 })).toBe(true); // 前件偽 → 空虚に真
  });
});

describe('isIntegerFormula: 整数のみの式か（BigInt 厳密評価の可否）', () => {
  test('全変数 int・全リテラル整数なら true', () => {
    const a = intVar('a');
    const b = intVar('b');
    expect(isIntegerFormula(eq(mul(a, b), add(b, 1)))).toBe(true);
  });

  test('real 変数を含むと false（厳密整数評価の対象外）', () => {
    expect(isIntegerFormula(gt(add(intVar('a'), realVar('x')), 0))).toBe(false);
  });

  test('非整数リテラルを含むと false', () => {
    expect(isIntegerFormula(gt(intVar('a'), lit(2.5)))).toBe(false);
  });
});

describe('evalFormulaInt: 整数式を BigInt で厳密評価する', () => {
  const a = intVar('a');
  const b = intVar('b');
  const c = intVar('c');

  test('基本的な比較・論理は number 版と一致する', () => {
    expect(evalFormulaInt(gt(add(a, b), 0), { a: 3, b: -1 })).toBe(true);
    expect(evalFormulaInt(implies(ge(a, 0), gt(a, 0)), { a: 0 })).toBe(false);
  });

  test('2^53 を超える積でも桁落ちせず厳密に判定する', () => {
    // (a*b)*c == a*(b*c) は整数で恒真。number だと桁落ちして false（偽の反例）になる値。
    const assoc = eq(mul(mul(a, b), c), mul(a, mul(b, c)));
    const env = { a: -1585091834, b: 727911282, c: -600332116 };
    expect(evalFormula(assoc, env)).toBe(false); // number 評価は桁落ちで誤判定
    expect(evalFormulaInt(assoc, env)).toBe(true); // BigInt 評価は厳密に恒真
  });
});
