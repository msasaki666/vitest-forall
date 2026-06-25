// 述語 IR の純粋インタプリタ（設計書 §9-9 フォールバック自動化の基盤）。
//
// Z3 が unknown を返した領域を fast-check の ∃ 例示で埋めるには、IR（Term/Formula）を
// 具体値の環境で評価して真偽を出す手段が要る。to-z3.ts が IR → Z3 式の写像なら、
// このモジュールは IR → 数値/真偽 の写像。入力（IR と環境）から出力が一意に決まる純粋関数で、
// 副作用は持たない。to-z3.ts と違い線形限定でない（乗算も普通に計算する）——
// 評価器は Z3 のような全称的判定ではなく、与えられた 1 点の値を計算するだけだからである。
import type { CmpOp, Formula, Term } from './parser';

// 変数名 → 具体値。fast-check が生成した 1 サンプルを表す。
export type Env = Readonly<Record<string, number>>;

// 網羅性の番人。直和型に新メンバを足して分岐を書き忘れると never 代入不能でコンパイルエラー。
function assertNever(x: never): never {
  throw new Error(`網羅されていない IR ノード: ${JSON.stringify(x)}`);
}

// 数値項を環境で評価する。未定義変数は握り潰さず明示エラーで落とす（環境の組み立てミスを露呈させる）。
export function evalTerm(term: Term, env: Env): number {
  switch (term.kind) {
    case 'var': {
      const value = env[term.name];
      if (value === undefined) throw new Error(`環境に変数 ${term.name} がない`);
      return value;
    }
    case 'lit':
      return term.value;
    case 'add':
      return evalTerm(term.left, env) + evalTerm(term.right, env);
    case 'sub':
      return evalTerm(term.left, env) - evalTerm(term.right, env);
    case 'mul':
      return evalTerm(term.left, env) * evalTerm(term.right, env);
    case 'neg':
      return -evalTerm(term.term, env);
    default:
      return assertNever(term);
  }
}

// 真偽式を環境で評価する。and/or の空配列は恒等元（and→true, or→false）で parser の意味論に揃える。
export function evalFormula(formula: Formula, env: Env): boolean {
  switch (formula.kind) {
    case 'cmp':
      return compare(formula.op, evalTerm(formula.left, env), evalTerm(formula.right, env));
    case 'and':
      return formula.items.every((f) => evalFormula(f, env));
    case 'or':
      return formula.items.some((f) => evalFormula(f, env));
    case 'not':
      return !evalFormula(formula.formula, env);
    case 'implies':
      // ¬前件 ∨ 後件。前件が偽なら後件を見ずに空虚に真。
      return !evalFormula(formula.ante, env) || evalFormula(formula.cons, env);
    default:
      return assertNever(formula);
  }
}

function compare(op: CmpOp, left: number, right: number): boolean {
  switch (op) {
    case 'lt':
      return left < right;
    case 'le':
      return left <= right;
    case 'gt':
      return left > right;
    case 'ge':
      return left >= right;
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    default:
      return assertNever(op);
  }
}
