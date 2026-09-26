/** Language setup, flow overview and routing into the canvas editor. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  errorMessage,
  findAutomationEntity,
  getAutomationConfig,
  getSettings,
  listFlows,
  loadServiceNames,
  saveFlow,
  saveSettings,
  setAutomationEnabled,
  triggerAutomation,
} from "./api/ha";
import { automationId } from "./compiler/compile";
import type { AutomationConfig, FlowNode, FlowRecord } from "./compiler/types";
import { Editor } from "./canvas/Editor";
import { newFlow } from "./canvas/graph";
import { toast, useHass } from "./context";
import { flowStatus, removeFlow, STATUS_LABELS } from "./flowActions";
import { LangContext, makeT, resolveLang, useLang, useT, type LangSetting, type LangState } from "./i18n";
import { catalogItem, describeNodeLine } from "./nodes/catalog";
import { useCardLabel } from "./nodes/useCardLabel";

export function App({ narrow }: { narrow: boolean }) {
  const hass = useHass();
  const [setting, setSetting] = useState<LangSetting | null>(null);
  const [namesLoaded, setNamesLoaded] = useState(0);

  useEffect(() => {
    getSettings(hass).then(settings => setSetting(settings.language)).catch(() => setSetting("auto"));
  }, []);

  const lang = resolveLang(setting ?? "auto", hass.language);
  useEffect(() => {
    // Localized action names ("Licht aanzetten") in the app language.
    loadServiceNames(hass, lang).then(() => setNamesLoaded(count => count + 1));
  }, [lang]);

  const state = useMemo<LangState>(() => ({
    lang,
    setting: setting ?? "auto",
    // A new t() after service names load re-renders everything that shows them.
    t: makeT(lang),
    setSetting: next => {
      setSetting(next);
      saveSettings(hass, { language: next }).catch(() => undefined);
    },
  }), [lang, setting, namesLoaded]);

  if (setting === null) return <div className="page muted">…</div>;
  return (
    <LangContext.Provider value={state}>
      <FlowsPage narrow={narrow} />
    </LangContext.Provider>
  );
}

function FlowsPage({ narrow }: { narrow: boolean }) {
  const hass = useHass();
  const { t, setting, setSetting } = useLang();
  const root = useRef<HTMLDivElement>(null);
  const [flows, setFlows] = useState<FlowRecord[] | null>(null);
  const [remote, setRemote] = useState<Record<string, AutomationConfig | null>>({});
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<FlowRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listFlows(hass);
      setFlows(list.sort((a, b) => a.name.localeCompare(b.name)));
      setError("");
      const configs = await Promise.all(
        list.map(async flow => [flow.id, flow.config_hash === null ? null : await getAutomationConfig(hass, automationId(flow.id))] as const),
      );
      setRemote(Object.fromEntries(configs));
    } catch (err) {
      setError(t("Kan flows niet laden: {error}", { error: errorMessage(err) }));
    }
    // Only load on mount; hass changes on every state update.
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (editing) {
    return (
      <Editor
        flow={editing}
        narrow={narrow}
        onBack={() => {
          setEditing(null);
          load();
        }}
        onSaved={saved => setFlows(current => current?.some(f => f.id === saved.id)
          ? current.map(f => (f.id === saved.id ? saved : f))
          : [...(current ?? []), saved])}
      />
    );
  }

  const toggle = async (flow: FlowRecord) => {
    const entity = findAutomationEntity(hass, automationId(flow.id));
    const enabled = !flow.enabled;
    try {
      if (entity) await setAutomationEnabled(hass, entity.entity_id, enabled);
      const saved = await saveFlow(hass, { ...flow, enabled });
      setFlows(current => current!.map(f => (f.id === saved.id ? saved : f)));
    } catch (err) {
      toast(root.current, t("Wijzigen mislukt: {error}", { error: errorMessage(err) }));
    }
  };

  const run = async (flow: FlowRecord) => {
    const entity = findAutomationEntity(hass, automationId(flow.id));
    if (!entity) return toast(root.current, t("Deze flow is nog niet actief in Home Assistant."));
    try {
      await triggerAutomation(hass, entity.entity_id);
      toast(root.current, t("\"{name}\" gestart", { name: flow.name }));
    } catch (err) {
      toast(root.current, t("Testen mislukt: {error}", { error: errorMessage(err) }));
    }
  };

  const remove = async (flow: FlowRecord) => {
    if (!window.confirm(t("\"{name}\" verwijderen? De bijbehorende automation wordt ook verwijderd.", { name: flow.name }))) return;
    try {
      await removeFlow(hass, flow);
      setFlows(current => current!.filter(f => f.id !== flow.id));
    } catch (err) {
      toast(root.current, t("Verwijderen mislukt: {error}", { error: errorMessage(err) }));
    }
  };

  return (
    <div className="page" ref={root}>
      <header className="page-head">
        {narrow && (
          <button type="button" className="icon-btn" title={t("Menu")}
            onClick={event => event.currentTarget.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }))}>
            ☰
          </button>
        )}
        <div>
          <h1>⚡ Flows</h1>
          <div className="muted">{t("Automatiseren zoals op Homey, uitgevoerd door Home Assistant zelf.")}</div>
        </div>
        <select className="input language" value={setting} title={t("Taal")}
          onChange={event => setSetting(event.target.value as LangSetting)}>
          <option value="auto">{t("Taal: zoals Home Assistant")}</option>
          <option value="nl">Nederlands</option>
          <option value="en">English</option>
        </select>
        <button type="button" className="btn" onClick={() => setEditing(newFlow(t("Nieuwe flow")))}>＋ {t("Nieuwe flow")}</button>
      </header>

      {error && <div className="banner">{error}</div>}
      {!flows && !error && <div className="muted">{t("Laden…")}</div>}
      {flows?.length === 0 && (
        <div className="empty">
          <div className="big">⚡</div>
          <h2>{t("Maak je eerste flow")}</h2>
          <p>{t("Kies wat de flow start (ALS), voeg eventueel voorwaarden toe (EN) en bepaal wat er gebeurt (DAN).")}</p>
          <button type="button" className="btn" onClick={() => setEditing(newFlow(t("Nieuwe flow")))}>＋ {t("Nieuwe flow")}</button>
        </div>
      )}

      <div className="flow-grid">
        {flows?.map(flow => {
          const status = flowStatus(hass, flow, flow.config_hash === null ? null : remote[flow.id]);
          const triggers = flow.graph.nodes.filter(node => node.type === "trigger");
          return (
            <article key={flow.id} className="flow-tile" onClick={() => setEditing(flow)}>
              <div className="flow-tile-head">
                <h2>{flow.name}</h2>
                <span className={`badge status-${status}`}>{t(STATUS_LABELS[status])}</span>
              </div>
              <ul className="flow-tile-triggers">
                {triggers.slice(0, 3).map(node => <TriggerLine key={node.id} node={node} />)}
                {triggers.length === 0 && <li className="muted">{t("Nog geen trigger")}</li>}
                {triggers.length > 3 && <li className="muted">{t("+ {count} meer", { count: triggers.length - 3 })}</li>}
              </ul>
              <div className="muted small">{t("{count} kaarten", { count: flow.graph.nodes.length })}</div>
              <div className="flow-tile-actions" onClick={event => event.stopPropagation()}>
                <label className="switch">
                  <input type="checkbox" checked={flow.enabled} onChange={() => toggle(flow)} />
                  <span>{flow.enabled ? t("Aan") : t("Uit")}</span>
                </label>
                <button type="button" className="btn secondary" onClick={() => run(flow)}
                  disabled={status === "draft" || status === "missing"}>▶ {t("Test")}</button>
                <button type="button" className="icon-btn danger" title={t("Verwijderen")} onClick={() => remove(flow)}>🗑</button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TriggerLine({ node }: { node: FlowNode }) {
  const hass = useHass();
  const t = useT();
  const label = useCardLabel(node.type, node.data.kind === "device" ? node.data.card : undefined);
  return <li>{catalogItem(node.type, node.data.kind)?.icon} {describeNodeLine(hass, node, t, label)}</li>;
}
