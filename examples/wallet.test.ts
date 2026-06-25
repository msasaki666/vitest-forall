import { test, expect } from 'vitest';
import fc from 'fast-check';
import { withdraw, classify } from './wallet';
import { verify, int, forall, and, ge, le, sub, implies } from '../src/index';

// ∃（test）と ∀（verify）が同一ランナー・同一レポートに並ぶことを示すサンプル（設計書 §0・§6）。

test('withdraw: 100 から 30 引くと 70', () => {
  // ∃: この具体例で成り立つことだけを示す
  expect(withdraw(100, 30)).toBe(70);
});

verify('残高は出金後も負にならない', {
  // ∀: 前提（残高・出金額が非負、出金額 ≤ 残高）の下で balance - amount ≥ 0 を Z3 で証明
  negation: (z) => {
    const b = z.Int.const('balance');
    const w = z.Int.const('amount');
    const pre = z.And(b.ge(0), w.ge(0), w.le(b));
    return z.And(pre, z.Not(b.sub(w).ge(0))); // ¬(差が非負) が UNSAT → 常に非負
  },
});

verify('classify: 全 score がいずれかに分類される（網羅性）', {
  // ∀: score < 30 ∨ 30 ≤ score < 70 ∨ score ≥ 70 が全域を覆うことを証明
  negation: (z) => {
    const s = z.Int.const('score');
    return z.Not(z.Or(s.lt(30), z.And(s.ge(30), s.lt(70)), s.ge(70)));
  },
});

verify('classify: 出力は low/mid/high のいずれか（unknown→∃ 降格）', {
  // 実関数本体の出力に関する性質は Z3 で直接表せない（記号実行は非対応）。
  // negation を判定不能にして fast-check の ∃ 例示へ降格させる。
  negation: () => {
    throw new Error('実関数の出力制約は Z3 の対象外');
  },
  fallback: {
    arb: [int()],
    prop: (s) => ['low', 'mid', 'high'].includes(classify(s)),
  },
});

// Phase B: 同じ性質を述語 DSL（forall）で書く。生の z.Int.const(...) を直接組むより宣言的で、
// 「∀ balance,amount. 前提 → 差は非負」がそのまま読める（negation の否定は forall が内部で行う）。
verify(
  '残高は出金後も負にならない（forall DSL 版）',
  forall({ balance: 'int', amount: 'int' }, ({ balance, amount }) =>
    implies(
      and(ge(balance, 0), ge(amount, 0), le(amount, balance)),
      ge(sub(balance, amount), 0),
    ),
  ),
);

// fast-check を直接使う ∃ 検証も同じレポートに並べられる（vitest-forall は ∃ を置き換えない）。
test('withdraw: 任意の整数で balance - amount を返す（∃ プロパティ）', () => {
  fc.assert(fc.property(fc.integer(), fc.integer(), (b, a) => withdraw(b, a) === b - a));
});
