// ★ evaluate(): ∀検証の純粋判定関数。Vitest 非依存（設計書 §4・§6）。
//
// 検証の原理: 「性質 P を ∀ で証明したい」⇔「¬P が UNSAT であることを示す」。
// SAT が返ればその model が反例の具体値。判定不能（unknown）は fast-check の ∃ 検証へ降格する。
//
// 想定外（式構築の例外・判定不能）は throw せず Verdict 値に畳み込んで返す（全域関数化、設計書 §4-1）。
// Solver/Model/fc.assert といった命令的・副作用的コードはこの関数のローカルに閉じ込め、
// 外には Verdict だけを出す。ローカルな可変は外から観測できないので純粋とみなす（設計書 割り切り）。
import fc from 'fast-check';
import type { Bool, CheckSatResult, Model } from 'z3-solver';
import { getZ3Context, type Z3Context } from './z3-context';

export type Verdict =
  | { status: 'proved' } // ¬P が UNSAT → ∀ 成立
  | { status: 'refuted'; counterexample: string } // SAT / ∃ 失敗 → 反例あり
  | { status: 'fallback-passed' } // unknown → fast-check で例示 OK
  | { status: 'error'; reason: string }; // unknown かつ fallback 未指定

// fallback の arbitrary は 1 個以上の非空タプル。空配列を fc.property に渡すと
// 実行時エラーになる（設計書 §7 脚注）ため、型でも非空を要求して呼び出し側のミスを防ぐ。
export type ArbitraryTuple = readonly [fc.Arbitrary<unknown>, ...fc.Arbitrary<unknown>[]];

// arbitrary タプルから prop の引数型を導く（[fc.integer()] → [number] など）。
type ArbitraryValues<T extends ArbitraryTuple> = {
  [K in keyof T]: T[K] extends fc.Arbitrary<infer V> ? V : never;
};

export type Fallback<T extends ArbitraryTuple = ArbitraryTuple> = {
  arb: T;
  prop: (...xs: ArbitraryValues<T>) => boolean;
};

export type VerifySpec<T extends ArbitraryTuple = ArbitraryTuple> = {
  negation: (z: Z3Context) => Bool<'main'>; // 性質の否定（UNSAT なら ∀ 成立）
  fallback?: Fallback<T>;
  timeout?: number; // Z3 タイムアウト(ms)。最悪ケースで指数的に遅いため CI 安定化に必須級（設計書 §8）。
};

// timeout 未指定でも Z3 を無制限に走らせない既定値。設計書 §8 が「必須級」と言う以上、
// 既定でガードしてハングを防ぐ（タイムアウト時 Z3 は unknown を返し、fallback/error へ穏当に降格する）。
export const DEFAULT_TIMEOUT_MS = 10_000;

export async function evaluate<T extends ArbitraryTuple = ArbitraryTuple>(
  spec: VerifySpec<T>,
): Promise<Verdict> {
  const z = await getZ3Context();

  // 式構築〜check〜model 取得までを 1 つの try に収める。
  // どこで失敗しても「判定不能（unknown）」へ畳み、握り潰さず後段で扱う。
  // 例外の原因は捨てず保持し、fallback 無しで error に落ちる際に reason へ載せる
  // （NonlinearError と OOM・typo を区別できるよう、診断情報を消さない）。
  let outcome: { result: CheckSatResult; counterexample?: string };
  let cause: unknown;
  try {
    const solver = new z.Solver();
    solver.set('timeout', spec.timeout ?? DEFAULT_TIMEOUT_MS);
    solver.add(spec.negation(z));
    const result = await solver.check();
    outcome = {
      result,
      counterexample: result === 'sat' ? formatModel(solver.model()) : undefined,
    };
  } catch (e) {
    cause = e;
    outcome = { result: 'unknown' };
  }

  if (outcome.result === 'unsat') return { status: 'proved' };
  if (outcome.result === 'sat') {
    return { status: 'refuted', counterexample: outcome.counterexample ?? '' };
  }

  // unknown: fallback があれば ∃ 検証へ降格、なければ設定ミスとして error。
  if (spec.fallback !== undefined) return runFallback(spec.fallback);
  return {
    status: 'error',
    reason:
      cause !== undefined
        ? `Z3 で判定できず fallback も未指定（原因: ${describeCause(cause)}）`
        : 'Z3 が unknown を返したが fallback が未指定（∃ 検証で埋められない）',
  };
}

// 捕捉した例外を reason 用の文字列へ。Error はメッセージを、それ以外は文字列化する。
function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// model は SMTLIB 形式（"(define-fun balance () Int\n  0)..."）。
// 空白を畳んで 1 行に整形し、レポートで読みやすくする。
function formatModel(model: Model<'main'>): string {
  return model.toString().replace(/\s+/g, ' ').trim();
}

function runFallback<T extends ArbitraryTuple>(fallback: Fallback<T>): Verdict {
  try {
    // fast-check の property は arbitrary をタプルで厳密に型付けするが、ここでは
    // 実行時に決まる可変長 arbitrary を扱うため、境界でのみ型を緩める（局所的キャスト）。
    const predicate = fallback.prop as (...xs: unknown[]) => boolean;
    const build = fc.property as (...args: unknown[]) => fc.IPropertyWithHooks<unknown[]>;
    fc.assert(build(...fallback.arb, predicate));
    return { status: 'fallback-passed' };
  } catch (e) {
    return {
      status: 'refuted',
      counterexample: e instanceof Error ? e.message : String(e),
    };
  }
}
