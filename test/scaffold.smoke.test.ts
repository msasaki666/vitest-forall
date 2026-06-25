import { describe, expect, test } from 'vitest';
import { withdraw, classify } from '../examples/wallet';

// scaffold の疎通確認。`vitest run` が緑になることを保証するための最小テスト。
// Phase A 実装着手時に core / verify のメタテスト（設計書 §7）へ置き換える。
describe('scaffold smoke', () => {
  test('vitest ランナーが動作する', () => {
    expect(1 + 1).toBe(2);
  });

  test('examples/wallet が import できる', () => {
    expect(withdraw(100, 30)).toBe(70);
    expect(classify(50)).toBe('mid');
  });
});
