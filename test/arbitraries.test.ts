import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { int, real } from '../src/arbitraries';

// 制約付き arbitrary（fallback 用、設計書 §5・§9-6）の単体テスト。
// 「生成される全サンプルが制約を満たす」ことを ∃ 検証（fast-check 自身）で確認する。
// 命名は Z3 に揃える（ge=以上, le=以下, ne=≠）。
describe('int(): 制約付き整数 arbitrary', () => {
  test('ge/le の範囲（両端含む）に収まる', () => {
    fc.assert(fc.property(int({ ge: 0, le: 10 }), (n) => n >= 0 && n <= 10));
  });

  test('ne で指定した値は生成されない', () => {
    fc.assert(fc.property(int({ ne: 5, ge: 0, le: 10 }), (n) => n !== 5));
  });

  test('制約なしでも整数を生成する', () => {
    fc.assert(fc.property(int(), (n) => Number.isInteger(n)));
  });
});

describe('real(): 制約付き実数 arbitrary', () => {
  test('ge/le の範囲に収まり NaN/Infinity を生成しない', () => {
    fc.assert(
      fc.property(real({ ge: -1, le: 1 }), (x) => x >= -1 && x <= 1 && Number.isFinite(x)),
    );
  });

  test('制約なしでも有限の数を生成する', () => {
    fc.assert(fc.property(real(), (x) => Number.isFinite(x)));
  });
});

// 型レベルの確認: int()/real() は fc.Arbitrary<number> として fallback.arb にそのまま渡せる。
test('arbitrary は number を生む', () => {
  const samples = fc.sample(int({ ge: 1, le: 3 }), 5);
  expect(samples.every((n) => n >= 1 && n <= 3)).toBe(true);
});
