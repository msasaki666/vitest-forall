// ★ evaluate(): 純粋判定関数。Vitest 非依存。判定結果を Verdict 値で返す（設計書 §4・§6）。
// scaffold 段階のスタブ。Phase A で実装する。
export type Verdict =
  | { status: 'proved' }
  | { status: 'refuted'; counterexample: string }
  | { status: 'fallback-passed' }
  | { status: 'error'; reason: string };
