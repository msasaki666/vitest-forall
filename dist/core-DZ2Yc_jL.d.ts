import fc from 'fast-check';
import { Context, Bool } from 'z3-solver';

type Z3Context = Context<'main'>;
declare function getZ3Context(): Promise<Z3Context>;

type Verdict = {
    status: 'proved';
} | {
    status: 'refuted';
    counterexample: string;
} | {
    status: 'fallback-passed';
} | {
    status: 'error';
    reason: string;
};
type ArbitraryTuple = readonly [fc.Arbitrary<unknown>, ...fc.Arbitrary<unknown>[]];
type ArbitraryValues<T extends ArbitraryTuple> = {
    [K in keyof T]: T[K] extends fc.Arbitrary<infer V> ? V : never;
};
type Fallback<T extends ArbitraryTuple = ArbitraryTuple> = {
    arb: T;
    prop: (...xs: ArbitraryValues<T>) => boolean;
};
type VerifySpec<T extends ArbitraryTuple = ArbitraryTuple> = {
    negation: (z: Z3Context) => Bool<'main'>;
    fallback?: Fallback<T>;
    timeout?: number;
};
declare const DEFAULT_TIMEOUT_MS = 10000;
declare function evaluate<T extends ArbitraryTuple = ArbitraryTuple>(spec: VerifySpec<T>): Promise<Verdict>;

export { type ArbitraryTuple as A, DEFAULT_TIMEOUT_MS as D, type Fallback as F, type VerifySpec as V, type Z3Context as Z, type Verdict as a, evaluate as e, getZ3Context as g };
