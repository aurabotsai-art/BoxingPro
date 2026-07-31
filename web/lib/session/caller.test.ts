import { describe, expect, it } from "vitest";

import { CALL_PLANS, callWords, nextCall, nextGapMs, rng } from "./caller";

describe("combo caller", () => {
  it("has a plan for every 'App calls' drill in the content library", async () => {
    const { DRILLS } = await import("./drills.gen");
    const callers = DRILLS.filter((d) => /app calls/i.test(d.protocol)).map((d) => d.id);
    expect(callers.length).toBeGreaterThanOrEqual(3);
    for (const id of callers) {
      expect(CALL_PLANS[id], `${id} protocol says "App calls" but has no plan`).toBeDefined();
    }
  });

  it("pools contain only boxing notation or plain word calls", () => {
    for (const [id, plan] of Object.entries(CALL_PLANS)) {
      for (const c of plan.pool) {
        expect(c, `${id}: bad call '${c}'`).toMatch(/^([1-6](-[1-6])*|[a-z]+)$/);
      }
    }
  });

  it("is deterministic for a seed and never repeats back-to-back", () => {
    const plan = CALL_PLANS.prompt_random_combos;
    const a = rng(42);
    const b = rng(42);
    let prevA: string | null = null;
    let prevB: string | null = null;
    for (let i = 0; i < 50; i++) {
      const ca = nextCall(plan, a, prevA);
      const cb = nextCall(plan, b, prevB);
      expect(ca).toBe(cb); // same seed → same sequence
      expect(ca).not.toBe(prevA); // no immediate repeats
      prevA = ca;
      prevB = cb;
    }
  });

  it("jitters gaps within ±30% of the plan tempo", () => {
    const plan = CALL_PLANS.mirror_return_high;
    const r = rng(7);
    for (let i = 0; i < 100; i++) {
      const gap = nextGapMs(plan, r);
      expect(gap).toBeGreaterThanOrEqual(plan.everyMs * 0.7);
      expect(gap).toBeLessThanOrEqual(plan.everyMs * 1.3);
    }
  });

  it("speaks digits as words and passes word calls through", () => {
    expect(callWords("1-1-2")).toBe("one one two");
    expect(callWords("3")).toBe("three");
    expect(callWords("1-2-3-2")).toBe("one two three two");
    expect(callWords("check")).toBe("check");
  });
});
