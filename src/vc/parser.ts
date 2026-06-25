// Phase B: 述語 DSL → 中間表現(IR)（設計書 §5・§9-8）。
//
// 設計書は「TS 式に近い述語」を Z3 式へ機械変換する層を要求する。任意 TS ソースの構文解析は
// 記号実行に踏み込む（§3 Phase C, スコープ外）ため、ここでは型付きコンビネータ DSL を提供する：
// 利用者は add/gt/and… を関数として組み、結果は不変な IR（直和型）になる。
// IR を中間表現に挟むことで「DSL の構築」と「Z3 への変換(to-z3.ts)」を分離し、各々を純粋に検査できる。
//
// 線形算術・整数/実数・比較・論理結合に対象を限定する（§8 得意領域）。非線形などの変換可否は
// to-z3.ts が担い、ここは純粋なデータ構築に徹する（副作用なし）。
import type { VerifySpec } from '../core';
import { toZ3 } from './to-z3';

export type Sort = 'int' | 'real';

// 数値項（ソートは int / real）。すべて不変。
export type Term =
  | { readonly kind: 'var'; readonly name: string; readonly sort: Sort }
  | { readonly kind: 'lit'; readonly value: number }
  | { readonly kind: 'add'; readonly left: Term; readonly right: Term }
  | { readonly kind: 'sub'; readonly left: Term; readonly right: Term }
  | { readonly kind: 'mul'; readonly left: Term; readonly right: Term }
  | { readonly kind: 'neg'; readonly term: Term };

export type CmpOp = 'lt' | 'le' | 'gt' | 'ge' | 'eq' | 'ne';

// 真偽式（比較・論理結合）。これが ∀ で示したい「性質」を表す。
export type Formula =
  | { readonly kind: 'cmp'; readonly op: CmpOp; readonly left: Term; readonly right: Term }
  | { readonly kind: 'and'; readonly items: readonly Formula[] }
  | { readonly kind: 'or'; readonly items: readonly Formula[] }
  | { readonly kind: 'not'; readonly formula: Formula }
  | { readonly kind: 'implies'; readonly ante: Formula; readonly cons: Formula };

// 項位置では数値リテラルをそのまま書けると DSL が読みやすい（`add(a, 3)`）。
// number は lit ノードへ昇格する。
export type Termish = Term | number;

const term = (t: Termish): Term => (typeof t === 'number' ? { kind: 'lit', value: t } : t);

export const intVar = (name: string): Term => ({ kind: 'var', name, sort: 'int' });
export const realVar = (name: string): Term => ({ kind: 'var', name, sort: 'real' });
export const lit = (value: number): Term => ({ kind: 'lit', value });

export const add = (left: Termish, right: Termish): Term => ({
  kind: 'add',
  left: term(left),
  right: term(right),
});
export const sub = (left: Termish, right: Termish): Term => ({
  kind: 'sub',
  left: term(left),
  right: term(right),
});
export const mul = (left: Termish, right: Termish): Term => ({
  kind: 'mul',
  left: term(left),
  right: term(right),
});
export const neg = (t: Termish): Term => ({ kind: 'neg', term: term(t) });

const cmp =
  (op: CmpOp) =>
  (left: Termish, right: Termish): Formula => ({ kind: 'cmp', op, left: term(left), right: term(right) });

export const lt = cmp('lt');
export const le = cmp('le');
export const gt = cmp('gt');
export const ge = cmp('ge');
export const eq = cmp('eq');
export const ne = cmp('ne');

export const and = (...items: Formula[]): Formula => ({ kind: 'and', items });
export const or = (...items: Formula[]): Formula => ({ kind: 'or', items });
export const not = (formula: Formula): Formula => ({ kind: 'not', formula });
export const implies = (ante: Formula, cons: Formula): Formula => ({ kind: 'implies', ante, cons });

// ∀ DSL。変数の宣言（名前→ソート）と述語（性質 P）を受け取り、VerifySpec を組む。
// 「∀ P が成立」⇔「¬P が UNSAT」なので、negation には not(P) を変換して渡す（§2 検証の原理）。
// fallback / timeout は core の VerifySpec にそのまま委譲する。
export type VarDecls = Record<string, Sort>;
type VarHandles<D extends VarDecls> = { readonly [K in keyof D]: Term };

export function forall<D extends VarDecls>(
  decls: D,
  predicate: (vars: VarHandles<D>) => Formula,
  options?: Pick<VerifySpec, 'fallback' | 'timeout'>,
): VerifySpec {
  const vars = Object.fromEntries(
    Object.entries(decls).map(([name, sort]) => [name, { kind: 'var', name, sort }]),
  ) as VarHandles<D>;
  const property = predicate(vars);
  return {
    negation: (z) => toZ3(z, not(property)),
    ...options,
  };
}
