// Z3 の遅延初期化シングルトン（設計書 §5・§8）。
// init() は重く（初回数秒〜十数秒）、z3-solver はスレッド非対応のため、
// Context は単一インスタンスを使い回す。副作用（init）をここに隔離し、コアの純粋性を守る。
import { init, type Context } from 'z3-solver';

export type Z3Context = Context<'main'>;

// 解決済みの値ではなく Promise 自体をキャッシュする。
// こうすることで初期化が完了する前に並行で呼ばれても init() が二重に走らない。
let contextPromise: Promise<Z3Context> | undefined;

export function getZ3Context(): Promise<Z3Context> {
  if (contextPromise === undefined) {
    contextPromise = init().then(({ Context }) => Context('main'));
  }
  return contextPromise;
}
