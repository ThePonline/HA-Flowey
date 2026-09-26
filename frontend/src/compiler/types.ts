/** Data model shared by the canvas, the compiler and the backend store. */

export type NodeType = "trigger" | "condition" | "action";
export type FlowMode = "single" | "restart" | "queued" | "parallel";

/** Source handles: triggers/actions have `out`, conditions have `yes` and `no`. */
export type SourceHandle = "out" | "yes" | "no";

/** A device automation card exactly as returned by device_automation/<type>/list. */
export type DeviceCard = Record<string, unknown> & {
  device_id: string;
  domain: string;
  type: string;
  subtype?: string;
  entity_id?: string;
};

export interface DeviceNodeData {
  kind: "device";
  device_id?: string;
  card?: DeviceCard;
  /** Values for the card's capabilities.extra_fields (e.g. `for`, `above`). */
  extra?: Record<string, unknown>;
  /** Localized card label, cached when the card is picked (display only). */
  label?: string;
}

export interface Duration {
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/** Weather: either the weather condition (rainy, sunny, …) or a numeric attribute. */
export type WeatherMeasure = "condition" | "temperature" | "humidity" | "wind_speed";

export interface WeatherData {
  kind: "weather";
  entity_id?: string;
  measure?: WeatherMeasure;
  /** Weather states such as "rainy"; used when measure is "condition". */
  conditions?: string[];
  above?: number | string;
  below?: number | string;
}

/** Who is where. zone_state is the person state that means "in this zone" ("home" or the zone name). */
interface ZoneRef {
  zone?: string;
  zone_state?: string;
}

export type PresenceEvent = "arrive" | "leave" | "first_arrive" | "last_leave";
export type PresenceCheck = "someone" | "nobody" | "persons_in" | "persons_not_in";

export type TriggerData =
  | DeviceNodeData
  | WeatherData
  | ({ kind: "presence"; event?: PresenceEvent; persons?: string[] } & ZoneRef)
  | WebhookTriggerData
  | { kind: "state"; entity_id?: string; from?: string; to?: string; for?: Duration }
  | { kind: "time"; at?: string; weekdays?: Weekday[] }
  | { kind: "time_pattern"; hours?: string; minutes?: string; seconds?: string }
  | { kind: "sun"; event?: "sunrise" | "sunset"; offset?: string };

export type ConditionData =
  | DeviceNodeData
  | WeatherData
  | ({ kind: "presence"; check?: PresenceCheck; persons?: string[] } & ZoneRef)
  | { kind: "state"; entity_id?: string; state?: string }
  | { kind: "numeric_state"; entity_id?: string; above?: number | string; below?: number | string }
  | { kind: "time"; after?: string; before?: string; weekdays?: Weekday[] }
  | {
      kind: "sun";
      after?: "sunrise" | "sunset";
      after_offset?: string;
      before?: "sunrise" | "sunset";
      before_offset?: string;
    };

export type ActionData =
  | DeviceNodeData
  | {
      kind: "service";
      service?: string;
      target?: { entity_id?: string | string[]; device_id?: string | string[]; area_id?: string | string[] };
      data?: Record<string, unknown>;
    }
  | ({ kind: "delay" } & Duration)
  | WebhookData
  | LightData
  | WaitData
  | {
      kind: "notify";
      /** "persistent" (HA notification), "service:notify.x" (legacy) or "entity:notify.y" (notify entity). */
      target?: string;
      title?: string;
      message?: string;
    };

/** on/off/toggle; dim = to a fixed %; step = brighter/darker by a relative %. */
export type LightAction = "on" | "off" | "toggle" | "dim" | "step";

export interface LightData {
  kind: "light";
  entities?: string[];
  action?: LightAction;
  /** 1–100 %, for "on" (optional) and "dim". */
  brightness?: number;
  /** −100…+100 %, for "step". */
  step?: number;
  /** Seconds. */
  transition?: number;
  /** Kelvin, for "on" and "dim". */
  color_temp?: number;
}

/** Incoming webhook (e.g. from Homey). The id works like a password: keep it hard to guess. */
export interface WebhookTriggerData {
  kind: "webhook";
  webhook_id?: string;
  methods?: WebhookMethod[];
  /** Only accept calls from the local network (HA default). */
  local_only?: boolean;
}

export type WebhookMethod = "POST" | "PUT" | "GET" | "HEAD";

/** Wait until a trigger fires, optionally with a maximum time. Outputs: "done" and "timeout". */
export interface WaitData {
  kind: "wait";
  trigger?: TriggerData;
  timeout?: Duration;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** HTTP request, e.g. to trigger a flow on Homey. Compiles to ha_flow_builder.call_webhook. */
export interface WebhookData {
  kind: "webhook";
  /** "homey": URL built from Homey ID + event; "custom": any URL. */
  mode?: "homey" | "custom";
  /** Path segment after /webhook/ in the Homey webhook URL. */
  webhook_id?: string;
  homey_id?: string;
  event?: string;
  /** Optional value passed to the Homey flow as the webhook tag. */
  tag?: string;
  url?: string;
  method?: HttpMethod;
  headers?: { name: string; value: string }[];
  body?: string;
  body_type?: "json" | "text";
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type FlowNode =
  | { id: string; type: "trigger"; position: XY; data: TriggerData }
  | { id: string; type: "condition"; position: XY; data: ConditionData }
  | { id: string; type: "action"; position: XY; data: ActionData };

export interface XY {
  x: number;
  y: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** A flow as persisted by the backend (ha_flow_builder/flows/*). */
export interface FlowRecord {
  id: string;
  name: string;
  enabled: boolean;
  mode: FlowMode;
  graph: FlowGraph;
  /** Hash of the automation config last written by this app; null = never published. */
  config_hash: string | null;
  created?: string;
  updated?: string;
}

export type HaStep = Record<string, unknown>;

export interface AutomationConfig {
  id: string;
  alias: string;
  description: string;
  mode: FlowMode;
  triggers: HaStep[];
  conditions: HaStep[];
  actions: HaStep[];
}

export interface CompileIssue {
  nodeId?: string;
  message: string;
}

export interface CompileResult {
  config: AutomationConfig;
  errors: CompileIssue[];
  warnings: CompileIssue[];
}
