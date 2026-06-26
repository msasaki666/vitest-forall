import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { evaluate } from '../src/core';

// メタテスト（テストツール自身のテスト、設計書 §7）。
// verify() でなく純粋関数 evaluate() を対象にする。evaluate は判定を Verdict 値で返すため、
// 「失敗すべきケース」も expect(...).toBe('refuted') と肯定的に検査でき、スイートを赤くしない。
describe('evaluate: ∀検証エンジンの判定（全分岐網羅）', () => {
  test('恒真な否定は UNSAT → proved', async () => {
    // ¬P が UNSAT ⇔ P が ∀ で成立。b≠0 ∧ b=0 は常に矛盾するので unsat。
    const v = await evaluate({
      negation: (z) => {
        const b = z.Int.const('b');
        return z.And(b.neq(0), b.eq(0));
      },
    });
    expect(v.status).toBe('proved');
  });

  test('偽な性質は SAT → refuted で具体的な反例 model を返す', async () => {
    // 「出金後 残高は 10 以上」は偽（balance=amount のとき差は 0）。反例 model が出る。
    const v = await evaluate({
      negation: (z) => {
        const b = z.Int.const('balance');
        const w = z.Int.const('amount');
        const pre = z.And(b.ge(0), w.ge(0), w.le(b));
        return z.And(pre, z.Not(b.sub(w).ge(10)));
      },
    });
    expect(v.status).toBe('refuted');
    if (v.status === 'refuted') {
      // model は SMTLIB 形式（例: "(define-fun balance () Int 0) ..."）。型名 Int を含む。
      expect(v.counterexample).toContain('Int');
    }
  });

  test('unknown かつ fallback 成功 → fallback-passed', async () => {
    const v = await evaluate({
      negation: () => {
        throw new Error('Z3 では判定不能を模擬');
      },
      fallback: { arb: [fc.integer()], prop: (_n) => true },
    });
    expect(v.status).toBe('fallback-passed');
  });

  test('unknown かつ fallback 未指定 → error（設定ミスを握り潰さない）', async () => {
    const v = await evaluate({
      negation: () => {
        throw new Error('Z3 では判定不能を模擬');
      },
    });
    expect(v.status).toBe('error');
  });

  test('unknown が例外由来なら error の reason に原因を含める（バグを握り潰さない）', async () => {
    // 式構築の例外（typo・OOM 等）が unknown に畳まれると原因が消えていた。
    // fallback 未指定で error に落ちるとき、捕捉した原因を reason に載せて診断可能にする。
    const v = await evaluate({
      negation: () => {
        throw new Error('独自ビルドエラーXYZ');
      },
    });
    expect(v.status).toBe('error');
    if (v.status === 'error') expect(v.reason).toContain('独自ビルドエラーXYZ');
  });

  test('unknown かつ fallback の prop が偽 → refuted（∃側の反例検出）', async () => {
    const v = await evaluate({
      negation: () => {
        throw new Error('Z3 では判定不能を模擬');
      },
      fallback: { arb: [fc.integer()], prop: (_n) => false },
    });
    expect(v.status).toBe('refuted');
  });
});
