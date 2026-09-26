/** A Homey-style card on the canvas: coloured header, summary and connection handles. */
import { useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  useReactFlow,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import type { DeviceCard, FlowNode } from "../compiler/types";
import { IssuesContext, useHass } from "../context";
import { useT } from "../i18n";
import { catalogItem, describeNode } from "../nodes/catalog";
import { useCardLabel } from "../nodes/useCardLabel";
import type { CanvasNode } from "./graph";

export const TYPE_LABEL = { trigger: "ALS", condition: "EN", action: "DAN" } as const;

export function FlowCard({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const hass = useHass();
  const t = useT();
  const issues = useContext(IssuesContext).get(id) ?? [];
  const nodeType = type as FlowNode["type"];
  const item = catalogItem(nodeType, String(data.kind));
  const node = { id, type: nodeType, position: { x: 0, y: 0 }, data } as FlowNode;
  const label = useCardLabel(nodeType, data.kind === "device" ? (data.card as DeviceCard | undefined) : undefined);
  // Header: what the card is about ("ALS Haldeur"); body: what happens ("sensor geopend").
  const { subject, text } = describeNode(hass, node, t, label);
  const heading = subject ?? t(item?.title ?? "");

  return (
    <div className={`card type-${nodeType} ${selected ? "selected" : ""} ${issues.length ? "has-issue" : ""}`}>
      {nodeType !== "trigger" && <Handle type="target" position={Position.Left} className="handle-in" />}
      <div className="card-head">
        <span className="card-icon">{item?.icon}</span>
        <span className="card-type">{t(TYPE_LABEL[nodeType])}</span>
        <span className="card-kind" title={heading}>{heading}</span>
        {issues.length > 0 && <span className="card-warning" title={issues.map(i => t(i.message)).join("\n")}>⚠</span>}
      </div>
      <div className="card-body">{text}</div>
      {nodeType === "condition" ? (
        <>
          <Handle id="yes" type="source" position={Position.Right} className="handle-yes" style={{ top: "38%" }}>
            <span className="handle-label">{t("ja")}</span>
          </Handle>
          <Handle id="no" type="source" position={Position.Right} className="handle-no" style={{ top: "78%" }}>
            <span className="handle-label">{t("nee")}</span>
          </Handle>
        </>
      ) : (
        <Handle id="out" type="source" position={Position.Right} className="handle-out" />
      )}
    </div>
  );
}

export function DeletableEdge(props: EdgeProps) {
  const t = useT();
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <>
      <BaseEdge path={path} markerEnd={props.markerEnd} style={props.style} />
      {props.selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="edge-delete nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={t("Verbinding verwijderen")}
            onClick={() => deleteElements({ edges: [{ id: props.id }] })}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
