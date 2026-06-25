// verify(): 純粋関数 evaluate() の判定（Verdict）を Vitest の test() に橋渡しする薄い殻（設計書 §4・§6）。
// test() 登録という副作用をここに隔離し、コアの純粋性を守る。判定ロジックは一切持たない。
import { test } from 'vitest';
import { evaluate, type ArbitraryTuple, type VerifySpec } from './core';

export function verify<T extends ArbitraryTuple = ArbitraryTuple>(
  name: string,
  spec: VerifySpec<T>,
): void {
  // ∃（test）と ∀（verify）を同一ランナー・同一レポートに並べるため、test() で登録する（設計書 §0）。
  // 名前に ∀ を冠してレポート上で ∃ と区別できるようにする。
  test(`∀ ${name}`, async () => {
    const v = await evaluate(spec);
    switch (v.status) {
      case 'proved':
      case 'fallback-passed':
        return; // ∀ 成立（証明 or ∃ 例示）→ テスト緑
      case 'refuted':
        throw new Error(`反例が存在: ${v.counterexample}`);
      case 'error':
        throw new Error(v.reason);
    }
  });
}
