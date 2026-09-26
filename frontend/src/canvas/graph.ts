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
