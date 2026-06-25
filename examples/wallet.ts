// テスト対象サンプル（設計書 §6）。scaffold 段階の最小実装。
// Phase A で wallet.test.ts から verify(∀) / test(∃) を同居させる。
export function withdraw(balance: number, amount: number): number {
  return balance - amount;
}

export function safeDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

export function classify(score: number): 'low' | 'mid' | 'high' {
  if (score < 30) return 'low';
  if (score < 70) return 'mid';
  return 'high';
}
