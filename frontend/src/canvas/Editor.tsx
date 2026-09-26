/** The Advanced Flow canvas: palette, cards, inspector, autosave and test controls. */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { stringify } from "yaml";
import { errorMessage, findAutomationEntity, navigate, triggerAutomation } from "../api/ha";
import { automationId, compileFlow, hashConfig, stableStringify } from "../compiler/compile";
import type { CompileIssue, FlowEdge, FlowMode, FlowNode, FlowRecord } from "../compiler/types";
import { IssuesContext, toast, useHass } from "../context";
import { applyEnabled, ExternalChange, publishFlow, saveDraft } from "../flowActions";
import { useT } from "../i18n";
import { Inspector } from "../inspector/Inspector";
import { CATALOG, catalogDefaults, catalogItem, describeNodeLine, type CatalogItem } from "../nodes/catalog";
import { DeletableEdge, FlowCard } from "./FlowCard";
import {
  canConnect,
  copyCards,
  fromCanvas,
  newNodeId,
  styleEdge,
  toCanvasEdges,
  toCanvasNodes,
  createId,
  type CanvasNode,
} from "./graph";
import { DRAG_MIME, Palette } from "./Palette";

const nodeTypes = { trigger: FlowCard, condition: FlowCard, action: FlowCard };
const edgeTypes = { deletable: DeletableEdge };

const MODES: { value: FlowMode; label: string }[] = [
  { value: "restart", label: "Opnieuw starten als hij al loopt" },
  { value: "single", label: "Negeren als hij al loopt" },
  { value: "queued", label: "In de wachtrij zetten" },
  { value: "parallel", label: "Tegelijk uitvoeren" },
];

/** Copied cards; module level so cards can be pasted into another flow too. */
let clipboard: { nodes: FlowNode[]; edges: FlowEdge[] } | null = null;

/** Wait this long after the last change before saving, so typing does not save on every key. */
const AUTOSAVE_DELAY_MS = 1000;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "draft"; reason: string }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

interface Props {
  flow: FlowRecord;
  narrow: boolean;
  onBack: () => void;
  onSaved: (flow: FlowRecord) => void;
}

export function Editor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ flow: initial, narrow, onBack, onSaved }: Props) {
  const hass = useHass();
  const t = useT();
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const root = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow();

  const [saved, setSaved] = useState(initial);
  const [meta, setMeta] = useState({ name: initial.name, enabled: initial.enabled, mode: initial.mode });
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(toCanvasNodes(initial.graph.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toCanvasEdges(initial.graph.edges));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showYaml, setShowYaml] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(!narrow);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [testMenu, setTestMenu] = useState(false);

  const graph = useMemo(() => fromCanvas(nodes, edges), [nodes, edges]);
  const current: FlowRecord = useMemo(() => ({ ...saved, ...meta, graph }), [saved, meta, graph]);
  const result = useMemo(() => compileFlow(current), [current]);
  const dirty = stableStringify({ ...meta, graph }) !==
    stableStringify({ name: saved.name, enabled: saved.enabled, mode: saved.mode, graph: saved.graph });

  const issuesByNode = useMemo(() => {
    const map = new Map<string, CompileIssue[]>();
    for (const issue of [...result.errors, ...result.warnings]) {
      if (issue.nodeId) map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue]);
    }
    return map;
  }, [result]);
  const flowIssues = result.errors.filter(issue => !issue.nodeId);

  const selectedNode = graph.nodes.find(node => node.id === selectedId);
  const entity = findAutomationEntity(hass, automationId(saved.id));

  // -------------------------------------------------------------------------
  // Graph editing
  // -------------------------------------------------------------------------

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => canConnect(connection, nodes, edges),
    [nodes, edges],
  );

  const onConnect = useCallback((connection: Connection) => {
    setEdges(current => canConnect(connection, nodes, current)
      ? [...current, styleEdge({ ...connection, id: `e${createId().slice(0, 10)}` })]
      : current);
  }, [nodes, setEdges]);

  const addNode = useCallback((item: CatalogItem, dropPosition?: { x: number; y: number }) => {
    const id = newNodeId();
    const anchor = !dropPosition ? nodes.find(node => node.id === selectedId) : undefined;
    let position = dropPosition;
    let connection: Connection | undefined;

    if (anchor && item.type !== "trigger") {
      const handle = anchor.type === "condition" ? "yes"
        : anchor.data.kind === "wait" ? "done"
        : anchor.data.kind === "repeat" ? "loop"
        : "out";
      const siblings = edges.filter(edge => edge.source === anchor.id && edge.sourceHandle === handle).length;
      position = { x: anchor.position.x + 320, y: anchor.position.y + siblings * 130 };
      connection = { source: anchor.id, sourceHandle: handle, target: id, targetHandle: null };
    }
    if (!position) {
      const bounds = root.current?.querySelector(".react-flow")?.getBoundingClientRect();
      const center = bounds
        ? screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
        : { x: 0, y: 0 };
      position = { x: center.x - 120 + (nodes.length % 5) * 20, y: center.y - 40 + (nodes.length % 5) * 20 };
    }

    const node: CanvasNode = { id, type: item.type, position, data: { kind: item.kind, ...catalogDefaults(item) }, selected: true };
    setNodes(current => [...current.map(n => ({ ...n, selected: false })), node]);
    if (connection) {
      const edge = connection;
      setEdges(current => canConnect(edge, [...nodes, node], current)
        ? [...current, styleEdge({ ...edge, id: `e${createId().slice(0, 10)}` })]
        : current);
    }
    setSelectedId(id);
    if (narrow) setPaletteOpen(false);
    // Cards added by tapping can land outside the visible area; bring them into view.
    if (!dropPosition) {
      const target = position;
      requestAnimationFrame(() => {
        const zoom = Math.max(getZoom(), 0.6);
        // On narrow screens the inspector covers the lower part: aim for the visible top area.
        const height = root.current?.querySelector(".react-flow")?.clientHeight ?? 0;
        const shift = narrow ? (height * 0.3) / zoom : 0;
        setCenter(target.x + 120, target.y + 40 + shift, { zoom, duration: 300 });
      });
    }
  }, [nodes, edges, selectedId, narrow, screenToFlowPosition, setCenter, getZoom, setNodes, setEdges]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const key = event.dataTransfer.getData(DRAG_MIME);
    const item = CATALOG.flatMap(group => group.items).find(entry => entry.key === key);
    if (item) addNode(item, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addNode, screenToFlowPosition]);

  const updateNodeData = (id: string, data: Record<string, unknown>) =>
    setNodes(current => current.map(node => (node.id === id ? { ...node, data } : node)));

  const deleteNode = (id: string) => {
    setNodes(current => current.filter(node => node.id !== id));
    setEdges(current => current.filter(edge => edge.source !== id && edge.target !== id));
    setSelectedId(null);
  };

  // -------------------------------------------------------------------------
  // Copy / paste / duplicate
  // -------------------------------------------------------------------------

  const copySelection = (ids?: string[]) => {
    const wanted = new Set(ids ?? nodes.filter(node => node.selected).map(node => node.id));
    if (!wanted.size) return 0;
    clipboard = {
      nodes: structuredClone(graph.nodes.filter(node => wanted.has(node.id))),
      edges: graph.edges.filter(edge => wanted.has(edge.source) && wanted.has(edge.target)),
    };
    return wanted.size;
  };

  const paste = () => {
    if (!clipboard) return;
    const copy = copyCards(clipboard.nodes, clipboard.edges, { x: 40, y: 60 });
    setNodes(current => [
      ...current.map(node => ({ ...node, selected: false })),
      ...toCanvasNodes(copy.nodes).map(node => ({ ...node, selected: true })),
    ]);
    setEdges(current => [...current, ...toCanvasEdges(copy.edges)]);
    setSelectedId(copy.nodes.length === 1 ? copy.nodes[0].id : null);
    // Pasting again places the next copy a bit further.
    clipboard = copy;
  };

  const duplicate = (ids?: string[]) => {
    if (copySelection(ids)) paste();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.composedPath()[0] as HTMLElement | undefined;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        const count = copySelection();
        if (count) toast(root.current, t("{count} kaart(en) gekopieerd", { count }));
      } else if (key === "v" && clipboard) {
        event.preventDefault();
        paste();
      } else if (key === "d") {
        event.preventDefault();
        duplicate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // -------------------------------------------------------------------------
  // Autosave
  // -------------------------------------------------------------------------

  // Refs so the (async) save always works on the newest state.
  const latest = useRef({ current, saved, dirty, conflict: false });
  latest.current = { current, saved, dirty, conflict: saveState.kind === "conflict" };
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  /**
   * Saves the newest version. Complete flows are published to HA, incomplete ones are kept
   * as a draft (the automation keeps its last working version). A layout-only change does not
   * touch HA, so a running automation is not restarted by moving cards around.
   */
  const save = useCallback((overwrite = false): Promise<void> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      const flow = latest.current.current;
      const previous = latest.current.saved;
      const compiled = compileFlow(flow);
      setSaveState({ kind: "saving" });
      try {
        let next: FlowRecord;
        if (compiled.errors.length) {
          next = await saveDraft(hassRef.current, flow);
          setSaveState({ kind: "draft", reason: compiled.errors[0].message });
        } else if (!overwrite && hashConfig(compiled.config) === flow.config_hash) {
          next = await saveDraft(hassRef.current, flow);
          if (flow.enabled !== previous.enabled) await applyEnabled(() => hassRef.current, next);
          setSaveState({ kind: "saved" });
        } else {
          next = await publishFlow(() => hassRef.current, flow, overwrite);
          setSaveState({ kind: "saved" });
        }
        setSaved(next);
        onSavedRef.current(next);
      } catch (error) {
        setSaveState(error instanceof ExternalChange ? { kind: "conflict" } : { kind: "error", message: errorMessage(error) });
      }
    })();
    running.current = run.finally(() => {
      running.current = null;
      if (again.current) {
        again.current = false;
        if (latest.current.dirty && !latest.current.conflict) void save();
      }
    });
    return running.current;
  }, []);

  const paused = saveState.kind === "conflict";
  useEffect(() => {
    if (!dirty || !meta.name.trim() || paused) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, current, meta.name, paused, save]);

  // Leaving the panel (e.g. via the HA sidebar) still saves the last change.
  useEffect(() => () => {
    if (latest.current.dirty && !latest.current.conflict) void save();
  }, [save]);

  /** Waits for pending changes to be saved. */
  const flush = async () => {
    if (running.current) await running.current;
    if (latest.current.dirty && !latest.current.conflict && latest.current.current.name.trim()) await save();
  };

  // -------------------------------------------------------------------------
  // Test / navigation
  // -------------------------------------------------------------------------

  // With several triggers that each have their own path, a plain test run matches none of them.
  const triggerNodes = graph.nodes.filter(node => node.type === "trigger");
  const needsTriggerChoice = result.config.actions.some(step => "choose" in step);

  /** Runs the flow's actions as if the given trigger fired (automation.trigger cannot set a trigger id). */
  const testAs = async (node: FlowNode) => {
    setTestMenu(false);
    await flush();
    const actions = compileFlow(latest.current.current).config.actions;
    hassRef.current
      .callWS({ type: "execute_script", sequence: actions, variables: { trigger: { id: node.id, platform: "flowey_test" } } })
      .catch(error => toast(root.current, t("Testen mislukt: {error}", { error: errorMessage(error) })));
    toast(root.current, t("Flow gestart alsof \"{trigger}\" gebeurde", { trigger: describeNodeLine(hass, node, t) }));
  };

  const test = async () => {
    if (needsTriggerChoice) return setTestMenu(!testMenu);
    await flush();
    const automation = findAutomationEntity(hassRef.current, automationId(saved.id));
    if (!automation) return toast(root.current, t("Deze flow is nog niet actief. Maak hem eerst compleet."));
    try {
      await triggerAutomation(hassRef.current, automation.entity_id);
      toast(root.current, t("Flow gestart"));
    } catch (error) {
      toast(root.current, t("Testen mislukt: {error}", { error: errorMessage(error) }));
    }
  };

  const openTraces = () => navigate(`/config/automation/trace/${automationId(saved.id)}`);

  const back = async () => {
    await flush();
    onBack();
  };

  const status = (() => {
    if (!meta.name.trim()) return { className: "status-error", text: t("Geef de flow een naam") };
    if (saveState.kind === "conflict") return { className: "status-error", text: t("Niet opgeslagen: gewijzigd in YAML") };
    if (saveState.kind === "error") return { className: "status-error", text: t("Opslaan mislukt"), title: saveState.message };
    if (dirty || saveState.kind === "saving") return { className: "status-saving", text: t("Opslaan…") };
    if (result.errors.length || saved.config_hash === null) {
      return { className: "status-draft", text: t("Concept, nog niet actief"), title: result.errors[0] ? t(result.errors[0].message) : undefined };
    }
    return { className: "status-enabled", text: t("✓ Opgeslagen") };
  })();

  return (
    <IssuesContext.Provider value={issuesByNode}>
      <div className="editor" ref={root}>
        <header className="toolbar">
          <button type="button" className="icon-btn" title={t("Terug naar overzicht")} onClick={back}>←</button>
          <input
            className="flow-name"
            value={meta.name}
            onChange={event => setMeta({ ...meta, name: event.target.value })}
            aria-label={t("Naam van de flow")}
          />
          <span className={`badge ${status.className}`} title={status.title}>{status.text}</span>
          <div className="toolbar-spacer" />
          <label className="switch" title={t("Flow in- of uitschakelen")}>
            <input type="checkbox" checked={meta.enabled} onChange={event => setMeta({ ...meta, enabled: event.target.checked })} />
            <span>{meta.enabled ? t("Aan") : t("Uit")}</span>
          </label>
          <select className="input mode" value={meta.mode} title={t("Wat als de flow al loopt?")}
            onChange={event => setMeta({ ...meta, mode: event.target.value as FlowMode })}>
            {MODES.map(mode => <option key={mode.value} value={mode.value}>{t(mode.label)}</option>)}
          </select>
          <button type="button" className="btn secondary" onClick={() => setShowYaml(true)}>YAML</button>
          {entity && <button type="button" className="btn secondary" onClick={openTraces}>{t("Traces")}</button>}
          <span className="menu-anchor">
            <button type="button" className="btn secondary" onClick={test} disabled={!entity && !dirty}
              title={needsTriggerChoice ? t("Kies welke trigger je wilt nabootsen") : t("Voert de acties direct uit (triggers worden overgeslagen)")}>
              ▶ {t("Test")}{needsTriggerChoice ? " ▾" : ""}
            </button>
            {testMenu && (
              <div className="menu">
                <div className="menu-title">{t("Test alsof deze trigger gebeurde:")}</div>
                {triggerNodes.map(node => (
                  <button type="button" key={node.id} className="menu-item" onClick={() => void testAs(node)}>
                    {catalogItem(node.type, node.data.kind)?.icon} {describeNodeLine(hass, node, t)}
                  </button>
                ))}
              </div>
            )}
          </span>
        </header>

        {saveState.kind === "conflict" && (
          <div className="banner">
            {t("Deze automation is buiten Flow Builder gewijzigd (in YAML of de HA-editor). Automatisch opslaan staat stil.")}
            {" "}
            <button type="button" className="btn small-btn" onClick={() => void save(true)}>{t("Overschrijven met deze flow")}</button>
          </div>
        )}
        {saveState.kind === "error" && (
          <div className="banner">{t("Opslaan mislukt: {error}", { error: saveState.message })}</div>
        )}
        {flowIssues.length > 0 && nodes.length > 0 && (
          <div className="banner">{flowIssues.map(issue => t(issue.message)).join(" ")}</div>
        )}

        <div className="workspace">
          {narrow && !(selectedNode && !paletteOpen) && (
            <button type="button" className="btn fab" onClick={() => setPaletteOpen(!paletteOpen)}>
              {paletteOpen ? "✕" : `＋ ${t("Kaart")}`}
            </button>
          )}
          <Palette open={paletteOpen} onAdd={item => addNode(item)} />

          <div className="canvas" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
            {nodes.length === 0 && (
              <div className="canvas-empty">
                <div className="big">⚡</div>
                <p>{narrow ? t("Begin met een ALS-kaart: tik op ＋ Kaart.") : t("Begin met een ALS-kaart: sleep er een uit de lijst links.")}</p>
                <p className="muted">{t("Tip: selecteer een kaart en klik daarna op een nieuwe kaart. Die wordt dan automatisch verbonden.")}</p>
              </div>
            )}
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onSelectionChange={({ nodes: selection }) => setSelectedId(selection.length === 1 ? selection[0].id : null)}
              onNodesDelete={() => setSelectedId(null)}
              deleteKeyCode={["Backspace", "Delete"]}
              // Only fit existing flows; for a new flow it would override centering on the first card.
              fitView={initial.graph.nodes.length > 0}
              fitViewOptions={{ maxZoom: 1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              {!narrow && <MiniMap pannable zoomable bgColor="var(--fl-card)" maskColor="rgba(127, 127, 127, 0.18)" nodeClassName={node => `minimap-${node.type}`} />}
            </ReactFlow>
          </div>

          {selectedNode && !(narrow && paletteOpen) && (
            <Inspector
              key={selectedNode.id}
              node={selectedNode as FlowNode}
              issues={issuesByNode.get(selectedNode.id) ?? []}
              onChange={data => updateNodeData(selectedNode.id, data)}
              onDelete={() => deleteNode(selectedNode.id)}
              onDuplicate={() => duplicate([selectedNode.id])}
              onAddNext={narrow ? () => setPaletteOpen(true) : undefined}
              onClose={() => {
                setSelectedId(null);
                setNodes(current => current.map(node => ({ ...node, selected: false })));
              }}
            />
          )}
        </div>

        {showYaml && (
          <div className="overlay" onClick={() => setShowYaml(false)}>
            <div className="dialog" onClick={event => event.stopPropagation()}>
              <header className="dialog-head">
                <h2>Home Assistant YAML</h2>
                <button type="button" className="icon-btn" onClick={() => setShowYaml(false)}>✕</button>
              </header>
              <p className="muted">
                {t("Deze automation wordt opgeslagen in automations.yaml met id {id}. Je kunt hem daar lezen of hergebruiken, maar bewerk hem bij voorkeur hier.", { id: result.config.id })}
              </p>
              {result.errors.length > 0 && (
                <ul className="issue-list">
                  {result.errors.map(issue => <li key={`${issue.nodeId}${issue.message}`}>⚠ {t(issue.message)}</li>)}
                </ul>
              )}
              <pre className="yaml">{stringify(result.config)}</pre>
            </div>
          </div>
        )}
      </div>
    </IssuesContext.Provider>
  );
}
