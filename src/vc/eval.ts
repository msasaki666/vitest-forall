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

// 環境から変数値を引く。env は呼び出し側が任意のキー（利用者の変数名）で組む。素の {} だと
// env['__proto__'] は Object.prototype を返し undefined チェックをすり抜けるため、own プロパティ
// だけを見て継承値を変数の値と誤読しない（プロトタイプ汚染で偽の反例を出さないため）。
// 未定義変数は握り潰さず明示エラーで落とす（環境の組み立てミスを露呈させる）。
function lookupVar(env: Env, name: string): number {
  if (!Object.prototype.hasOwnProperty.call(env, name)) {
    throw new Error(`環境に変数 ${name} がない`);
  }
  const value = env[name];
  if (value === undefined) throw new Error(`環境に変数 ${name} がない`);
  return value;
}

// 数値項を環境で評価する（number 演算）。実数や混在式の近似評価に使う。
// 整数式の厳密評価は evalTermInt（BigInt）を使うこと（number は 2^53 超の積で桁落ちする）。
export function evalTerm(term: Term, env: Env): number {
  switch (term.kind) {
    case 'var':
      return lookupVar(env, term.name);
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

// ── 整数式の厳密評価（BigInt） ──────────────────────────────────
//
// Z3 の Int は無限精度。これを number で評価すると 2^53 を超える積で桁落ちし、恒真な整数法則
// （例: 結合則 (a*b)*c == a*(b*c)）でも左右がずれて「偽の反例」を生む（Codex P2 指摘）。
// 全変数が int・全リテラルが整数の式は BigInt で厳密に評価し、Z3 の整数意味論と一致させる。
// （実数・混在式の厳密評価は有理数演算が要るため対象外。number 近似のまま evalFormula を使う。）

// 整数ソートのみで構成された式か（全変数が int、全リテラルが整数）。真なら BigInt 厳密評価が使える。
export function isIntegerFormula(formula: Formula): boolean {
  switch (formula.kind) {
    case 'cmp':
      return isIntegerTerm(formula.left) && isIntegerTerm(formula.right);
    case 'and':
    case 'or':
      return formula.items.every(isIntegerFormula);
    case 'not':
      return isIntegerFormula(formula.formula);
    case 'implies':
      return isIntegerFormula(formula.ante) && isIntegerFormula(formula.cons);
    default:
      return assertNever(formula);
  }
}

function isIntegerTerm(term: Term): boolean {
  switch (term.kind) {
    case 'var':
      return term.sort === 'int';
    case 'lit':
      return Number.isInteger(term.value);
    case 'neg':
      return isIntegerTerm(term.term);
    case 'add':
    case 'sub':
    case 'mul':
      return isIntegerTerm(term.left) && isIntegerTerm(term.right);
    default:
      return assertNever(term);
  }
}

// 整数式を BigInt で厳密評価する。env の値は整数前提（int 変数 → fc.integer 由来）。
export function evalFormulaInt(formula: Formula, env: Env): boolean {
  switch (formula.kind) {
    case 'cmp':
      return compareInt(formula.op, evalTermInt(formula.left, env), evalTermInt(formula.right, env));
    case 'and':
      return formula.items.every((f) => evalFormulaInt(f, env));
    case 'or':
      return formula.items.some((f) => evalFormulaInt(f, env));
    case 'not':
      return !evalFormulaInt(formula.formula, env);
    case 'implies':
      return !evalFormulaInt(formula.ante, env) || evalFormulaInt(formula.cons, env);
    default:
      return assertNever(formula);
  }
}

function evalTermInt(term: Term, env: Env): bigint {
  switch (term.kind) {
    case 'var':
      // 整数式の前提なので値は整数。BigInt 化で厳密な無限精度演算に乗せる。
      return BigInt(lookupVar(env, term.name));
    case 'lit':
      return BigInt(term.value);
    case 'add':
      return evalTermInt(term.left, env) + evalTermInt(term.right, env);
    case 'sub':
      return evalTermInt(term.left, env) - evalTermInt(term.right, env);
    case 'mul':
      return evalTermInt(term.left, env) * evalTermInt(term.right, env);
    case 'neg':
      return -evalTermInt(term.term, env);
    default:
      return assertNever(term);
  }
}

function compareInt(op: CmpOp, left: bigint, right: bigint): boolean {
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
