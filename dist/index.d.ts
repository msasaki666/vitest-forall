import { A as ArbitraryTuple, V as VerifySpec, Z as Z3Context } from './core-DZ2Yc_jL.js';
export { D as DEFAULT_TIMEOUT_MS, F as Fallback, a as Verdict, e as evaluate, g as getZ3Context } from './core-DZ2Yc_jL.js';
import fc from 'fast-check';
import { Bool } from 'z3-solver';

declare function verify<T extends ArbitraryTuple = ArbitraryTuple>(name: string, spec: VerifySpec<T>): void;

type NumericConstraints = {
    ge?: number;
    le?: number;
    ne?: number;
};
declare function int(c?: NumericConstraints): fc.Arbitrary<number>;
declare function real(c?: NumericConstraints): fc.Arbitrary<number>;

type Sort = 'int' | 'real';
type Term = {
    readonly kind: 'var';
    readonly name: string;
    readonly sort: Sort;
} | {
    readonly kind: 'lit';
    readonly value: number;
} | {
    readonly kind: 'add';
    readonly left: Term;
    readonly right: Term;
} | {
    readonly kind: 'sub';
    readonly left: Term;
    readonly right: Term;
} | {
    readonly kind: 'mul';
    readonly left: Term;
    readonly right: Term;
} | {
    readonly kind: 'neg';
    readonly term: Term;
};
type CmpOp = 'lt' | 'le' | 'gt' | 'ge' | 'eq' | 'ne';
type Formula = {
    readonly kind: 'cmp';
    readonly op: CmpOp;
    readonly left: Term;
    readonly right: Term;
} | {
    readonly kind: 'and';
    readonly items: readonly Formula[];
} | {
    readonly kind: 'or';
    readonly items: readonly Formula[];
} | {
    readonly kind: 'not';
    readonly formula: Formula;
} | {
    readonly kind: 'implies';
    readonly ante: Formula;
    readonly cons: Formula;
};
type Termish = Term | number;
declare const intVar: (name: string) => Term;
declare const realVar: (name: string) => Term;
declare const lit: (value: number) => Term;
declare const add: (left: Termish, right: Termish) => Term;
declare const sub: (left: Termish, right: Termish) => Term;
declare const mul: (left: Termish, right: Termish) => Term;
declare const neg: (t: Termish) => Term;
declare const lt: (left: Termish, right: Termish) => Formula;
declare const le: (left: Termish, right: Termish) => Formula;
declare const gt: (left: Termish, right: Termish) => Formula;
declare const ge: (left: Termish, right: Termish) => Formula;
declare const eq: (left: Termish, right: Termish) => Formula;
declare const ne: (left: Termish, right: Termish) => Formula;
declare const and: (...items: Formula[]) => Formula;
declare const or: (...items: Formula[]) => Formula;
declare const not: (formula: Formula) => Formula;
declare const implies: (ante: Formula, cons: Formula) => Formula;
type VarDecls = Record<string, Sort>;
type VarHandles<D extends VarDecls> = {
    readonly [K in keyof D]: Term;
};
declare function forall<D extends VarDecls>(decls: D, predicate: (vars: VarHandles<D>) => Formula, options?: Pick<VerifySpec, 'fallback' | 'timeout'>): VerifySpec;

declare class NonlinearError extends Error {
    constructor(message?: string);
}
declare function toZ3(z: Z3Context, formula: Formula): Bool<'main'>;

export { ArbitraryTuple, type CmpOp, type Formula, NonlinearError, type NumericConstraints, type Sort, type Term, type Termish, type VarDecls, VerifySpec, Z3Context, add, and, eq, forall, ge, gt, implies, int, intVar, le, lit, lt, mul, ne, neg, not, or, real, realVar, sub, toZ3, verify };
