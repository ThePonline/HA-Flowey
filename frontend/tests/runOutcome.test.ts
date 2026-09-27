import { describe, expect, it } from "vitest";
import type { TraceSummary } from "../src/api/ha";
import { runOutcome } from "../src/flowActions";

const run = (overrides: Partial<TraceSummary>): TraceSummary => ({
  item_id: "flowey_x",
  run_id: "1",
  state: "stopped",
  script_execution: "finished",
  timestamp: { start: "2026-09-27T07:00:00Z", finish: "2026-09-27T07:00:01Z" },
  ...overrides,
});

describe("runOutcome", () => {
  it("reports a finished run as succeeded", () => {
    expect(runOutcome(run({}))).toEqual({ icon: "✓", text: "gelukt", failed: false });
  });

  it("treats an AND card that did not hold as a normal outcome, not an error", () => {
    expect(runOutcome(run({ script_execution: "aborted" }))).toEqual({
      icon: "–",
      text: "voorwaarden niet voldaan",
      failed: false,
    });
  });

  it("marks a real abort (stop with error) and errors as failed", () => {
    expect(runOutcome(run({ script_execution: "aborted", error: "Stopped" })).failed).toBe(true);
    expect(runOutcome(run({ script_execution: "error", error: "boom" })).failed).toBe(true);
  });

  it("shows running runs", () => {
    expect(runOutcome(run({ state: "running", script_execution: null })).text).toBe("loopt nu");
  });
});
