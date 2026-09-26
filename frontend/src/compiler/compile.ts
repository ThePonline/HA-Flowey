/**
 * Compiles a canvas graph into a native Home Assistant automation config.
 *
 * Graph rules (v1):
 * - Trigger nodes start the flow; nothing may connect *into* a trigger.
 * - A node may have several incoming edges only if all of them come from triggers
 *   ("A or B happens → do X"). Any other merge of paths is rejected.
 * - Several outgoing edges from one output run in parallel.
 * - A condition with only a "yes" path becomes a plain condition step; with a "no"
 *   path it becomes if/then/else.
 */
import type {
  ActionData,
  AutomationConfig,
  CompileIssue,
  CompileResult,
  ConditionData,
  DeviceNodeData,
  Duration,
  FlowEdge,
  FlowNode,
  FlowRecord,
  HaStep,
  TriggerData,
  WaitData,
  WeatherData,
  WebhookData,
} from "./types";

export const AUTOMATION_ID_PREFIX = "flowey_";
export const MANAGED_MARKER = "Beheerd door HA Flow Builder — bewerk deze flow visueel in het Flows-paneel.";

export const automationId = (flowId: string) => `${AUTOMATION_ID_PREFIX}${flowId}`;

const WEBHOOK_ID_RE = /^[A-Za-z0-9_-]+$/;
const OFFSET_RE = /^[+-]?\d{1,2}:\d{2}(:\d{2})?$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

export function compileFlow(flow: FlowRecord): CompileResult {
  const errors: CompileIssue[] = [];
  const warnings: CompileIssue[] = [];
  const { nodes, edges } = flow.graph;
  const byId = new Map(nodes.map(node => [node.id, node]));

  const outgoing = (nodeId: string, handle: string): FlowNode[] =>
    edges
      .filter(edge => edge.source === nodeId && (edge.sourceHandle ?? "out") === handle)
      .map(edge => byId.get(edge.target))
      .filter((node): node is FlowNode => !!node)
      // Visual order (top to bottom) decides the order of parallel branches.
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  validateStructure(nodes, edges, byId, errors, warnings);

  const visiting = new Set<string>();

  const compileBranch = (targets: FlowNode[]): HaStep[] => {
    if (targets.length === 0) return [];
    if (targets.length === 1) return compileChain(targets[0]);
    return [{ parallel: targets.map(target => ({ sequence: compileChain(target) })) }];
  };

  const compileChain = (node: FlowNode): HaStep[] => {
    if (visiting.has(node.id)) {
      errors.push({ nodeId: node.id, message: "Deze flow bevat een lus." });
      return [];
    }
    visiting.add(node.id);
    try {
      if (node.type === "action" && node.data.kind === "wait") return compileWait(node.id, node.data);
      if (node.type === "action") {
        const step = actionStep(node.id, node.data, errors);
        return [...(step ? [step] : []), ...compileBranch(outgoing(node.id, "out"))];
      }
      if (node.type === "condition") {
        const condition = conditionStep(node.id, node.data, errors) ?? {};
        const yes = compileBranch(outgoing(node.id, "yes"));
        const noTargets = outgoing(node.id, "no");
        if (noTargets.length === 0) return [condition, ...yes];
        const no = compileBranch(noTargets);
        if (yes.length === 0) return [{ if: [{ condition: "not", conditions: [condition] }], then: no }];
        return [{ if: [condition], then: yes, else: no }];
      }
      errors.push({ nodeId: node.id, message: "Een trigger kan niet midden in een flow staan." });
      return [];
    } finally {
      visiting.delete(node.id);
    }
  };

  /**
   * wait_for_trigger with optional timeout. HA continues after a timeout by default, so
   * continue_on_timeout is set explicitly: only when the "tijd verstreken" path is used.
   */
  const compileWait = (nodeId: string, data: WaitData): HaStep[] => {
    let waitTrigger: HaStep = {};
    if (!data.trigger) errors.push({ nodeId, message: "Kies waarop gewacht moet worden." });
    else {
      const step = triggerStep(nodeId, data.trigger, errors);
      if (step) {
        const { id: _id, ...rest } = step;
        waitTrigger = rest;
      }
    }
    const timeout = duration(data.timeout);
    const done = compileBranch(outgoing(nodeId, "done"));
    const timedOut = compileBranch(outgoing(nodeId, "timeout"));
    if (!timeout && timedOut.length) {
      warnings.push({ nodeId, message: "Stel een maximale wachttijd in; anders wordt 'tijd verstreken' nooit gebruikt." });
    }
    const wait = clean({
      wait_for_trigger: [waitTrigger],
      timeout,
      continue_on_timeout: timeout ? timedOut.length > 0 : undefined,
    });
    if (!timeout || timedOut.length === 0) return [wait, ...done];
    const timedOutCondition = { condition: "template", value_template: "{{ wait.trigger is none }}" };
    if (done.length === 0) return [wait, { if: [timedOutCondition], then: timedOut }];
    return [wait, { if: [timedOutCondition], then: timedOut, else: done }];
  };

  const triggerNodes = nodes
    .filter((node): node is Extract<FlowNode, { type: "trigger" }> => node.type === "trigger")
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  const triggers: HaStep[] = [];
  const branches: { triggerIds: string[]; actions: HaStep[] }[] = [];

  for (const node of triggerNodes) {
    const trigger = triggerStep(node.id, node.data, errors);
    if (trigger) triggers.push(trigger);

    let actions = compileBranch(outgoing(node.id, "out"));
    if (node.data.kind === "time" && node.data.weekdays?.length && node.data.weekdays.length < 7) {
      actions = [{ condition: "time", weekday: node.data.weekdays }, ...actions];
    }
    if (actions.length === 0) {
      warnings.push({ nodeId: node.id, message: "Deze trigger is nergens mee verbonden." });
      continue;
    }
    // Triggers that lead to identical steps share one branch.
    const key = stableStringify(actions);
    const existing = branches.find(branch => stableStringify(branch.actions) === key);
    if (existing) existing.triggerIds.push(node.id);
    else branches.push({ triggerIds: [node.id], actions });
  }

  let actions: HaStep[];
  if (branches.length === 0) actions = [];
  else if (branches.length === 1 && branches[0].triggerIds.length === triggers.length) actions = branches[0].actions;
  else {
    actions = [{
      choose: branches.map(branch => ({
        conditions: [{ condition: "trigger", id: branch.triggerIds.length === 1 ? branch.triggerIds[0] : branch.triggerIds }],
        sequence: branch.actions,
      })),
    }];
  }

  if (triggerNodes.length === 0) errors.push({ message: "Voeg minstens één trigger toe (ALS…)." });
  else if (actions.length === 0 && errors.length === 0) errors.push({ message: "Verbind de trigger met minstens één actie (DAN…)." });

  const config: AutomationConfig = {
    id: automationId(flow.id),
    alias: flow.name,
    description: MANAGED_MARKER,
    mode: flow.mode,
    triggers,
    conditions: [],
    actions,
  };
  return { config, errors: dedupe(errors), warnings: dedupe(warnings) };
}

function validateStructure(
  nodes: FlowNode[],
  edges: FlowEdge[],
  byId: Map<string, FlowNode>,
  errors: CompileIssue[],
  warnings: CompileIssue[],
): void {
  for (const node of nodes) {
    const incoming = edges.filter(edge => edge.target === node.id);
    if (node.type === "trigger") {
      if (incoming.length) errors.push({ nodeId: node.id, message: "Een trigger kan geen inkomende verbinding hebben." });
      continue;
    }
    if (incoming.length === 0) {
      warnings.push({ nodeId: node.id, message: "Deze kaart is niet verbonden en wordt genegeerd." });
    } else if (incoming.length > 1 && incoming.some(edge => byId.get(edge.source)?.type !== "trigger")) {
      errors.push({
        nodeId: node.id,
        message: "Paden samenvoegen kan alleen direct na triggers. Maak voor elk pad een eigen kaart.",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Node → HA step
// ---------------------------------------------------------------------------

function triggerStep(nodeId: string, data: TriggerData, errors: CompileIssue[]): HaStep | null {
  const fail = (message: string) => (errors.push({ nodeId, message }), null);
  switch (data.kind) {
    case "device": {
      const card = deviceCard(nodeId, data, errors);
      if (!card) return null;
      const { platform, ...rest } = card;
      return { trigger: platform ?? "device", ...rest, id: nodeId };
    }
    case "state": {
      if (!data.entity_id) return fail("Kies een entiteit.");
      return clean({
        trigger: "state",
        entity_id: data.entity_id,
        from: data.from || undefined,
        to: data.to || undefined,
        for: duration(data.for),
        id: nodeId,
      });
    }
    case "time":
      if (!data.at || !TIME_RE.test(data.at)) return fail("Vul een tijd in (uu:mm).");
      return { trigger: "time", at: fullTime(data.at), id: nodeId };
    case "time_pattern": {
      const pattern = clean({
        hours: data.hours || undefined,
        minutes: data.minutes || undefined,
        seconds: data.seconds || undefined,
      });
      if (Object.keys(pattern).length === 0) return fail("Vul minstens één interval in.");
      return { trigger: "time_pattern", ...pattern, id: nodeId };
    }
    case "sun":
      if (!data.event) return fail("Kies zonsopkomst of zonsondergang.");
      if (data.offset && !OFFSET_RE.test(data.offset)) return fail("Ongeldige verschuiving, gebruik bijv. -00:30.");
      return clean({ trigger: "sun", event: data.event, offset: normalizeOffset(data.offset), id: nodeId });
    case "weather": {
      const step = weatherStep("trigger", data, fail);
      return step && { ...step, id: nodeId };
    }
    case "webhook": {
      if (!data.webhook_id || !WEBHOOK_ID_RE.test(data.webhook_id)) {
        return fail("Het webhook-ID mag alleen letters, cijfers, - en _ bevatten.");
      }
      return {
        trigger: "webhook",
        webhook_id: data.webhook_id,
        allowed_methods: data.methods?.length ? data.methods : ["POST", "PUT"],
        local_only: data.local_only ?? true,
        id: nodeId,
      };
    }
    case "presence": {
      const zone = data.zone || "zone.home";
      const inZone = zoneState(zone, data.zone_state);
      switch (data.event) {
        case "arrive":
        case "leave":
          if (!data.persons?.length) return fail("Kies minstens één persoon.");
          return {
            trigger: "state",
            entity_id: data.persons,
            [data.event === "arrive" ? "to" : "from"]: inZone,
            id: nodeId,
          };
        // A zone's state is the number of persons in it.
        case "first_arrive":
          return { trigger: "state", entity_id: zone, from: "0", not_to: UNAVAILABLE, id: nodeId };
        case "last_leave":
          return { trigger: "state", entity_id: zone, to: "0", not_from: UNAVAILABLE, id: nodeId };
      }
      return fail("Kies wat er moet gebeuren (komt aan, vertrekt, …).");
    }
  }
}

const UNAVAILABLE = ["unavailable", "unknown"];

/** Person state meaning "in this zone": "home" for zone.home, otherwise the zone's name. */
function zoneState(zone: string, stored: string | undefined): string {
  return zone === "zone.home" ? "home" : stored || zone.replace(/^zone\./, "");
}

function weatherStep(type: "trigger" | "condition", data: WeatherData, fail: (message: string) => null): HaStep | null {
  if (!data.entity_id) return fail("Kies een weerbron.");
  const measure = data.measure ?? "condition";
  if (measure === "condition") {
    if (!data.conditions?.length) return fail("Kies minstens één weertype.");
    const states = data.conditions.length === 1 ? data.conditions[0] : data.conditions;
    return type === "trigger"
      ? { trigger: "state", entity_id: data.entity_id, to: states }
      : { condition: "state", entity_id: data.entity_id, state: states };
  }
  const above = toNumber(data.above);
  const below = toNumber(data.below);
  if (above === undefined && below === undefined) return fail("Vul 'boven' en/of 'onder' in.");
  return clean({ [type]: "numeric_state", entity_id: data.entity_id, attribute: measure, above, below });
}

function conditionStep(nodeId: string, data: ConditionData, errors: CompileIssue[]): HaStep | null {
  const fail = (message: string) => (errors.push({ nodeId, message }), null);
  switch (data.kind) {
    case "device":
      return deviceCard(nodeId, data, errors);
    case "state":
      if (!data.entity_id) return fail("Kies een entiteit.");
      if (!data.state) return fail("Vul de gewenste status in.");
      return { condition: "state", entity_id: data.entity_id, state: data.state };
    case "numeric_state": {
      if (!data.entity_id) return fail("Kies een entiteit.");
      const above = toNumber(data.above);
      const below = toNumber(data.below);
      if (above === undefined && below === undefined) return fail("Vul 'boven' en/of 'onder' in.");
      return clean({ condition: "numeric_state", entity_id: data.entity_id, above, below });
    }
    case "time": {
      if (data.after && !TIME_RE.test(data.after)) return fail("Ongeldige 'na'-tijd.");
      if (data.before && !TIME_RE.test(data.before)) return fail("Ongeldige 'voor'-tijd.");
      const weekday = data.weekdays?.length && data.weekdays.length < 7 ? data.weekdays : undefined;
      if (!data.after && !data.before && !weekday) return fail("Vul een tijdvak en/of weekdagen in.");
      return clean({
        condition: "time",
        after: data.after ? fullTime(data.after) : undefined,
        before: data.before ? fullTime(data.before) : undefined,
        weekday,
      });
    }
    case "sun": {
      if (!data.after && !data.before) return fail("Kies 'na' en/of 'voor' een zonsgebeurtenis.");
      for (const offset of [data.after_offset, data.before_offset]) {
        if (offset && !OFFSET_RE.test(offset)) return fail("Ongeldige verschuiving, gebruik bijv. -00:30.");
      }
      return clean({
        condition: "sun",
        after: data.after,
        after_offset: data.after ? normalizeOffset(data.after_offset) : undefined,
        before: data.before,
        before_offset: data.before ? normalizeOffset(data.before_offset) : undefined,
      });
    }
    case "weather":
      return weatherStep("condition", data, fail);
    case "presence": {
      const zone = data.zone || "zone.home";
      const inZone = zoneState(zone, data.zone_state);
      switch (data.check) {
        case "someone":
          return { condition: "numeric_state", entity_id: zone, above: 0 };
        case "nobody":
          return { condition: "state", entity_id: zone, state: "0" };
        case "persons_in":
          if (!data.persons?.length) return fail("Kies minstens één persoon.");
          return { condition: "state", entity_id: data.persons, state: inZone };
        case "persons_not_in":
          if (!data.persons?.length) return fail("Kies minstens één persoon.");
          // "None of them is there": not(any of them is there).
          return {
            condition: "not",
            conditions: [{ condition: "state", entity_id: data.persons, match: "any", state: inZone }],
          };
      }
      return fail("Kies wat er moet gelden.");
    }
  }
}

function actionStep(nodeId: string, data: ActionData, errors: CompileIssue[]): HaStep | null {
  const fail = (message: string) => (errors.push({ nodeId, message }), null);
  switch (data.kind) {
    case "device":
      return deviceCard(nodeId, data, errors);
    case "service": {
      if (!data.service || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(data.service)) return fail("Kies een actie (service).");
      const target = clean({ ...(data.target ?? {}) });
      for (const key of Object.keys(target)) {
        const value = target[key];
        if (value === "" || (Array.isArray(value) && value.length === 0)) delete target[key];
      }
      return clean({
        action: data.service,
        target: Object.keys(target).length ? target : undefined,
        data: data.data && Object.keys(data.data).length ? data.data : undefined,
      });
    }
    case "delay": {
      const delay = duration(data);
      if (!delay) return fail("Vul een wachttijd in.");
      return { delay };
    }
    case "wait":
      // Has two outputs, so it is compiled in compileFlow (compileWait).
      return null;
    case "light": {
      if (!data.entities?.length) return fail("Kies minstens één lamp.");
      const action = data.action ?? "on";
      const target = { entity_id: data.entities };
      const transition = toNumber(data.transition) || undefined;
      if (action === "toggle") return { action: "light.toggle", target };
      if (action === "off") return clean({ action: "light.turn_off", target, data: transition ? { transition } : undefined });

      const payload: Record<string, unknown> = {};
      if (action === "step") {
        const step = toNumber(data.step);
        if (!step) return fail("Kies hoeveel procent feller of donkerder.");
        if (step < -100 || step > 100) return fail("De stap moet tussen −100 en +100 % liggen.");
        payload.brightness_step_pct = step;
      } else {
        const brightness = toNumber(data.brightness);
        if (action === "dim" && brightness === undefined) return fail("Kies een helderheid.");
        if (brightness !== undefined) {
          if (brightness < 1 || brightness > 100) return fail("De helderheid moet tussen 1 en 100 % liggen.");
          payload.brightness_pct = brightness;
        }
        const colorTemp = toNumber(data.color_temp);
        if (colorTemp) payload.color_temp_kelvin = colorTemp;
      }
      if (transition) payload.transition = transition;
      return clean({ action: "light.turn_on", target, data: Object.keys(payload).length ? payload : undefined });
    }
    case "webhook": {
      const request = webhookRequest(data);
      if ("error" in request) return fail(request.error);
      return { action: WEBHOOK_ACTION, data: request.data };
    }
    case "notify": {
      if (!data.message?.trim()) return fail("Vul een bericht in.");
      const payload = clean({ title: data.title?.trim() || undefined, message: data.message });
      const target = data.target ?? "persistent";
      if (target === "persistent") return { action: "persistent_notification.create", data: payload };
      if (target.startsWith("service:notify.")) return { action: target.slice("service:".length), data: payload };
      if (target.startsWith("entity:notify.")) {
        return { action: "notify.send_message", target: { entity_id: target.slice("entity:".length) }, data: payload };
      }
      return fail("Kies waar de melding heen moet.");
    }
  }
}

export const WEBHOOK_ACTION = "ha_flow_builder.call_webhook";
/** Athom's webhook relay: https://webhooks.athom.com/webhook/<webhook id>?homey=<homey id>&event=<event>[&tag=…] */
export const HOMEY_WEBHOOK_BASE = "https://webhooks.athom.com/webhook";

/** Templates ({{ … }}) are rendered by HA at run time, so they must not be URL-encoded or JSON-validated. */
const hasTemplate = (value: string) => value.includes("{{") || value.includes("{%");
const encodePart = (value: string) => (hasTemplate(value) ? value : encodeURIComponent(value));

/** Service data for ha_flow_builder.call_webhook, or a (Dutch) validation error. */
export function webhookRequest(data: WebhookData): { data: Record<string, unknown> } | { error: string } {
  if ((data.mode ?? "homey") === "homey") {
    const webhookId = data.webhook_id?.trim();
    const homeyId = data.homey_id?.trim();
    const event = data.event?.trim();
    if (!webhookId) return { error: "Vul het webhook-ID in (het deel na /webhook/ in de Homey-URL)." };
    if (!homeyId) return { error: "Vul je Homey-ID in." };
    if (!event) return { error: "Vul de eventnaam in die je in Homey gebruikt." };
    const tag = data.tag?.trim();
    const url = `${HOMEY_WEBHOOK_BASE}/${encodePart(webhookId)}?homey=${encodePart(homeyId)}&event=${encodePart(event)}` +
      (tag ? `&tag=${encodePart(tag)}` : "");
    return { data: { url, method: "GET" } };
  }

  const url = data.url?.trim();
  if (!url || (!/^https?:\/\/\S+$/.test(url) && !hasTemplate(url))) {
    return { error: "Vul een URL in die begint met http:// of https://." };
  }
  const method = data.method ?? "POST";
  const headers = Object.fromEntries(
    (data.headers ?? []).filter(header => header.name.trim()).map(header => [header.name.trim(), header.value]),
  );
  const body = method === "GET" || method === "DELETE" ? "" : data.body?.trim() ?? "";
  if (body && (data.body_type ?? "json") === "json") {
    if (!hasTemplate(body)) {
      try {
        JSON.parse(body);
      } catch {
        return { error: "De body is geen geldige JSON." };
      }
    }
    if (!Object.keys(headers).some(name => name.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }
  return {
    data: clean({
      url,
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      payload: body || undefined,
    }),
  };
}

function deviceCard(nodeId: string, data: DeviceNodeData, errors: CompileIssue[]): HaStep | null {
  if (!data.device_id) return (errors.push({ nodeId, message: "Kies een apparaat." }), null);
  if (!data.card) return (errors.push({ nodeId, message: "Kies wat het apparaat moet doen of melden." }), null);
  // `metadata` is informational only and not accepted by the automation schema.
  const { metadata: _metadata, ...card } = data.card;
  return clean({ ...card, ...(data.extra ?? {}) });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function duration(value: Duration | undefined): Duration | undefined {
  if (!value) return undefined;
  const result = clean({
    hours: toNumber(value.hours) || undefined,
    minutes: toNumber(value.minutes) || undefined,
    seconds: toNumber(value.seconds) || undefined,
  }) as Duration;
  return Object.keys(result).length ? result : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function fullTime(value: string): string {
  const [h, m, s = "00"] = value.split(":");
  return `${h.padStart(2, "0")}:${m}:${s}`;
}

function normalizeOffset(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sign = value.startsWith("-") ? "-" : "";
  const time = fullTime(value.replace(/^[+-]/, ""));
  return time === "00:00:00" ? undefined : `${sign}${time}`;
}

function clean<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function dedupe(issues: CompileIssue[]): CompileIssue[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.nodeId}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** JSON.stringify with sorted object keys, so equal configs always serialize equally. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Short, non-cryptographic hash (cyrb53). crypto.subtle is unavailable on plain-http HA installs. */
export function hashConfig(config: unknown): string {
  const text = stableStringify(config);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
