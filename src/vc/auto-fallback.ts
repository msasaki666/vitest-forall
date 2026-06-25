// 自動フォールバック合成（設計書 §9-9）。
//
// forall の性質が線形算術の外（変数同士の積など）に出ると to-z3 が拒否し、evaluate は unknown に畳む。
// その領域を、利用者に fallback を書かせず IR から機械的に組んだ fast-check の ∃ 検証で埋める。
// 二段構え:
//   1. inferConstraints: implies の前件（事前条件）から変数ごとの数値範囲を推論する
//   2. buildAutoFallback: 範囲付き arbitrary（int/real）と、IR を具体値で評価する prop を組む
//
// 安全側の原則: 生成範囲は「広い分には安全、狭いと危険」。前件を緩めて広く生成しても、
// 範囲外の値は implies が空虚に真へ畳むだけで偽の反例は生まれない。逆に狭めると本物の反例を
// 取りこぼす。よって確実に落とせない前件は推論せず全域生成に委ねる（握り潰さず、ただ無制約にする）。
import type { Fallback } from '../core';
import { int, type NumericConstraints, real } from '../arbitraries';
import { evalFormula } from './eval';
import type { CmpOp, Formula, Term, VarDecls } from './parser';

// 変数名 → 推論した数値制約。前件に現れなかった変数は欠落（＝全域生成）。
export type InferredConstraints = Readonly<Record<string, NumericConstraints>>;

// 性質から前件領域の制約を推論する。implies のときだけ前件を事前条件とみなす
// （単独の性質に「前件」は無く、無制約で探索するのが正しい）。
export function inferConstraints(property: Formula): InferredConstraints {
  if (property.kind !== 'implies') return {};
  const acc: Record<string, NumericConstraints> = {};
  for (const atom of flattenAnd(property.ante)) {
    const bound = atomBound(atom);
    if (bound) mergeBound(acc, bound);
  }
  return acc;
}

// IR から Fallback を合成する。変数が無ければ生成すべき arbitrary が無いので undefined。
export function buildAutoFallback(decls: VarDecls, property: Formula): Fallback | undefined {
  const entries = Object.entries(decls);
  if (entries.length === 0) return undefined;

  const constraints = inferConstraints(property);
  const arbitraries = entries.map(([name, sort]) => {
    const c = constraints[name] ?? {};
    return sort === 'real' ? real(c) : int(c);
  });

  // fast-check が生成した値タプルを名前付き環境へ束ね、IR を評価して真偽を返す。
  // 反例（false）が出れば evaluate 側が refuted に畳む。
  const prop = (...values: number[]): boolean => {
    const env: Record<string, number> = {};
    entries.forEach(([name], i) => {
      const value = values[i];
      if (value === undefined) throw new Error(`fallback prop の引数 ${name} が不足している`);
      env[name] = value;
    });
    return evalFormula(property, env);
  };

  // 非空タプルであることは entries.length>0 で保証済み。fast-check の厳密タプル型へは
  // 実行時に決まる可変長 arbitrary を渡すため、core の runFallback と同じく境界でのみ型を緩める。
  return { arb: arbitraries as unknown as Fallback['arb'], prop: prop as Fallback['prop'] };
}

// ── 内部: 前件の畳み込みと境界抽出 ──────────────────────────────────

// 前件が and ならその要素を平坦化する（ネストした and も再帰的に展開）。
// それ以外（単独 cmp など）は 1 要素として扱う。or/not/implies は安全に分解できないので
// そのまま 1 要素で返し、atomBound 側で「境界化できない」と判定させて捨てる。
function flattenAnd(formula: Formula): readonly Formula[] {
  if (formula.kind === 'and') return formula.items.flatMap(flattenAnd);
  return [formula];
}

// 単一変数の数値境界。inferConstraints が変数名で集約する。
type Bound = { readonly name: string } & NumericConstraints;

// cmp 原子から「変数 op 定数」を取り出して境界へ変換する。
// 取り出せない形（変数同士・複合項・論理結合）は undefined を返し、呼び出し側で捨てる。
function atomBound(atom: Formula): Bound | undefined {
  if (atom.kind !== 'cmp') return undefined;

  // 変数と定数の組を、向き（変数が左か右か）を吸収して取り出す。
  const oriented = orient(atom.op, atom.left, atom.right);
  if (!oriented) return undefined;
  const { op, name, value } = oriented;

  // 生成範囲は安全側（広い向き）へ緩める: gt→ge, lt→le。範囲外は implies が空虚真に畳む。
  switch (op) {
    case 'ge':
    case 'gt':
      return { name, ge: value };
    case 'le':
    case 'lt':
      return { name, le: value };
    case 'eq':
      return { name, ge: value, le: value };
    case 'ne':
      return { name, ne: value };
    default:
      return undefined;
  }
}

// 「変数 op 定数」へ正規化する。定数が左にある場合は比較の向きを反転して変数を左へ寄せる。
function orient(
  op: CmpOp,
  left: Term,
  right: Term,
): { op: CmpOp; name: string; value: number } | undefined {
  const leftConst = constValue(left);
  const rightConst = constValue(right);

  if (left.kind === 'var' && rightConst !== undefined) {
    return { op, name: left.name, value: rightConst };
  }
  if (right.kind === 'var' && leftConst !== undefined) {
    return { op: flipOp(op), name: right.name, value: leftConst };
  }
  return undefined;
}

// 左右を入れ替えたときに等価になる比較演算（c op v ⇔ v flip(op) c）。
function flipOp(op: CmpOp): CmpOp {
  switch (op) {
    case 'lt':
      return 'gt';
    case 'le':
      return 'ge';
    case 'gt':
      return 'lt';
    case 'ge':
      return 'le';
    case 'eq':
      return 'eq';
    case 'ne':
      return 'ne';
  }
}

// 変数を含まない（畳めば定数になる）項なら値を、含むなら undefined を返す。
function constValue(term: Term): number | undefined {
  switch (term.kind) {
    case 'lit':
      return term.value;
    case 'var':
      return undefined;
    case 'neg': {
      const v = constValue(term.term);
      return v === undefined ? undefined : -v;
    }
    case 'add':
    case 'sub':
    case 'mul': {
      const l = constValue(term.left);
      const r = constValue(term.right);
      if (l === undefined || r === undefined) return undefined;
      return term.kind === 'add' ? l + r : term.kind === 'sub' ? l - r : l * r;
    }
  }
}

// 同じ変数の複数境界を区間の交わりへ集約する: 下限は max、上限は min。
// ne は単一フィールドしか持てないので、競合（別値）が来たら安全側に倒して落とす（無制約化）。
function mergeBound(acc: Record<string, NumericConstraints>, b: Bound): void {
  const cur = acc[b.name] ?? {};
  const next: NumericConstraints = { ...cur };
  if (b.ge !== undefined) next.ge = cur.ge === undefined ? b.ge : Math.max(cur.ge, b.ge);
  if (b.le !== undefined) next.le = cur.le === undefined ? b.le : Math.min(cur.le, b.le);
  if (b.ne !== undefined) {
    if (cur.ne === undefined) next.ne = b.ne;
    else if (cur.ne !== b.ne) delete next.ne; // 競合する除外値は表現できない → 落とす（安全側）
  }
  acc[b.name] = next;
}
