/** The card palette and the texts shown on canvas nodes. Titles and hints are Dutch keys for t(). */
import { deviceName, entityName, serviceName, type Hass } from "../api/ha";
import type { FlowNode, NodeType, Weekday } from "../compiler/types";
import type { Translate } from "../i18n";

export interface CatalogItem {
  key: string;
  type: NodeType;
  kind: string;
  icon: string;
  title: string;
  hint: string;
  defaults: Record<string, unknown>;
}

export const CATALOG: { title: string; type: NodeType; items: CatalogItem[] }[] = [
  {
    title: "Als… (triggers)",
    type: "trigger",
    items: [
      { key: "t-device", type: "trigger", kind: "device", icon: "📟", title: "Apparaat", hint: "Er gebeurt iets met een apparaat", defaults: {} },
      { key: "t-state", type: "trigger", kind: "state", icon: "🔀", title: "Entiteit verandert", hint: "Status van een entiteit, helper of weer", defaults: {} },
      { key: "t-time", type: "trigger", kind: "time", icon: "⏰", title: "Tijdstip", hint: "Elke dag (of op weekdagen) om…", defaults: { at: "07:00" } },
      { key: "t-pattern", type: "trigger", kind: "time_pattern", icon: "🔁", title: "Interval", hint: "Elke x minuten/uren", defaults: { minutes: "/15" } },
      { key: "t-sun", type: "trigger", kind: "sun", icon: "🌅", title: "Zon", hint: "Zonsopkomst of -ondergang (± verschuiving)", defaults: { event: "sunset" } },
      { key: "t-weather", type: "trigger", kind: "weather", icon: "🌦️", title: "Weer", hint: "Het gaat regenen, wordt warm, waait hard…", defaults: { measure: "condition" } },
      { key: "t-presence", type: "trigger", kind: "presence", icon: "🏠", title: "Aanwezigheid", hint: "Iemand komt thuis of vertrekt", defaults: { event: "arrive", zone: "zone.home" } },
    ],
  },
  {
    title: "En… (voorwaarden)",
    type: "condition",
    items: [
      { key: "c-device", type: "condition", kind: "device", icon: "📟", title: "Apparaat is…", hint: "Status van een apparaat", defaults: {} },
      { key: "c-state", type: "condition", kind: "state", icon: "🟰", title: "Entiteit is…", hint: "Entiteit heeft een bepaalde status", defaults: {} },
      { key: "c-numeric", type: "condition", kind: "numeric_state", icon: "📈", title: "Waarde boven/onder", hint: "Temperatuur, batterij, …", defaults: {} },
      { key: "c-time", type: "condition", kind: "time", icon: "🕘", title: "Tijd & dagen", hint: "Tussen twee tijden / op weekdagen", defaults: { after: "22:00", before: "07:00" } },
      { key: "c-sun", type: "condition", kind: "sun", icon: "🌇", title: "Zon", hint: "Na zonsondergang / voor zonsopkomst", defaults: { after: "sunset" } },
      { key: "c-weather", type: "condition", kind: "weather", icon: "🌦️", title: "Weer", hint: "Het regent, het is kouder dan…", defaults: { measure: "condition" } },
      { key: "c-presence", type: "condition", kind: "presence", icon: "🏠", title: "Aanwezigheid", hint: "Iemand thuis, niemand thuis, …", defaults: { check: "someone", zone: "zone.home" } },
    ],
  },
  {
    title: "Dan… (acties)",
    type: "action",
    items: [
      { key: "a-device", type: "action", kind: "device", icon: "📟", title: "Apparaat", hint: "Zet aan/uit, dim, …", defaults: {} },
      { key: "a-light", type: "action", kind: "light", icon: "💡", title: "Lamp", hint: "Aan/uit, dimmen, feller of donkerder", defaults: { action: "on" } },
      { key: "a-service", type: "action", kind: "service", icon: "⚙️", title: "Actie (service)", hint: "Elke Home Assistant-actie", defaults: {} },
      { key: "a-notify", type: "action", kind: "notify", icon: "🔔", title: "Melding sturen", hint: "Naar je telefoon of in Home Assistant", defaults: { target: "persistent" } },
      { key: "a-webhook", type: "action", kind: "webhook", icon: "🌐", title: "Webhook", hint: "Start een flow op Homey of roep een webservice aan", defaults: { mode: "homey" } },
      { key: "a-delay", type: "action", kind: "delay", icon: "⏳", title: "Wachten", hint: "Pauzeer de flow", defaults: { minutes: 1 } },
    ],
  },
];

export const catalogItem = (type: NodeType, kind: string) =>
  CATALOG.flatMap(group => group.items).find(item => item.type === type && item.kind === kind);

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "ma", tue: "di", wed: "wo", thu: "do", fri: "vr", sat: "za", sun: "zo",
};
const SUN_LABELS = { sunrise: "zonsopkomst", sunset: "zonsondergang" } as const;

/** HA weather states with Dutch labels (keys for t()). */
export const WEATHER_CONDITIONS: Record<string, string> = {
  sunny: "zonnig", "clear-night": "heldere nacht", partlycloudy: "half bewolkt", cloudy: "bewolkt",
  rainy: "regen", pouring: "stortregen", "lightning-rainy": "onweer met regen", lightning: "onweer",
  snowy: "sneeuw", "snowy-rainy": "natte sneeuw", hail: "hagel", fog: "mist", windy: "winderig",
  "windy-variant": "winderig en bewolkt", exceptional: "uitzonderlijk",
};

export const WEATHER_MEASURES = {
  condition: "Weertype", temperature: "Temperatuur", humidity: "Luchtvochtigheid", wind_speed: "Windsnelheid",
} as const;

export const joinNames = (names: string[], t: Translate) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${t("en")} ${names.at(-1)}`;

export const weekdayLabel = (day: Weekday, t: Translate) => t(WEEKDAY_LABELS[day]);

/** Text for a person being in a zone: "thuis" for zone.home, otherwise "in <zone>". */
const zonePhrase = (hass: Hass, zone: string | undefined, t: Translate) =>
  !zone || zone === "zone.home" ? t("thuis") : t("in {zone}", { zone: entityName(hass, zone) });
const isHome = (zone: string | undefined) => !zone || zone === "zone.home";

function offsetText(offset: string | undefined): string {
  if (!offset || /^[+-]?0{1,2}:00(:00)?$/.test(offset)) return "";
  const negative = offset.startsWith("-");
  return ` ${negative ? "−" : "+"} ${offset.replace(/^[+-]/, "")}`;
}

function durationText(value: { hours?: unknown; minutes?: unknown; seconds?: unknown } | undefined, t: Translate): string {
  if (!value) return "";
  return [
    value.hours ? `${value.hours} ${t("u")}` : "",
    value.minutes ? `${value.minutes} min` : "",
    value.seconds ? `${value.seconds} s` : "",
  ].filter(Boolean).join(" ");
}

function weatherText(hass: Hass, data: any, trigger: boolean, t: Translate): string {
  if (!data.entity_id) return t("Kies een weerbron…");
  const measure = (data.measure ?? "condition") as keyof typeof WEATHER_MEASURES;
  if (measure === "condition") {
    const states = (data.conditions ?? []).map((state: string) => t(WEATHER_CONDITIONS[state] ?? state));
    if (!states.length) return t("Kies een weertype…");
    return t(trigger ? "Het weer wordt {states}" : "Het weer is {states}", { states: states.join(` ${t("of")} `) });
  }
  const unit = hass.states[data.entity_id]?.attributes[measure === "wind_speed" ? "wind_speed_unit" : `${measure}_unit`] ??
    (measure === "humidity" ? "%" : "");
  const parts = [];
  if (data.above !== undefined && data.above !== "") parts.push(t("boven {value}", { value: `${data.above}${unit ? " " + unit : ""}` }));
  if (data.below !== undefined && data.below !== "") parts.push(t("onder {value}", { value: `${data.below}${unit ? " " + unit : ""}` }));
  return `${t(WEATHER_MEASURES[measure])} ${trigger ? t("komt") : t("is")} ${parts.join(` ${t("en")} `) || "…"}`;
}

/** Removes a leading device name from a HA card label: "Haldeur sensor geopend" → "sensor geopend". */
export function stripDeviceName(label: string, device: string): string {
  if (!device || !label.toLowerCase().startsWith(device.toLowerCase())) return label;
  const rest = label.slice(device.length).replace(/^[\s:–-]+/, "");
  return rest || label;
}

/** What a card is about (device, entity, lamps…) and what it does. Without subject the catalog title is shown. */
export interface NodeText {
  subject?: string;
  text: string;
}

/**
 * Texts for a canvas card. For device cards `deviceLabel` is the localized HA label
 * (loaded asynchronously, see useCardLabel).
 */
export function describeNode(hass: Hass, node: FlowNode, t: Translate, deviceLabel?: string): NodeText {
  const data = node.data as any;
  if (data.kind === "device") {
    const device = data.device_id ? hass.devices?.[data.device_id] : undefined;
    if (!device) return { text: t("Kies een apparaat…") };
    const name = deviceName(device);
    const label = deviceLabel ?? data.label;
    return { subject: name, text: label ? stripDeviceName(label, name) : t("Kies een kaart…") };
  }
  const entity = entityName(hass, data.entity_id);
  switch (`${node.type}:${data.kind}`) {
    case "trigger:state": {
      if (!entity) return { text: t("Kies een entiteit…") };
      const parts = [t("verandert")];
      if (data.from) parts.push(t("van \"{state}\"", { state: data.from }));
      if (data.to) parts.push(t("naar \"{state}\"", { state: data.to }));
      const forText = durationText(data.for, t);
      if (forText) parts.push(t("({duration} lang)", { duration: forText }));
      return { subject: entity, text: parts.join(" ") };
    }
    case "trigger:time": {
      const days = data.weekdays?.length && data.weekdays.length < 7
        ? ` ${t("op {days}", { days: data.weekdays.map((d: Weekday) => weekdayLabel(d, t)).join(", ") })}`
        : "";
      return { text: data.at ? `${t("Om {time}", { time: data.at })}${days}` : t("Kies een tijd…") };
    }
    case "trigger:time_pattern": {
      const every = [data.hours && `${data.hours} ${t("u")}`, data.minutes && `${data.minutes} min`, data.seconds && `${data.seconds} s`]
        .filter(Boolean).join(" ").replaceAll("/", "");
      return { text: t("Elke {interval}", { interval: every || "…" }) };
    }
    case "trigger:sun":
      return {
        text: data.event
          ? t("Bij {event}", { event: t(SUN_LABELS[data.event as "sunset"]) }) + offsetText(data.offset)
          : t("Kies een zonsgebeurtenis…"),
      };
    case "trigger:weather":
      return { text: weatherText(hass, data, true, t) };
    case "condition:weather":
      return { text: weatherText(hass, data, false, t) };
    case "trigger:presence": {
      const names = (data.persons ?? []).map((id: string) => entityName(hass, id));
      const who = joinNames(names, t);
      const many = names.length > 1;
      const zone = entityName(hass, data.zone);
      switch (data.event) {
        case "arrive":
          if (!names.length) return { text: t("Kies wie…") };
          return { text: isHome(data.zone) ? t(many ? "{who} komen thuis" : "{who} komt thuis", { who })
            : t(many ? "{who} komen aan in {zone}" : "{who} komt aan in {zone}", { who, zone }) };
        case "leave":
          if (!names.length) return { text: t("Kies wie…") };
          return { text: isHome(data.zone) ? t(many ? "{who} vertrekken van huis" : "{who} vertrekt van huis", { who })
            : t(many ? "{who} vertrekken uit {zone}" : "{who} vertrekt uit {zone}", { who, zone }) };
        case "first_arrive":
          return { text: isHome(data.zone) ? t("Eerste persoon komt thuis") : t("Eerste persoon komt aan in {zone}", { zone }) };
        case "last_leave":
          return { text: isHome(data.zone) ? t("Laatste persoon vertrekt van huis") : t("Laatste persoon vertrekt uit {zone}", { zone }) };
      }
      return { text: t("Kies wat er gebeurt…") };
    }
    case "condition:presence": {
      const where = zonePhrase(hass, data.zone, t);
      const names = (data.persons ?? []).map((id: string) => entityName(hass, id));
      const who = joinNames(names, t);
      const many = names.length > 1;
      switch (data.check) {
        case "someone": return { text: t("Er is iemand {where}", { where }) };
        case "nobody": return { text: t("Er is niemand {where}", { where }) };
        case "persons_in":
          return { text: names.length ? t(many ? "{who} zijn {where}" : "{who} is {where}", { who, where }) : t("Kies wie…") };
        case "persons_not_in":
          return { text: names.length ? t(many ? "{who} zijn niet {where}" : "{who} is niet {where}", { who, where }) : t("Kies wie…") };
      }
      return { text: t("Kies wat er moet gelden…") };
    }
    case "action:light": {
      const names = (data.entities ?? []).map((id: string) => entityName(hass, id));
      if (!names.length) return { text: t("Kies een lamp…") };
      const subject = joinNames(names, t);
      const over = data.transition ? ` ${t("(in {seconds} s)", { seconds: data.transition })}` : "";
      switch (data.action ?? "on") {
        case "off": return { subject, text: t("uit") + over };
        case "toggle": return { subject, text: t("schakelen") };
        case "step": {
          const step = Number(data.step ?? 0);
          if (!step) return { subject, text: t("Kies een stap…") };
          return { subject, text: t(step > 0 ? "{percent} % feller" : "{percent} % donkerder", { percent: Math.abs(step) }) + over };
        }
        case "dim":
          return { subject, text: data.brightness ? t("naar {percent} %", { percent: data.brightness }) + over : t("Kies een helderheid…") };
        default:
          return { subject, text: (data.brightness ? t("aan op {percent} %", { percent: data.brightness }) : t("aan")) + over };
      }
    }
    case "action:webhook": {
      if ((data.mode ?? "homey") === "homey") {
        if (!data.event) return { text: t("Kies een Homey-event…") };
        return {
          subject: "Homey",
          text: data.tag ? t("start \"{event}\" met tag \"{tag}\"", { event: data.event, tag: data.tag }) : t("start \"{event}\"", { event: data.event }),
        };
      }
      if (!data.url) return { text: t("Vul een URL in…") };
      const host = data.url.replace(/^https?:\/\//, "").split(/[/?]/)[0];
      return { subject: host, text: data.method ?? "POST" };
    }
    case "action:notify": {
      if (!data.message) return { text: t("Schrijf een bericht…") };
      const text = data.title ? `${data.title}: ${data.message}` : data.message;
      return { text: `“${text.length > 60 ? text.slice(0, 57) + "…" : text}”` };
    }
    case "condition:state":
      return entity ? { subject: entity, text: t("is \"{state}\"", { state: data.state ?? "…" }) } : { text: t("Kies een entiteit…") };
    case "condition:numeric_state": {
      if (!entity) return { text: t("Kies een entiteit…") };
      const parts = [];
      if (data.above !== undefined && data.above !== "") parts.push(t("boven {value}", { value: data.above }));
      if (data.below !== undefined && data.below !== "") parts.push(t("onder {value}", { value: data.below }));
      return { subject: entity, text: parts.join(` ${t("en")} `) || "…" };
    }
    case "condition:time": {
      const parts = [];
      if (data.after) parts.push(t("na {time}", { time: data.after }));
      if (data.before) parts.push(t("voor {time}", { time: data.before }));
      if (data.weekdays?.length && data.weekdays.length < 7) {
        parts.push(t("op {days}", { days: data.weekdays.map((d: Weekday) => weekdayLabel(d, t)).join(", ") }));
      }
      return { text: parts.length ? t("Tijd {range}", { range: parts.join(` ${t("en")} `) }) : t("Kies een tijdvak…") };
    }
    case "condition:sun": {
      const parts = [];
      if (data.after) parts.push(t("na {event}", { event: t(SUN_LABELS[data.after as "sunset"]) }) + offsetText(data.after_offset));
      if (data.before) parts.push(t("voor {event}", { event: t(SUN_LABELS[data.before as "sunset"]) }) + offsetText(data.before_offset));
      return { text: parts.length ? t("Het is {range}", { range: parts.join(` ${t("en")} `) }) : t("Kies na/voor…") };
    }
    case "action:service": {
      if (!data.service) return { text: t("Kies een actie…") };
      const [domain, service] = data.service.split(".");
      const label = serviceName(hass, domain, service);
      const target = data.target?.entity_id;
      const targets = (Array.isArray(target) ? target : target ? [target] : []).map((id: string) => entityName(hass, id));
      return targets.length ? { subject: joinNames(targets, t), text: label } : { text: label };
    }
    case "action:delay":
      return { text: t("Wacht {duration}", { duration: durationText(data, t) || "…" }) };
  }
  return { text: data.kind };
}

/** One-line version, e.g. for the flow overview. */
export const describeNodeLine = (hass: Hass, node: FlowNode, t: Translate, deviceLabel?: string) => {
  const { subject, text } = describeNode(hass, node, t, deviceLabel);
  return subject ? `${subject}: ${text}` : text;
};
