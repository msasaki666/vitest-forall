// 公開エクスポート（設計書 §5）。利用者はこのエントリだけを import すればよい。
export { verify } from './verify';
export {
  evaluate,
  DEFAULT_TIMEOUT_MS,
  type Verdict,
  type VerifySpec,
  type Fallback,
  type ArbitraryTuple,
} from './core';
export { int, real, type NumericConstraints } from './arbitraries';
export { getZ3Context, type Z3Context } from './z3-context';
// Phase B: 述語 DSL（線形算術）。`forall` で性質を書き、Z3 へ機械変換する（設計書 §3-B・§9-8）。
export {
  forall,
  intVar,
  realVar,
  lit,
  add,
  sub,
  mul,
  neg,
  lt,
  le,
  gt,
  ge,
  eq,
  ne,
  and,
  or,
  not,
  implies,
  type Sort,
  type Term,
  type Termish,
  type Formula,
  type CmpOp,
  type VarDecls,
} from './vc/parser';
export { toZ3, NonlinearError } from './vc/to-z3';
