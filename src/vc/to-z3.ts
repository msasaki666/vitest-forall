// Phase B: 中間表現(IR) → Z3 式（線形算術のみ対応、設計書 §5・§8・§9-8）。
//
// parser.ts が組んだ Formula/Term を z3-solver の式へ変換する。変換は入力 IR から出力式が
// 一意に決まる純粋な写像（Z3 の式生成自体に観測可能な副作用はない）。
// 対象は線形算術・整数/実数・比較・論理結合に限る。変数同士の積（非線形）は NonlinearError で
// 拒否し、呼び出し側（evaluate）が unknown へ畳んで fast-check へ降格できるようにする（§8）。
//
// 型の注記: parser.ts から IR 型のみを import する（`import type`）。実体としては
// parser → to-z3（toZ3 を利用）の一方向依存であり、型は消去されるので循環参照は生じない。
import type { Arith, Bool } from 'z3-solver';
import type { Z3Context } from '../z3-context';
import type { CmpOp, Formula, Sort, Term } from './parser';

// 線形算術の境界を越えた（変数×変数）ことを表す。evaluate はこれを捕捉し unknown 扱いにする。
export class NonlinearError extends Error {
  constructor(message = '非線形（変数同士の積）は線形算術ソルバの対象外') {
    super(message);
    this.name = 'NonlinearError';
  }
}

// 網羅性の番人。直和型に新メンバを足したのに分岐を書き忘れると、ここでコンパイルエラーになる
// （`never` に代入不能）。実行時に到達したら IR が壊れているので明示的に落とす（握り潰さない）。
function assertNever(x: never): never {
  throw new Error(`網羅されていない IR ノード: ${JSON.stringify(x)}`);
}

export function toZ3(z: Z3Context, formula: Formula): Bool<'main'> {
  switch (formula.kind) {
    case 'cmp': {
      // 比較の両辺は同じソートで構築する。リテラルはソートを持たない（多相）ため、
      // 変数側から推論したソートに合わせる。一方でも real なら real に揃える（int は ToReal で持ち上がる）。
      // 両辺ともリテラルなら int を既定とする。
      const sort = combineSorts(inferSort(formula.left), inferSort(formula.right)) ?? 'int';
      const left = buildTerm(z, formula.left, sort);
      const right = buildTerm(z, formula.right, sort);
      return compare(formula.op, left, right);
    }
    case 'and':
      return z.And(...formula.items.map((f) => toZ3(z, f)));
    case 'or':
      return z.Or(...formula.items.map((f) => toZ3(z, f)));
    case 'not':
      return z.Not(toZ3(z, formula.formula));
    case 'implies':
      return z.Implies(toZ3(z, formula.ante), toZ3(z, formula.cons));
    default:
      return assertNever(formula);
  }
}

function compare(op: CmpOp, left: Arith<'main'>, right: Arith<'main'>): Bool<'main'> {
  switch (op) {
    case 'lt':
      return left.lt(right);
    case 'le':
      return left.le(right);
    case 'gt':
      return left.gt(right);
    case 'ge':
      return left.ge(right);
    case 'eq':
      return left.eq(right);
    case 'ne':
      return left.neq(right);
    default:
      return assertNever(op);
  }
}

// 項を Z3 の Arith 式へ。expected は周囲の比較から伝播するソート（リテラル生成の指針）。
function buildTerm(z: Z3Context, t: Term, expected: Sort): Arith<'main'> {
  switch (t.kind) {
    case 'var': {
      const c = t.sort === 'real' ? z.Real.const(t.name) : z.Int.const(t.name);
      // int 変数が real 文脈に現れたら ToReal で持ち上げる（Z3 はソート不一致を嫌うため）。
      return t.sort === 'int' && expected === 'real' ? z.ToReal(c) : c;
    }
    case 'lit':
      return expected === 'real' || !Number.isInteger(t.value)
        ? z.Real.val(t.value)
        : z.Int.val(t.value);
    case 'add':
      return buildTerm(z, t.left, expected).add(buildTerm(z, t.right, expected));
    case 'sub':
      return buildTerm(z, t.left, expected).sub(buildTerm(z, t.right, expected));
    case 'neg':
      return buildTerm(z, t.term, expected).neg();
    case 'mul': {
      // 線形限定: 少なくとも一方が定数（変数を含まない）でなければならない。
      if (!isConstant(t.left) && !isConstant(t.right)) throw new NonlinearError();
      return buildTerm(z, t.left, expected).mul(buildTerm(z, t.right, expected));
    }
    default:
      return assertNever(t);
  }
}

// 変数を一切含まない（畳めば定数になる）項か。乗算の線形性判定に使う。
function isConstant(t: Term): boolean {
  switch (t.kind) {
    case 'lit':
      return true;
    case 'var':
      return false;
    case 'neg':
      return isConstant(t.term);
    case 'add':
    case 'sub':
    case 'mul':
      return isConstant(t.left) && isConstant(t.right);
    default:
      return assertNever(t);
  }
}

// 項のソートを推論する。リテラルは多相なので undefined（呼び出し側で既定を補う）。
// 部分項に real が一つでもあれば real に揃える（混在は real へ持ち上げるのが線形算術として安全）。
function inferSort(t: Term): Sort | undefined {
  switch (t.kind) {
    case 'var':
      return t.sort;
    case 'lit':
      return undefined;
    case 'neg':
      return inferSort(t.term);
    case 'add':
    case 'sub':
    case 'mul':
      return combineSorts(inferSort(t.left), inferSort(t.right));
    default:
      return assertNever(t);
  }
}

// 2 項のソートを統合する。一方でも real なら real（int は ToReal で持ち上がる）。
// 双方 int なら int、双方未確定（リテラルのみ）なら undefined を返す。
function combineSorts(a: Sort | undefined, b: Sort | undefined): Sort | undefined {
  if (a === 'real' || b === 'real') return 'real';
  return a ?? b;
}
