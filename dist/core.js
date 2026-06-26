import fc from 'fast-check';
import { init } from 'z3-solver';

// src/core.ts
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

export { DEFAULT_TIMEOUT_MS, evaluate };
