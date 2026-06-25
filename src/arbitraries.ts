// 制約付き fast-check arbitrary（fallback 用、設計書 §5・§9-6）。
// Z3 が unknown を返した領域を ∃ で例示するとき、Z3 述語と同じ制約で値を生成するためのヘルパ。
// 命名は Z3 の比較演算に揃える（ge=以上, le=以下, ne=≠）ことで、∀/∃ の制約記述を一貫させる。
import fc from 'fast-check';

export type NumericConstraints = {
  ge?: number; // 下限（この値を含む）
  le?: number; // 上限（この値を含む）
  ne?: number; // この値は生成しない
};

// 制約付き整数。ge/le は fc.integer の min/max（両端含む）に対応する。
export function int(c: NumericConstraints = {}): fc.Arbitrary<number> {
  const base = fc.integer({ min: c.ge, max: c.le });
  return c.ne === undefined ? base : base.filter((n) => n !== c.ne);
}

// 制約付き実数。NaN / Infinity は検証対象外（Z3 の Real と意味が合わない）ため必ず除外する。
export function real(c: NumericConstraints = {}): fc.Arbitrary<number> {
  const base = fc.double({
    min: c.ge,
    max: c.le,
    noNaN: true,
    noDefaultInfinity: true,
  });
  return c.ne === undefined ? base : base.filter((x) => x !== c.ne);
}
