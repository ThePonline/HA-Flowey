/** Canvas helpers: ids, edge styling and the connection rules from compile.ts. */
import type { Connection, Edge, Node } from "@xyflow/react";
import type { FlowEdge, FlowNode, FlowRecord } from "../compiler/types";

export function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll("-", "");
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const random = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return random !== "0".repeat(32) ? random : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export const newNodeId = () => `n${createId().slice(0, 10)}`;

/** Random, hard-to-guess webhook id: it works like a password. */
export const newWebhookId = () => `flowey_${createId().slice(0, 24)}`;

/**
 * Card data for a copy. A webhook address must be unique per automation (and is secret),
 * so copied "webhook received" triggers get a new id, also when nested in a "wait until" card.
 */
export function copyNodeData(type: FlowNode["type"], data: Record<string, any>): Record<string, any> {
  const copy = structuredClone(data);
  if (type === "trigger" && copy.kind === "webhook") copy.webhook_id = newWebhookId();
  if (copy.kind === "wait" && copy.trigger?.kind === "webhook") copy.trigger.webhook_id = newWebhookId();
  return copy;
}

/** Copies cards and the connections between them, with new ids and an offset. */
export function copyCards(nodes: FlowNode[], edges: FlowEdge[], offset: { x: number; y: number }) {
  const ids = new Map(nodes.map(node => [node.id, newNodeId()]));
  return {
    nodes: nodes.map(node => ({
      ...node,
      id: ids.get(node.id)!,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: copyNodeData(node.type, node.data),
    })) as FlowNode[],
    edges: edges
      .filter(edge => ids.has(edge.source) && ids.has(edge.target))
      .map(edge => ({ ...edge, id: `e${createId().slice(0, 10)}`, source: ids.get(edge.source)!, target: ids.get(edge.target)! })),
  };
}

/** A copy of a whole flow: new id, fresh webhook ids, not yet published and switched off. */
export function duplicateFlow(flow: FlowRecord, name: string): FlowRecord {
  return {
    ...newFlow(name),
    enabled: false,
    mode: flow.mode,
    graph: {
      nodes: flow.graph.nodes.map(node => ({ ...node, data: copyNodeData(node.type, node.data) })) as FlowNode[],
      edges: flow.graph.edges.map(edge => ({ ...edge })),
    },
  };
}

export function newFlow(name = "Nieuwe flow"): FlowRecord {
  return {
    id: createId(),
    name,
    enabled: true,
    mode: "restart",
    graph: { nodes: [], edges: [] },
    config_hash: null,
  };
}

export type CanvasNode = Node<Record<string, unknown>, FlowNode["type"]>;

export const toCanvasNodes = (nodes: FlowNode[]): CanvasNode[] =>
  nodes.map(node => ({ id: node.id, type: node.type, position: node.position, data: { ...node.data } }));

export const toCanvasEdges = (edges: FlowEdge[]): Edge[] => edges.map(styleEdge);

export function styleEdge(edge: FlowEdge | Edge): Edge {
  const handle = edge.sourceHandle ?? "out";
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: handle,
    type: "deletable",
    className: `edge-${handle}`,
  };
}

export const fromCanvas = (nodes: CanvasNode[], edges: Edge[]) => ({
  nodes: nodes.map(node => ({
    id: node.id,
    type: node.type,
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    data: node.data,
  })) as FlowNode[],
  edges: edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? "out",
  })),
});

/**
 * Mirrors the compiler rules so invalid graphs cannot be drawn in the first place:
 * no edges into triggers, no cycles, and merges only directly after triggers.
 */
export function canConnect(connection: Connection | Edge, nodes: CanvasNode[], edges: Edge[]): boolean {
  const { source, target } = connection;
  if (!source || !target || source === target) return false;
  const typeOf = (id: string) => nodes.find(node => node.id === id)?.type;
  if (typeOf(target) === "trigger") return false;

  const sourceHandle = connection.sourceHandle ?? "out";
  if (edges.some(edge => edge.source === source && edge.target === target && (edge.sourceHandle ?? "out") === sourceHandle)) {
    return false;
  }

  const incoming = edges.filter(edge => edge.target === target);
  if (incoming.length && (typeOf(source) !== "trigger" || incoming.some(edge => typeOf(edge.source) !== "trigger"))) {
    return false;
  }

  // Reject cycles: target must not already reach source.
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return false;
    if (seen.has(current)) continue;
    seen.add(current);
    edges.filter(edge => edge.source === current).forEach(edge => stack.push(edge.target));
  }
  return true;
}
