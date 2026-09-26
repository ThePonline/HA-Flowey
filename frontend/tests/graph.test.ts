import { describe, expect, it } from "vitest";
import { copyCards, duplicateFlow } from "../src/canvas/graph";
import type { FlowEdge, FlowNode, FlowRecord } from "../src/compiler/types";

const hook: FlowNode = {
  id: "h", type: "trigger", position: { x: 0, y: 0 },
  data: { kind: "webhook", webhook_id: "flowey_secret", methods: ["POST"], local_only: true },
};
const outgoingWebhook: FlowNode = {
  id: "w", type: "action", position: { x: 300, y: 0 },
  data: { kind: "webhook", mode: "homey", webhook_id: "athom-id", homey_id: "h", event: "e" },
};
const wait: FlowNode = {
  id: "t", type: "action", position: { x: 600, y: 0 },
  data: { kind: "wait", trigger: { kind: "webhook", webhook_id: "flowey_inner" } },
};
const edges: FlowEdge[] = [
  { id: "e1", source: "h", target: "w", sourceHandle: "out" },
  { id: "e2", source: "w", target: "t", sourceHandle: "out" },
];

describe("copyCards", () => {
  it("gives new ids, keeps inner connections and offsets positions", () => {
    const copy = copyCards([hook, outgoingWebhook], edges, { x: 40, y: 60 });
    expect(copy.nodes.map(n => n.id)).not.toContain("h");
    expect(copy.nodes[0].position).toEqual({ x: 40, y: 60 });
    // Only the connection between two copied cards is copied.
    expect(copy.edges).toHaveLength(1);
    expect(copy.edges[0].source).toBe(copy.nodes[0].id);
    expect(copy.edges[0].target).toBe(copy.nodes[1].id);
  });

  it("gives copied webhook triggers a new secret id, but keeps outgoing Homey webhooks", () => {
    const copy = copyCards([hook, outgoingWebhook, wait], edges, { x: 0, y: 0 });
    expect((copy.nodes[0].data as any).webhook_id).not.toBe("flowey_secret");
    expect((copy.nodes[0].data as any).webhook_id).toMatch(/^flowey_[0-9a-f]{24}$/);
    expect((copy.nodes[1].data as any).webhook_id).toBe("athom-id");
    expect((copy.nodes[2].data as any).trigger.webhook_id).not.toBe("flowey_inner");
    // The original is untouched.
    expect((hook.data as any).webhook_id).toBe("flowey_secret");
  });
});

describe("duplicateFlow", () => {
  it("creates an unpublished, switched-off copy with a new id", () => {
    const original: FlowRecord = {
      id: "orig", name: "Hal", enabled: true, mode: "single", config_hash: "abc",
      graph: { nodes: [hook, outgoingWebhook], edges: [edges[0]] },
    };
    const copy = duplicateFlow(original, "Hal (kopie)");
    expect(copy.id).not.toBe("orig");
    expect(copy).toMatchObject({ name: "Hal (kopie)", enabled: false, mode: "single", config_hash: null });
    expect(copy.graph.edges).toEqual([edges[0]]);
    expect((copy.graph.nodes[0].data as any).webhook_id).not.toBe("flowey_secret");
  });
});
