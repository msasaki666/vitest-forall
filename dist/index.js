import { test } from 'vitest';
import fc from 'fast-check';
import { init } from 'z3-solver';

// src/verify.ts
var contextPromise;
function getZ3Context() {
  if (contextPromise === void 0) {
    contextPromise = init().then(({ Context }) => Context("main"));
  }
  return contextPromise;
}

// src/core.ts
var DEFAULT_TIMEOUT_MS = 1e4;
async function evaluate(spec) {
  const z = await getZ3Context();
  let outcome;
  let cause;
  try {
    const solver = new z.Solver();
    solver.set("timeout", spec.timeout ?? DEFAULT_TIMEOUT_MS);
    solver.add(spec.negation(z));
    const result = await solver.check();
    outcome = {
      result,
      counterexample: result === "sat" ? formatModel(solver.model()) : void 0
    };
  } catch (e) {
    cause = e;
    outcome = { result: "unknown" };
  }
  if (outcome.result === "unsat") return { status: "proved" };
  if (outcome.result === "sat") {
    return { status: "refuted", counterexample: outcome.counterexample ?? "" };
  }
  if (spec.fallback !== void 0) return runFallback(spec.fallback);
  return {
    status: "error",
    reason: cause !== void 0 ? `Z3 \u3067\u5224\u5B9A\u3067\u304D\u305A fallback \u3082\u672A\u6307\u5B9A\uFF08\u539F\u56E0: ${describeCause(cause)}\uFF09` : "Z3 \u304C unknown \u3092\u8FD4\u3057\u305F\u304C fallback \u304C\u672A\u6307\u5B9A\uFF08\u2203 \u691C\u8A3C\u3067\u57CB\u3081\u3089\u308C\u306A\u3044\uFF09"
  };
}
function describeCause(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
function formatModel(model) {
  return model.toString().replace(/\s+/g, " ").trim();
}
function runFallback(fallback) {
  try {
    const predicate = fallback.prop;
    const build = fc.property;
    fc.assert(build(...fallback.arb, predicate));
    return { status: "fallback-passed" };
  } catch (e) {
    return {
      status: "refuted",
      counterexample: e instanceof Error ? e.message : String(e)
    };
  }
}

// src/verify.ts
function verify(name, spec) {
  test(`\u2200 ${name}`, async () => {
    const v = await evaluate(spec);
    switch (v.status) {
      case "proved":
      case "fallback-passed":
        return;
      // ∀ 成立（証明 or ∃ 例示）→ テスト緑
      case "refuted":
        throw new Error(`\u53CD\u4F8B\u304C\u5B58\u5728: ${v.counterexample}`);
      case "error":
        throw new Error(v.reason);
    }
  });
}
function int(c = {}) {
  const base = fc.integer({ min: c.ge, max: c.le });
  return c.ne === void 0 ? base : base.filter((n) => n !== c.ne);
}
function real(c = {}) {
  const base = fc.double({
    min: c.ge,
    max: c.le,
    noNaN: true,
    noDefaultInfinity: true
  });
  return c.ne === void 0 ? base : base.filter((x) => x !== c.ne);
}

// src/vc/eval.ts
function assertNever(x) {
  throw new Error(`\u7DB2\u7F85\u3055\u308C\u3066\u3044\u306A\u3044 IR \u30CE\u30FC\u30C9: ${JSON.stringify(x)}`);
}
function lookupVar(env, name) {
  if (!Object.prototype.hasOwnProperty.call(env, name)) {
    throw new Error(`\u74B0\u5883\u306B\u5909\u6570 ${name} \u304C\u306A\u3044`);
  }
  const value = env[name];
  if (value === void 0) throw new Error(`\u74B0\u5883\u306B\u5909\u6570 ${name} \u304C\u306A\u3044`);
  return value;
}
function evalTerm(term2, env) {
  switch (term2.kind) {
    case "var":
      return lookupVar(env, term2.name);
    case "lit":
      return term2.value;
    case "add":
      return evalTerm(term2.left, env) + evalTerm(term2.right, env);
    case "sub":
      return evalTerm(term2.left, env) - evalTerm(term2.right, env);
    case "mul":
      return evalTerm(term2.left, env) * evalTerm(term2.right, env);
    case "neg":
      return -evalTerm(term2.term, env);
    default:
      return assertNever(term2);
  }
}
function evalFormula(formula, env) {
  switch (formula.kind) {
    case "cmp":
      return compare(formula.op, evalTerm(formula.left, env), evalTerm(formula.right, env));
    case "and":
      return formula.items.every((f) => evalFormula(f, env));
    case "or":
      return formula.items.some((f) => evalFormula(f, env));
    case "not":
      return !evalFormula(formula.formula, env);
    case "implies":
      return !evalFormula(formula.ante, env) || evalFormula(formula.cons, env);
    default:
      return assertNever(formula);
  }
}
function compare(op, left, right) {
  switch (op) {
    case "lt":
      return left < right;
    case "le":
      return left <= right;
    case "gt":
      return left > right;
    case "ge":
      return left >= right;
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    default:
      return assertNever(op);
  }
}
function isIntegerFormula(formula) {
  switch (formula.kind) {
    case "cmp":
      return isIntegerTerm(formula.left) && isIntegerTerm(formula.right);
    case "and":
    case "or":
      return formula.items.every(isIntegerFormula);
    case "not":
      return isIntegerFormula(formula.formula);
    case "implies":
      return isIntegerFormula(formula.ante) && isIntegerFormula(formula.cons);
    default:
      return assertNever(formula);
  }
}
function isIntegerTerm(term2) {
  switch (term2.kind) {
    case "var":
      return term2.sort === "int";
    case "lit":
      return Number.isInteger(term2.value);
    case "neg":
      return isIntegerTerm(term2.term);
    case "add":
    case "sub":
    case "mul":
      return isIntegerTerm(term2.left) && isIntegerTerm(term2.right);
    default:
      return assertNever(term2);
  }
}
function evalFormulaInt(formula, env) {
  switch (formula.kind) {
    case "cmp":
      return compareInt(formula.op, evalTermInt(formula.left, env), evalTermInt(formula.right, env));
    case "and":
      return formula.items.every((f) => evalFormulaInt(f, env));
    case "or":
      return formula.items.some((f) => evalFormulaInt(f, env));
    case "not":
      return !evalFormulaInt(formula.formula, env);
    case "implies":
      return !evalFormulaInt(formula.ante, env) || evalFormulaInt(formula.cons, env);
    default:
      return assertNever(formula);
  }
}
function evalTermInt(term2, env) {
  switch (term2.kind) {
    case "var":
      return BigInt(lookupVar(env, term2.name));
    case "lit":
      return BigInt(term2.value);
    case "add":
      return evalTermInt(term2.left, env) + evalTermInt(term2.right, env);
    case "sub":
      return evalTermInt(term2.left, env) - evalTermInt(term2.right, env);
    case "mul":
      return evalTermInt(term2.left, env) * evalTermInt(term2.right, env);
    case "neg":
      return -evalTermInt(term2.term, env);
    default:
      return assertNever(term2);
  }
}
function compareInt(op, left, right) {
  switch (op) {
    case "lt":
      return left < right;
    case "le":
      return left <= right;
    case "gt":
      return left > right;
    case "ge":
      return left >= right;
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    default:
      return assertNever(op);
  }
}

// src/vc/auto-fallback.ts
function assertNever2(x) {
  throw new Error(`\u7DB2\u7F85\u3055\u308C\u3066\u3044\u306A\u3044 IR \u30CE\u30FC\u30C9: ${JSON.stringify(x)}`);
}
function inferConstraints(property) {
  const acc = /* @__PURE__ */ Object.create(null);
  if (property.kind !== "implies") return acc;
  for (const atom of flattenAnd(property.ante)) {
    const bound = atomBound(atom);
    if (bound) acc[bound.name] = mergeOne(acc[bound.name] ?? {}, bound);
  }
  for (const name of Object.keys(acc)) {
    const c = acc[name];
    if (c && isUnsatisfiable(c)) delete acc[name];
  }
  return acc;
}
function buildAutoFallback(decls, property) {
  const entries = Object.entries(decls);
  if (entries.length === 0) return void 0;
  const constraints = inferConstraints(property);
  const arbitraries = entries.map(([name, sort]) => {
    const c = constraints[name] ?? {};
    return sort === "real" ? real(c) : int(toIntegerDomain(c));
  });
  const evaluator = isIntegerFormula(property) ? evalFormulaInt : evalFormula;
  const prop = (...values) => {
    const env = /* @__PURE__ */ Object.create(null);
    entries.forEach(([name], i) => {
      const value = values[i];
      if (value === void 0) throw new Error(`fallback prop \u306E\u5F15\u6570 ${name} \u304C\u4E0D\u8DB3\u3057\u3066\u3044\u308B`);
      env[name] = value;
    });
    return evaluator(property, env);
  };
  return { arb: arbitraries, prop };
}
function flattenAnd(formula) {
  if (formula.kind === "and") return formula.items.flatMap(flattenAnd);
  return [formula];
}
function atomBound(atom) {
  if (atom.kind !== "cmp") return void 0;
  const oriented = orient(atom.op, atom.left, atom.right);
  if (!oriented) return void 0;
  const { op, name, value } = oriented;
  switch (op) {
    case "ge":
    case "gt":
      return { name, ge: value };
    case "le":
    case "lt":
      return { name, le: value };
    case "eq":
      return { name, ge: value, le: value };
    case "ne":
      return { name, ne: value };
    default:
      return assertNever2(op);
  }
}
function orient(op, left, right) {
  const leftConst = constValue(left);
  const rightConst = constValue(right);
  if (left.kind === "var" && rightConst !== void 0) {
    return { op, name: left.name, value: rightConst };
  }
  if (right.kind === "var" && leftConst !== void 0) {
    return { op: flipOp(op), name: right.name, value: leftConst };
  }
  return void 0;
}
function flipOp(op) {
  switch (op) {
    case "lt":
      return "gt";
    case "le":
      return "ge";
    case "gt":
      return "lt";
    case "ge":
      return "le";
    case "eq":
      return "eq";
    case "ne":
      return "ne";
    default:
      return assertNever2(op);
  }
}
function constValue(term2) {
  switch (term2.kind) {
    case "lit":
      return term2.value;
    case "var":
      return void 0;
    case "neg": {
      const v = constValue(term2.term);
      return v === void 0 ? void 0 : -v;
    }
    case "add":
    case "sub":
    case "mul": {
      const l = constValue(term2.left);
      const r = constValue(term2.right);
      if (l === void 0 || r === void 0) return void 0;
      return term2.kind === "add" ? l + r : term2.kind === "sub" ? l - r : l * r;
    }
    default:
      return assertNever2(term2);
  }
}
function mergeOne(cur, b) {
  const ge2 = b.ge === void 0 ? cur.ge : cur.ge === void 0 ? b.ge : Math.max(cur.ge, b.ge);
  const le2 = b.le === void 0 ? cur.le : cur.le === void 0 ? b.le : Math.min(cur.le, b.le);
  const ne2 = b.ne === void 0 ? cur.ne : cur.ne === void 0 ? b.ne : cur.ne === b.ne ? cur.ne : void 0;
  return {
    ...ge2 !== void 0 ? { ge: ge2 } : {},
    ...le2 !== void 0 ? { le: le2 } : {},
    ...ne2 !== void 0 ? { ne: ne2 } : {}
  };
}
function isUnsatisfiable(c) {
  if (c.ge !== void 0 && c.le !== void 0) {
    if (c.ge > c.le) return true;
    if (c.ge === c.le && c.ne === c.ge) return true;
  }
  return false;
}
function toIntegerDomain(c) {
  const ge2 = c.ge === void 0 ? void 0 : Math.ceil(c.ge);
  const le2 = c.le === void 0 ? void 0 : Math.floor(c.le);
  const ne2 = c.ne !== void 0 && Number.isInteger(c.ne) ? c.ne : void 0;
  if (ge2 !== void 0 && le2 !== void 0) {
    if (ge2 > le2) return {};
    if (ge2 === le2 && ne2 === ge2) return {};
  }
  return {
    ...ge2 !== void 0 ? { ge: ge2 } : {},
    ...le2 !== void 0 ? { le: le2 } : {},
    ...ne2 !== void 0 ? { ne: ne2 } : {}
  };
}

// src/vc/to-z3.ts
var NonlinearError = class extends Error {
  constructor(message = "\u975E\u7DDA\u5F62\uFF08\u5909\u6570\u540C\u58EB\u306E\u7A4D\uFF09\u306F\u7DDA\u5F62\u7B97\u8853\u30BD\u30EB\u30D0\u306E\u5BFE\u8C61\u5916") {
    super(message);
    this.name = "NonlinearError";
  }
};
function assertNever3(x) {
  throw new Error(`\u7DB2\u7F85\u3055\u308C\u3066\u3044\u306A\u3044 IR \u30CE\u30FC\u30C9: ${JSON.stringify(x)}`);
}
function toZ3(z, formula) {
  switch (formula.kind) {
    case "cmp": {
      const sort = combineSorts(inferSort(formula.left), inferSort(formula.right)) ?? "int";
      const left = buildTerm(z, formula.left, sort);
      const right = buildTerm(z, formula.right, sort);
      return compare2(formula.op, left, right);
    }
    case "and":
      return z.And(...formula.items.map((f) => toZ3(z, f)));
    case "or":
      return z.Or(...formula.items.map((f) => toZ3(z, f)));
    case "not":
      return z.Not(toZ3(z, formula.formula));
    case "implies":
      return z.Implies(toZ3(z, formula.ante), toZ3(z, formula.cons));
    default:
      return assertNever3(formula);
  }
}
function compare2(op, left, right) {
  switch (op) {
    case "lt":
      return left.lt(right);
    case "le":
      return left.le(right);
    case "gt":
      return left.gt(right);
    case "ge":
      return left.ge(right);
    case "eq":
      return left.eq(right);
    case "ne":
      return left.neq(right);
    default:
      return assertNever3(op);
  }
}
function buildTerm(z, t, expected) {
  switch (t.kind) {
    case "var": {
      const c = t.sort === "real" ? z.Real.const(t.name) : z.Int.const(t.name);
      return t.sort === "int" && expected === "real" ? z.ToReal(c) : c;
    }
    case "lit":
      return expected === "real" || !Number.isInteger(t.value) ? z.Real.val(t.value) : z.Int.val(t.value);
    case "add":
      return buildTerm(z, t.left, expected).add(buildTerm(z, t.right, expected));
    case "sub":
      return buildTerm(z, t.left, expected).sub(buildTerm(z, t.right, expected));
    case "neg":
      return buildTerm(z, t.term, expected).neg();
    case "mul": {
      if (!isConstant(t.left) && !isConstant(t.right)) throw new NonlinearError();
      return buildTerm(z, t.left, expected).mul(buildTerm(z, t.right, expected));
    }
    default:
      return assertNever3(t);
  }
}
function isConstant(t) {
  switch (t.kind) {
    case "lit":
      return true;
    case "var":
      return false;
    case "neg":
      return isConstant(t.term);
    case "add":
    case "sub":
    case "mul":
      return isConstant(t.left) && isConstant(t.right);
    default:
      return assertNever3(t);
  }
}
function inferSort(t) {
  switch (t.kind) {
    case "var":
      return t.sort;
    case "lit":
      return void 0;
    case "neg":
      return inferSort(t.term);
    case "add":
    case "sub":
    case "mul":
      return combineSorts(inferSort(t.left), inferSort(t.right));
    default:
      return assertNever3(t);
  }
}
function combineSorts(a, b) {
  if (a === "real" || b === "real") return "real";
  return a ?? b;
}

// src/vc/parser.ts
var intVar = (name) => ({ kind: "var", name, sort: "int" });
var realVar = (name) => ({ kind: "var", name, sort: "real" });
var lit = (value) => {
  if (!Number.isFinite(value)) throw new Error(`\u30EA\u30C6\u30E9\u30EB\u306F\u6709\u9650\u306E\u6570\u3067\u306A\u3051\u308C\u3070\u306A\u3089\u306A\u3044: ${value}`);
  return { kind: "lit", value };
};
var term = (t) => typeof t === "number" ? lit(t) : t;
var add = (left, right) => ({
  kind: "add",
  left: term(left),
  right: term(right)
});
var sub = (left, right) => ({
  kind: "sub",
  left: term(left),
  right: term(right)
});
var mul = (left, right) => ({
  kind: "mul",
  left: term(left),
  right: term(right)
});
var neg = (t) => ({ kind: "neg", term: term(t) });
var cmp = (op) => (left, right) => ({ kind: "cmp", op, left: term(left), right: term(right) });
var lt = cmp("lt");
var le = cmp("le");
var gt = cmp("gt");
var ge = cmp("ge");
var eq = cmp("eq");
var ne = cmp("ne");
var and = (...items) => ({ kind: "and", items });
var or = (...items) => ({ kind: "or", items });
var not = (formula) => ({ kind: "not", formula });
var implies = (ante, cons) => ({ kind: "implies", ante, cons });
function forall(decls, predicate, options) {
  const vars = Object.fromEntries(
    Object.entries(decls).map(([name, sort]) => [name, { kind: "var", name, sort }])
  );
  const property = predicate(vars);
  const fallback = options?.fallback ?? buildAutoFallback(decls, property);
  return {
    negation: (z) => toZ3(z, not(property)),
    ...options,
    fallback
  };
}

export { DEFAULT_TIMEOUT_MS, NonlinearError, add, and, eq, evaluate, forall, ge, getZ3Context, gt, implies, int, intVar, le, lit, lt, mul, ne, neg, not, or, real, realVar, sub, toZ3, verify };
