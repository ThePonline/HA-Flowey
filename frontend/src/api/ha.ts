/** Thin wrappers around the `hass` object Home Assistant passes to custom panels. */
import type { AutomationConfig, DeviceCard, FlowRecord } from "../compiler/types";
import type { Lang, LangSetting, Translate } from "../i18n";

export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, any> & { friendly_name?: string; id?: string };
  last_changed?: string;
}

export interface HassDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  area_id: string | null;
  manufacturer?: string | null;
  model?: string | null;
  entry_type?: string | null;
}

export interface HassEntity {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  name?: string | null;
  hidden?: boolean;
  entity_category?: string | null;
}

export interface HassService {
  name?: string;
  description?: string;
  fields?: Record<string, { name?: string; description?: string; example?: unknown; selector?: Record<string, unknown> }>;
  target?: unknown;
}

export type LocalizeFunc = (key: string, values?: Record<string, unknown>) => string;

export interface Hass {
  states: Record<string, HassEntityState>;
  devices: Record<string, HassDevice>;
  entities: Record<string, HassEntity>;
  areas: Record<string, { area_id: string; name: string }>;
  services: Record<string, Record<string, HassService>>;
  language: string;
  localize: LocalizeFunc;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  callApi<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, data?: unknown): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Flow store (our integration)
// ---------------------------------------------------------------------------

export const listFlows = (hass: Hass) =>
  hass.callWS<{ flows: FlowRecord[] }>({ type: "ha_flow_builder/flows/list" }).then(r => r.flows);

export const saveFlow = (hass: Hass, flow: FlowRecord) =>
  hass
    .callWS<{ flow: FlowRecord }>({
      type: "ha_flow_builder/flows/save",
      flow: {
        id: flow.id,
        name: flow.name,
        enabled: flow.enabled,
        mode: flow.mode,
        graph: flow.graph,
        config_hash: flow.config_hash,
      },
    })
    .then(r => r.flow);

export interface FlowSettings {
  language: LangSetting;
}

export const getSettings = (hass: Hass) =>
  hass.callWS<{ settings: FlowSettings }>({ type: "ha_flow_builder/settings/get" }).then(r => r.settings);

export const saveSettings = (hass: Hass, settings: FlowSettings) =>
  hass.callWS<{ settings: FlowSettings }>({ type: "ha_flow_builder/settings/set", settings }).then(r => r.settings);

export const deleteFlowRecord = (hass: Hass, flowId: string) =>
  hass.callWS({ type: "ha_flow_builder/flows/delete", flow_id: flowId });

// ---------------------------------------------------------------------------
// Native automations (same REST API the HA automation editor uses)
// ---------------------------------------------------------------------------

export async function getAutomationConfig(hass: Hass, id: string): Promise<AutomationConfig | null> {
  try {
    return await hass.callApi<AutomationConfig>("GET", `config/automation/config/${id}`);
  } catch (error) {
    if (errorStatus(error) === 404) return null;
    throw error;
  }
}

export const writeAutomationConfig = (hass: Hass, config: AutomationConfig) =>
  hass.callApi("POST", `config/automation/config/${config.id}`, config);

export async function deleteAutomationConfig(hass: Hass, id: string): Promise<void> {
  try {
    await hass.callApi("DELETE", `config/automation/config/${id}`);
  } catch (error) {
    if (errorStatus(error) !== 404) throw error;
  }
}

/** Automation entities expose their config id as the `id` attribute. */
export const findAutomationEntity = (hass: Hass, automationId: string): HassEntityState | undefined =>
  Object.values(hass.states).find(
    state => state.entity_id.startsWith("automation.") && state.attributes.id === automationId,
  );

export const setAutomationEnabled = (hass: Hass, entityId: string, enabled: boolean) =>
  hass.callService("automation", enabled ? "turn_on" : "turn_off", { entity_id: entityId });

export const triggerAutomation = (hass: Hass, entityId: string) =>
  // skip_condition: false so a test run behaves like the real thing.
  hass.callService("automation", "trigger", { entity_id: entityId, skip_condition: false });

/** Calls ha_flow_builder.call_webhook right away (test button); returns HTTP status and body. */
export const callWebhookNow = (hass: Hass, data: Record<string, unknown>) =>
  hass
    .callWS<{ response: { status: number; body: string } }>({
      type: "call_service",
      domain: "ha_flow_builder",
      service: "call_webhook",
      service_data: data,
      return_response: true,
    })
    .then(result => result.response);

// ---------------------------------------------------------------------------
// Device automation cards ("Haldeur sensor → geopend")
// ---------------------------------------------------------------------------

export type CardType = "trigger" | "condition" | "action";

export interface CapabilityField {
  name: string;
  type?: string;
  required?: boolean;
  optional?: boolean;
  default?: unknown;
  valueMin?: number;
  valueMax?: number;
  options?: [string, string][] | string[];
  selector?: Record<string, any>;
  description?: { suffix?: string };
}

const cardCache = new Map<string, Promise<DeviceCard[]>>();
const capabilityCache = new Map<string, Promise<CapabilityField[]>>();

export function listDeviceCards(hass: Hass, cardType: CardType, deviceId: string): Promise<DeviceCard[]> {
  const key = `${cardType}:${deviceId}`;
  if (!cardCache.has(key)) {
    const request = hass
      .callWS<DeviceCard[]>({ type: `device_automation/${cardType}/list`, device_id: deviceId })
      .catch(error => {
        cardCache.delete(key);
        throw error;
      });
    cardCache.set(key, request);
  }
  return cardCache.get(key)!;
}

export function getCardCapabilities(hass: Hass, cardType: CardType, card: DeviceCard): Promise<CapabilityField[]> {
  const { metadata: _metadata, ...clean } = card;
  const key = `${cardType}:${JSON.stringify(clean)}`;
  if (!capabilityCache.has(key)) {
    const request = hass
      .callWS<{ extra_fields?: CapabilityField[] }>({ type: `device_automation/${cardType}/capabilities`, [cardType]: clean })
      .then(result => result.extra_fields ?? [])
      .catch(() => []);
    capabilityCache.set(key, request);
  }
  return capabilityCache.get(key)!;
}

/** Entity registry id → entity_id. Device automations reference entities by registry id. */
let registryIds: Promise<Map<string, string>> | undefined;
export function entityRegistryIds(hass: Hass): Promise<Map<string, string>> {
  registryIds ??= hass
    .callWS<{ id: string; entity_id: string }[]>({ type: "config/entity_registry/list" })
    .then(entries => new Map(entries.map(entry => [entry.id, entry.entity_id])))
    .catch(() => {
      registryIds = undefined;
      return new Map();
    });
  return registryIds;
}

// ---------------------------------------------------------------------------
// Devices & entities, grouped the way people think about them
// ---------------------------------------------------------------------------

export interface DeviceOption {
  id: string;
  name: string;
  area: string;
}

export const deviceName = (device: HassDevice) => device.name_by_user || device.name || device.id;

export function deviceOptions(hass: Hass, t: Translate = text => text): DeviceOption[] {
  return Object.values(hass.devices ?? {})
    .filter(device => device.entry_type !== "service")
    .map(device => ({
      id: device.id,
      name: deviceName(device),
      area: (device.area_id && hass.areas?.[device.area_id]?.name) || t("Geen ruimte"),
    }))
    .sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
}

export interface EntityOption {
  entity_id: string;
  name: string;
  group: string;
}

const DOMAIN_GROUPS: Record<string, string> = {
  person: "Personen", zone: "Zones", weather: "Weer", sun: "Zon", input_boolean: "Schakelaars (helpers)",
  input_number: "Getallen (helpers)", input_select: "Keuzelijsten (helpers)", input_datetime: "Datum/tijd (helpers)",
  input_text: "Tekst (helpers)", timer: "Timers", counter: "Tellers", scene: "Scènes", script: "Scripts",
  automation: "Automatiseringen",
};

/** All entities grouped by their device (or area/domain when they have none). */
export function entityOptions(hass: Hass, domains?: string[], t: Translate = text => text): EntityOption[] {
  return Object.values(hass.states)
    .filter(state => !domains || domains.includes(state.entity_id.split(".")[0]))
    .map(state => {
      const entry = hass.entities?.[state.entity_id];
      const device = entry?.device_id ? hass.devices?.[entry.device_id] : undefined;
      const domain = state.entity_id.split(".")[0];
      const friendly = state.entity_id === "zone.home" ? t("Thuis") : state.attributes.friendly_name || state.entity_id;
      const group = device ? deviceName(device) : DOMAIN_GROUPS[domain] ? t(DOMAIN_GROUPS[domain]) : domain;
      return { entity_id: state.entity_id, name: friendly, group };
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// HA translations in the app language (independent of the user's HA profile)
// ---------------------------------------------------------------------------

const resourceCache = new Map<string, Promise<Record<string, string>>>();

/** Backend translation strings for one language, e.g. category "device_automation" or "services". */
export function backendResources(hass: Hass, lang: Lang, category: string, integration?: string): Promise<Record<string, string>> {
  const key = `${lang}|${category}|${integration ?? "*"}`;
  if (!resourceCache.has(key)) {
    resourceCache.set(key, hass
      .callWS<{ resources: Record<string, string> }>({
        type: "frontend/get_translations",
        language: lang,
        category,
        ...(integration ? { integration: [integration] } : {}),
      })
      .then(result => result.resources ?? {})
      .catch(() => {
        resourceCache.delete(key);
        return {};
      }));
  }
  return resourceCache.get(key)!;
}

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, name) => vars[name] ?? match);

/**
 * Clearer Dutch texts for motion/occupancy sensors than HA's own ("werd bezet").
 * Keyed by <domain>.<type key>.<type>.
 */
const NL_CARD_TEXTS: Record<string, string> = {
  "binary_sensor.trigger_type.occupied": "{entity_name}: beweging gedetecteerd",
  "binary_sensor.trigger_type.not_occupied": "{entity_name}: geen beweging meer",
  "binary_sensor.trigger_type.motion": "{entity_name}: beweging gedetecteerd",
  "binary_sensor.trigger_type.no_motion": "{entity_name}: geen beweging meer",
  "binary_sensor.condition_type.is_occupied": "{entity_name}: er is beweging",
  "binary_sensor.condition_type.is_not_occupied": "{entity_name}: geen beweging",
  "binary_sensor.condition_type.is_motion": "{entity_name}: er is beweging",
  "binary_sensor.condition_type.is_no_motion": "{entity_name}: geen beweging",
};

/** A card label before the (renamable) entity name is filled in. */
export interface CardLabelParts {
  template?: string;
  entityId?: string;
  subtype: string;
  type: string;
}

const labelCache = new Map<string, CardLabelParts>();
const labelKey = (lang: Lang, cardType: CardType, card: DeviceCard) => {
  const { metadata: _metadata, ...clean } = card;
  return `${lang}|${cardType}|${JSON.stringify(clean)}`;
};

/** Fills in the current entity name, so renamed devices/entities show up right away. */
export function formatCardLabel(hass: Hass, parts: CardLabelParts): string {
  const entity = parts.entityId ? hass.states[parts.entityId]?.attributes.friendly_name ?? parts.entityId : "";
  return parts.template
    ? fill(parts.template, { entity_name: entity, subtype: parts.subtype }).trim()
    : [entity, parts.type.replaceAll("_", " "), parts.subtype].filter(Boolean).join(" ");
}

/** Already loaded label parts, for synchronous rendering. */
export const cachedCardLabelParts = (lang: Lang, cardType: CardType, card: DeviceCard) =>
  labelCache.get(labelKey(lang, cardType, card));

/** Label parts in the app language, the way the HA automation editor builds them. */
export async function cardLabelParts(hass: Hass, lang: Lang, cardType: CardType, card: DeviceCard): Promise<CardLabelParts> {
  const key = labelKey(lang, cardType, card);
  const cached = labelCache.get(key);
  if (cached) return cached;

  const [resources, ids] = await Promise.all([
    backendResources(hass, lang, "device_automation", card.domain),
    entityRegistryIds(hass),
  ]);
  const typeKey = `${cardType}_type`;
  const parts: CardLabelParts = {
    entityId: card.entity_id ? ids.get(card.entity_id) ?? card.entity_id : undefined,
    subtype: card.subtype
      ? resources[`component.${card.domain}.device_automation.${cardType}_subtype.${card.subtype}`] ?? card.subtype
      : "",
    template: (lang === "nl" ? NL_CARD_TEXTS[`${card.domain}.${typeKey}.${card.type}`] : undefined) ??
      resources[`component.${card.domain}.device_automation.${typeKey}.${card.type}`],
    type: card.type,
  };
  labelCache.set(key, parts);
  return parts;
}

/**
 * Renames a device the same way HA's device settings do (device registry `name_by_user`);
 * null restores the integration's own name. Entity names derived from the device follow automatically.
 */
export const renameDevice = (hass: Hass, deviceId: string, nameByUser: string | null) =>
  hass.callWS({ type: "config/device_registry/update", device_id: deviceId, name_by_user: nameByUser });

let serviceNames: Record<string, string> = {};
/** Loads localized service names for serviceName(); resolves when done. */
export async function loadServiceNames(hass: Hass, lang: Lang): Promise<void> {
  serviceNames = await backendResources(hass, lang, "services");
}

/** Localized service name ("Licht aanzetten"), falling back to HA's own description or the id. */
export const serviceName = (hass: Hass, domain: string, service: string) =>
  serviceNames[`component.${domain}.services.${service}.name`] ||
  hass.services?.[domain]?.[service]?.name ||
  service.replaceAll("_", " ");

/**
 * Creates a timer helper, like Settings → Helpers → Timer does. "restore" keeps it running
 * across HA restarts (and fires timer.finished if it expired meanwhile). Returns its entity_id.
 */
export async function createTimer(hass: Hass, name: string, duration: string): Promise<string> {
  const created = await hass.callWS<{ id: string }>({
    type: "timer/create", name, duration, restore: true, icon: "mdi:timer-outline",
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    const entries = await hass.callWS<{ entity_id: string; platform: string; unique_id: string }[]>({ type: "config/entity_registry/list" });
    const entry = entries.find(item => item.platform === "timer" && item.unique_id === created.id);
    if (entry) return entry.entity_id;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return `timer.${created.id}`;
}

export const entityName = (hass: Hass, entityId: string | undefined) =>
  entityId ? hass.states[entityId]?.attributes.friendly_name ?? entityId : "";

export function errorStatus(error: unknown): number | undefined {
  const e = error as any;
  return e?.status_code ?? e?.status ?? e?.response?.status;
}

export function errorMessage(error: unknown): string {
  const e = error as any;
  const detail = e?.body?.message ?? e?.message ?? e?.error ?? e;
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  const status = errorStatus(error);
  return [status ? `HTTP ${status}` : "", text].filter(Boolean).join(": ") || "onbekende fout";
}
