import { describe, expect, it } from "vitest";
import type { TraceSummary } from "../src/api/ha";
import { compileFlow, hashConfig } from "../src/compiler/compile";
import type { FlowRecord } from "../src/compiler/types";
import { hasOutdatedMarker, runOutcome } from "../src/flowActions";

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

describe("hasOutdatedMarker", () => {
  const flow = (): FlowRecord => ({
    id: "wake",
    name: "Wake up",
    enabled: true,
    mode: "single",
    config_hash: null,
    graph: {
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "time", at: "07:00" } },
        { id: "a", type: "action", position: { x: 300, y: 0 }, data: { kind: "delay", seconds: 5 } },
      ],
      edges: [{ id: "e", source: "t", target: "a", sourceHandle: "out" }],
    },
  });
  // What a version before the rename published.
  const published = () => {
    const record = flow();
    const legacy = { ...compileFlow(record).config, description: "Beheerd door HA Flow Builder — bewerk deze flow visueel in het Flows-paneel." };
    return { record: { ...record, config_hash: hashConfig(legacy) }, legacy };
  };

  it("republishes flows whose automation only has the old description", () => {
    const { record, legacy } = published();
    expect(hasOutdatedMarker(record, legacy)).toBe(true);
  });

  it("leaves automations that were edited outside the panel alone", () => {
    const { record, legacy } = published();
    expect(hasOutdatedMarker(record, { ...legacy, mode: "restart" })).toBe(false);
  });

  it("leaves canvas changes that were not published alone", () => {
    const { record, legacy } = published();
    const changed = { ...record, name: "Renamed" };
    expect(hasOutdatedMarker(changed, legacy)).toBe(false);
  });

  it("ignores up-to-date flows, drafts and missing automations", () => {
    const record = flow();
    const { config } = compileFlow(record);
    expect(hasOutdatedMarker({ ...record, config_hash: hashConfig(config) }, config)).toBe(false);
    expect(hasOutdatedMarker(record, config)).toBe(false);
    expect(hasOutdatedMarker(published().record, null)).toBe(false);
  });
});
