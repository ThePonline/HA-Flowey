/** Publishing flows as native automations and deriving their status. */
import {
  deleteAutomationConfig,
  deleteFlowRecord,
  findAutomationEntity,
  getAutomationConfig,
  saveFlow,
  setAutomationEnabled,
  writeAutomationConfig,
  type Hass,
} from "./api/ha";
import { automationId, compileFlow, hashConfig } from "./compiler/compile";
import type { AutomationConfig, CompileIssue, FlowRecord } from "./compiler/types";

export type FlowStatus = "draft" | "enabled" | "disabled" | "modified" | "unpublished" | "missing" | "loading";

export const STATUS_LABELS: Record<FlowStatus, string> = {
  draft: "Concept",
  enabled: "Actief",
  disabled: "Uit",
  modified: "Gewijzigd in YAML",
  unpublished: "Niet gepubliceerd",
  missing: "Ontbreekt in HA",
  loading: "…",
};

/**
 * remote: the automation config currently in automations.yaml
 * (undefined = not fetched yet, null = does not exist).
 */
export function flowStatus(hass: Hass, flow: FlowRecord, remote: AutomationConfig | null | undefined): FlowStatus {
  if (flow.config_hash === null) return "draft";
  if (remote === undefined) return "loading";
  if (remote === null) return "missing";
  if (hashConfig(remote) !== flow.config_hash) return "modified";
  // Canvas saved with changes that were not (yet) valid enough to publish.
  if (hashConfig(compileFlow(flow).config) !== flow.config_hash) return "unpublished";
  const entity = findAutomationEntity(hass, automationId(flow.id));
  if (!entity) return "loading";
  return entity.state === "off" ? "disabled" : "enabled";
}

export class PublishBlocked extends Error {
  constructor(public issues: CompileIssue[]) {
    super(issues[0]?.message ?? "Flow is onvolledig");
  }
}

export class ExternalChange extends Error {
  constructor() {
    super("Deze automation is buiten Flow Builder gewijzigd.");
  }
}

/**
 * Compile → write automations.yaml (HA validates and reloads) → store graph + hash.
 * Throws ExternalChange when the YAML was edited elsewhere, unless `overwrite` is set.
 */
export async function publishFlow(getHass: () => Hass, flow: FlowRecord, overwrite = false): Promise<FlowRecord> {
  const hass = getHass();
  const { config, errors } = compileFlow(flow);
  if (errors.length) throw new PublishBlocked(errors);

  if (flow.config_hash !== null && !overwrite) {
    const remote = await getAutomationConfig(hass, config.id);
    if (remote && hashConfig(remote) !== flow.config_hash) throw new ExternalChange();
  }

  await writeAutomationConfig(hass, config);
  const saved = await saveFlow(hass, { ...flow, config_hash: hashConfig(config) });
  await applyEnabled(getHass, saved);
  return saved;
}

/** Saves only the canvas (e.g. an unfinished draft) without touching the automation. */
export const saveDraft = (hass: Hass, flow: FlowRecord) => saveFlow(hass, flow);

export async function applyEnabled(getHass: () => Hass, flow: FlowRecord): Promise<void> {
  // The config API reloads automations before responding, but the entity can take a
  // moment to show up in hass.states; wait briefly for it.
  const id = automationId(flow.id);
  for (let attempt = 0; attempt < 20; attempt++) {
    const entity = findAutomationEntity(getHass(), id);
    if (entity) {
      if ((entity.state !== "off") !== flow.enabled) await setAutomationEnabled(getHass(), entity.entity_id, flow.enabled);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

export async function removeFlow(hass: Hass, flow: FlowRecord): Promise<void> {
  if (flow.config_hash !== null) await deleteAutomationConfig(hass, automationId(flow.id));
  await deleteFlowRecord(hass, flow.id);
}
