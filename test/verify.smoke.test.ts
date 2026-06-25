import { verify } from '../src/verify';

// 殻のスモーク（設計書 §7）。verify() は数行なので最小 1 本でよい。
// proved になる spec を渡すと、登録される「∀ ...」テストが緑になることだけを確認する。
// proved/refuted/fallback-passed/error の判定そのものは core.test.ts で網羅済み。
verify('スモーク: 恒真な性質は proved として緑になる', {
  negation: (z) => {
    const b = z.Int.const('b');
    return z.And(b.neq(0), b.eq(0)); // b≠0 ∧ b=0 は常に矛盾 → UNSAT → proved
  },
});
