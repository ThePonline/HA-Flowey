/** Right-hand panel that edits the selected card. */
import { useEffect, useMemo, useState } from "react";
import { parse, stringify } from "yaml";
import { callWebhookNow, createTimer, entityName, entityOptions, errorMessage, serviceName, type Hass } from "../api/ha";
import { WEBHOOK_ACTION, webhookRequest } from "../compiler/compile";
import type { CompileIssue, FlowNode, HttpMethod, LightAction, WebhookData, WebhookMethod } from "../compiler/types";
import { useHass } from "../context";
import { useT, type Translate } from "../i18n";
import { catalogDefaults, catalogItem, newWebhookId, WEATHER_CONDITIONS, WEATHER_MEASURES } from "../nodes/catalog";
import { DeviceCardForm } from "./DeviceCardForm";
import { DurationInput, Field, OffsetInput, SearchSelect, WeekdayPicker, type SearchOption } from "./fields";

type Data = Record<string, any>;

export function Inspector({
  node,
  issues,
  onChange,
  onDelete,
  onClose,
  onAddNext,
}: {
  node: FlowNode;
  issues: CompileIssue[];
  onChange: (data: Data) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Narrow screens: open the palette to add a card connected to this one. */
  onAddNext?: () => void;
}) {
  const item = catalogItem(node.type, node.data.kind);
  const t = useT();
  const data = node.data as Data;
  const set = (patch: Data) => onChange({ ...data, ...patch });

  return (
    <aside className={`inspector type-${node.type}`}>
      <header className="inspector-head">
        <span className="inspector-icon">{item?.icon}</span>
        <div className="inspector-title">
          <div className="eyebrow">{t({ trigger: "Als…", condition: "En…", action: "Dan…" }[node.type])}</div>
          <div>{item ? t(item.title) : data.kind}</div>
        </div>
        <button type="button" className="icon-btn" title={t("Sluiten")} onClick={onClose}>✕</button>
      </header>
      <div className="inspector-body">
        {issues.map(issue => <div key={issue.message} className="issue">⚠ {t(issue.message)}</div>)}
        {data.kind === "device" ? (
          <DeviceCardForm cardType={node.type} data={data as any} onChange={next => onChange({ ...next })} />
        ) : (
          <KindForm type={node.type} data={data} set={set} />
        )}
      </div>
      <footer className="inspector-foot">
        {onAddNext && <button type="button" className="btn" onClick={onAddNext}>＋ {t("Volgende kaart")}</button>}
        <button type="button" className="btn danger-outline" onClick={onDelete}>{t("Kaart verwijderen")}</button>
      </footer>
    </aside>
  );
}

function KindForm({ type, data, set }: { type: FlowNode["type"]; data: Data; set: (patch: Data) => void }) {
  const t = useT();
  switch (`${type}:${data.kind}`) {
    case "trigger:state":
      return (
        <>
          <EntityField value={data.entity_id} onChange={entity_id => set({ entity_id })} />
          <StateField label="Van (optioneel)" entityId={data.entity_id} value={data.from} onChange={from => set({ from })} />
          <StateField label="Naar (optioneel)" entityId={data.entity_id} value={data.to} onChange={to => set({ to })} />
          <Field label="Minstens zo lang (optioneel)">
            <DurationInput value={data.for} onChange={value => set({ for: value })} />
          </Field>
        </>
      );
    case "trigger:time":
      return (
        <>
          <Field label="Tijd">
            <input className="input" type="time" value={data.at ?? ""} onChange={event => set({ at: event.target.value })} />
          </Field>
          <Field label="Op deze dagen"><WeekdayPicker value={data.weekdays} onChange={weekdays => set({ weekdays })} /></Field>
        </>
      );
    case "trigger:time_pattern":
      return (
        <>
          <p className="muted">{t("Gebruik /15 voor \"elke 15\", of een vast getal voor \"op minuut 15\".")}</p>
          {(["hours", "minutes", "seconds"] as const).map(key => (
            <Field key={key} label={{ hours: "Uren", minutes: "Minuten", seconds: "Seconden" }[key]}>
              <input className="input" value={data[key] ?? ""} placeholder="/5" onChange={event => set({ [key]: event.target.value })} />
            </Field>
          ))}
        </>
      );
    case "trigger:sun":
      return (
        <>
          <Field label="Moment">
            <select className="input" value={data.event ?? ""} onChange={event => set({ event: event.target.value })}>
              <option value="sunrise">{t("Zonsopkomst")}</option>
              <option value="sunset">{t("Zonsondergang")}</option>
            </select>
          </Field>
          <Field label="Verschuiving"><OffsetInput value={data.offset} onChange={offset => set({ offset })} /></Field>
        </>
      );
    case "condition:state":
      return (
        <>
          <EntityField value={data.entity_id} onChange={entity_id => set({ entity_id })} />
          <StateField label="Heeft status" entityId={data.entity_id} value={data.state} onChange={state => set({ state })} />
        </>
      );
    case "condition:numeric_state":
      return (
        <>
          <EntityField value={data.entity_id} onChange={entity_id => set({ entity_id })} />
          <Field label="Boven (optioneel)">
            <input className="input" type="number" step="any" value={data.above ?? ""} onChange={event => set({ above: event.target.value })} />
          </Field>
          <Field label="Onder (optioneel)">
            <input className="input" type="number" step="any" value={data.below ?? ""} onChange={event => set({ below: event.target.value })} />
          </Field>
        </>
      );
    case "condition:time":
      return (
        <>
          <Field label="Na (optioneel)">
            <input className="input" type="time" value={data.after ?? ""} onChange={event => set({ after: event.target.value || undefined })} />
          </Field>
          <Field label="Voor (optioneel)" hint="Een tijdvak over middernacht (bijv. 22:00–07:00) mag.">
            <input className="input" type="time" value={data.before ?? ""} onChange={event => set({ before: event.target.value || undefined })} />
          </Field>
          <Field label="Op deze dagen"><WeekdayPicker value={data.weekdays} onChange={weekdays => set({ weekdays })} /></Field>
        </>
      );
    case "condition:sun":
      return (
        <>
          <SunBound label="Na" event={data.after} offset={data.after_offset}
            onChange={(after, after_offset) => set({ after, after_offset })} />
          <SunBound label="Voor" event={data.before} offset={data.before_offset}
            onChange={(before, before_offset) => set({ before, before_offset })} />
          <p className="muted">{t("Tip: \"na zonsondergang\" en \"voor zonsopkomst\" samen betekent: het is donker.")}</p>
        </>
      );
    case "trigger:weather":
    case "condition:weather":
      return <WeatherForm type={type} data={data} set={set} />;
    case "trigger:presence":
    case "condition:presence":
      return <PresenceForm type={type} data={data} set={set} />;
    case "trigger:timer_finished":
      return <TimerPicker value={data.entity_id} onChange={entity_id => set({ entity_id })} />;
    case "condition:timer":
      return (
        <>
          <TimerPicker value={data.entity_id} onChange={entity_id => set({ entity_id })} />
          <Field label="Voorwaarde">
            <select className="input" value={data.check ?? "running"} onChange={event => set({ check: event.target.value })}>
              <option value="running">{t("De timer loopt")}</option>
              <option value="not_running">{t("De timer loopt niet")}</option>
            </select>
          </Field>
        </>
      );
    case "action:timer":
      return <TimerActionForm data={data} set={set} />;
    case "action:repeat":
      return <RepeatForm data={data} set={set} />;
    case "trigger:webhook":
      return <WebhookTriggerForm data={data} set={set} />;
    case "action:wait":
      return <WaitForm data={data} set={set} />;
    case "action:light":
      return <LightForm data={data} set={set} />;
    case "action:webhook":
      return <WebhookForm data={data} set={set} />;
    case "action:notify":
      return <NotifyForm data={data} set={set} />;
    case "action:service":
      return <ServiceForm data={data} set={set} />;
    case "action:delay":
      return <Field label="Wacht"><DurationInput value={data} onChange={value => set(value)} /></Field>;
  }
  return <p className="muted">{t("Onbekend kaarttype \"{kind}\".", { kind: data.kind })}</p>;
}

function SunBound({ label, event, offset, onChange }: {
  label: string;
  event: string | undefined;
  offset: string | undefined;
  onChange: (event: string | undefined, offset: string | undefined) => void;
}) {
  const t = useT();
  return (
    <Field label={label}>
      <select className="input" value={event ?? ""} onChange={e => onChange(e.target.value || undefined, offset)}>
        <option value="">—</option>
        <option value="sunrise">{t("Zonsopkomst")}</option>
        <option value="sunset">{t("Zonsondergang")}</option>
      </select>
      {event && <OffsetInput value={offset} onChange={value => onChange(event, value)} />}
    </Field>
  );
}

function useEntityOptions(domains?: string[]): SearchOption[] {
  const hass = useHass();
  const t = useT();
  const key = domains?.join(",");
  return useMemo(
    () => entityOptions(hass, domains, t).map(entity => ({
      value: entity.entity_id, label: entity.name, group: entity.group, secondary: entity.entity_id,
    })),
    // Recompute when entities are added/removed, not on every state change.
    [Object.keys(hass.states).length, hass.entities, key, t],
  );
}

function EntityField({ value, onChange, domains }: { value?: string; onChange: (value: string) => void; domains?: string[] }) {
  const options = useEntityOptions(domains);
  return (
    <Field label="Entiteit">
      <SearchSelect value={value} options={options} placeholder="Zoek op apparaat of naam…" onChange={onChange} />
    </Field>
  );
}

/** Suggests known states (current value, select options, on/off) but allows free text. */
function StateField({ label, entityId, value, onChange }: {
  label: string;
  entityId?: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const hass = useHass();
  const suggestions = stateSuggestions(hass, entityId);
  const listId = `states-${label.replace(/\W/g, "")}`;
  return (
    <Field label={label}>
      <input className="input" list={listId} value={value ?? ""} placeholder={suggestions[0]}
        onChange={event => onChange(event.target.value || undefined)} />
      <datalist id={listId}>{suggestions.map(state => <option key={state} value={state} />)}</datalist>
    </Field>
  );
}

function stateSuggestions(hass: Hass, entityId?: string): string[] {
  if (!entityId) return [];
  const state = hass.states[entityId];
  const domain = entityId.split(".")[0];
  const known: Record<string, string[]> = {
    binary_sensor: ["on", "off"], switch: ["on", "off"], light: ["on", "off"], input_boolean: ["on", "off"],
    fan: ["on", "off"], person: ["home", "not_home"], device_tracker: ["home", "not_home"],
    cover: ["open", "closed", "opening", "closing"], lock: ["locked", "unlocked"],
    media_player: ["playing", "paused", "idle", "off"], sun: ["above_horizon", "below_horizon"],
    alarm_control_panel: ["disarmed", "armed_home", "armed_away", "triggered"],
    weather: ["sunny", "clear-night", "cloudy", "partlycloudy", "rainy", "pouring", "snowy", "fog", "windy", "lightning"],
  };
  return [...new Set([
    ...(state?.attributes.options ?? []),
    ...(known[domain] ?? []),
    ...(state ? [state.state] : []),
  ])].map(String);
}

/** Multi-select of entities shown as removable chips. */
function EntityChips({ label, value, options, placeholder, onChange }: {
  label: string;
  value: string[];
  options: SearchOption[];
  placeholder: string;
  onChange: (value: string[]) => void;
}) {
  const t = useT();
  return (
    <Field label={label}>
      <div className="chips">
        {value.map(id => (
          <span key={id} className="chip on">
            {options.find(option => option.value === id)?.label ?? id}
            <button type="button" className="chip-x" title={t("Verwijderen")}
              onClick={() => onChange(value.filter(v => v !== id))}>×</button>
          </span>
        ))}
      </div>
      <SearchSelect value="" options={options.filter(option => !value.includes(option.value))}
        placeholder={placeholder} onChange={id => onChange([...value, id])} />
    </Field>
  );
}

function WeatherForm({ type, data, set }: { type: FlowNode["type"]; data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const sources = useEntityOptions(["weather"]);
  // Most homes have one weather source: pick it so the card works right away.
  useEffect(() => {
    if (!data.entity_id && sources.length) set({ entity_id: sources[0].value });
  }, [data.entity_id, sources.length]);
  const measure = data.measure ?? "condition";
  const selected: string[] = data.conditions ?? [];
  const attributes = data.entity_id ? hass.states[data.entity_id]?.attributes ?? {} : {};
  const unit = measure === "humidity" ? "%" : attributes[measure === "wind_speed" ? "wind_speed_unit" : `${measure}_unit`];
  const current = measure === "condition" ? undefined : attributes[measure];

  return (
    <>
      <Field label="Weerbron">
        <SearchSelect value={data.entity_id} options={sources} placeholder="Kies een weer-entiteit…"
          onChange={entity_id => set({ entity_id })} />
      </Field>
      {sources.length === 0 && <div className="issue">{t("Geen weer-entiteit gevonden. Voeg bijvoorbeeld de integratie Met.no toe.")}</div>}
      <Field label={type === "trigger" ? "Start als…" : "Geldt als…"}>
        <select className="input" value={measure} onChange={event => set({ measure: event.target.value })}>
          {Object.entries(WEATHER_MEASURES).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </Field>
      {measure === "condition" ? (
        <Field label={type === "trigger" ? "Het weer wordt" : "Het weer is"} hint="Meerdere keuzes betekent: een van deze.">
          <div className="chips">
            {Object.entries(WEATHER_CONDITIONS).map(([state, label]) => (
              <button type="button" key={state} className={`chip ${selected.includes(state) ? "on" : ""}`}
                onClick={() => set({ conditions: selected.includes(state) ? selected.filter(s => s !== state) : [...selected, state] })}>
                {t(label)}
              </button>
            ))}
          </div>
        </Field>
      ) : (
        <>
          <Field label={t("Boven") + (unit ? ` (${unit})` : "")} hint={current !== undefined ? t("Nu: {value}", { value: `${current}${unit ? " " + unit : ""}` }) : undefined}>
            <input className="input" type="number" step="any" value={data.above ?? ""} onChange={event => set({ above: event.target.value })} />
          </Field>
          <Field label={t("Onder") + (unit ? ` (${unit})` : "")}>
            <input className="input" type="number" step="any" value={data.below ?? ""} onChange={event => set({ below: event.target.value })} />
          </Field>
        </>
      )}
    </>
  );
}

const PRESENCE_EVENTS = {
  arrive: "Iemand komt aan",
  leave: "Iemand vertrekt",
  first_arrive: "De eerste persoon komt aan",
  last_leave: "De laatste persoon vertrekt",
};
const PRESENCE_CHECKS = {
  someone: "Er is iemand",
  nobody: "Er is niemand",
  persons_in: "Deze personen zijn er",
  persons_not_in: "Deze personen zijn er niet",
};

function PresenceForm({ type, data, set }: { type: FlowNode["type"]; data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const persons = useEntityOptions(["person"]);
  const zones = useEntityOptions(["zone"]);
  const choice = type === "trigger" ? data.event : data.check;
  const choices = type === "trigger" ? PRESENCE_EVENTS : PRESENCE_CHECKS;
  const needsPersons = ["arrive", "leave", "persons_in", "persons_not_in"].includes(choice);

  return (
    <>
      <Field label={type === "trigger" ? "Wanneer" : "Voorwaarde"}>
        <select className="input" value={choice ?? ""}
          onChange={event => set({ [type === "trigger" ? "event" : "check"]: event.target.value })}>
          {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </Field>
      {needsPersons && (
        <EntityChips label="Wie" value={data.persons ?? []} options={persons} placeholder="+ persoon toevoegen…"
          onChange={value => set({ persons: value })} />
      )}
      {needsPersons && type === "trigger" && (data.persons?.length ?? 0) > 1 && (
        <p className="muted">{t("De flow start voor elke persoon die aankomt of vertrekt.")}</p>
      )}
      <Field label="Waar" hint="Zones beheer je in Home Assistant onder Instellingen → Gebieden & zones.">
        <SearchSelect value={data.zone ?? "zone.home"} options={zones} placeholder="Kies een zone…"
          onChange={zone => set({ zone, zone_state: zone === "zone.home" ? "home" : hass.states[zone]?.attributes.friendly_name })} />
      </Field>
    </>
  );
}

function NotifyForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const services = Object.keys(hass.services?.notify ?? {})
    .filter(service => !["send_message", "persistent_notification"].includes(service));
  const entities = Object.keys(hass.states).filter(id => id.startsWith("notify."));

  return (
    <>
      <Field label="Naar">
        <select className="input" value={data.target ?? "persistent"} onChange={event => set({ target: event.target.value })}>
          <option value="persistent">{t("Melding in Home Assistant")}</option>
          {services.length > 0 && (
            <optgroup label={t("Telefoons en diensten")}>
              {services.map(service => (
                <option key={service} value={`service:notify.${service}`}>{serviceName(hass, "notify", service)}</option>
              ))}
            </optgroup>
          )}
          {entities.length > 0 && (
            <optgroup label={t("Meldingsentiteiten")}>
              {entities.map(id => <option key={id} value={`entity:${id}`}>{entityName(hass, id)}</option>)}
            </optgroup>
          )}
        </select>
      </Field>
      <Field label="Titel (optioneel)">
        <input className="input" value={data.title ?? ""} onChange={event => set({ title: event.target.value })} />
      </Field>
      <Field label="Bericht" hint="Templates mogen, bijv. {{ states('sensor.temperatuur') }} °C.">
        <textarea className="input" rows={3} value={data.message ?? ""} placeholder={t("De voordeur staat open")}
          onChange={event => set({ message: event.target.value })} />
      </Field>
    </>
  );
}

/**
 * Reads the parts of a webhook URL copied from Homey:
 * https://webhooks.athom.com/webhook/<webhook id>?homey=<homey id>&event=<event>[&tag=…]
 */
function parseHomeyUrl(value: string): { webhook_id: string; homey_id: string; event: string; tag?: string } | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const homeyId = url.searchParams.get("homey");
  if (url.hostname !== "webhooks.athom.com" || path[0] !== "webhook" || !path[1] || !homeyId) return null;
  return {
    webhook_id: path[1],
    homey_id: homeyId,
    event: url.searchParams.get("event") ?? "",
    tag: url.searchParams.get("tag") ?? undefined,
  };
}

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function WebhookForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const mode = data.mode ?? "homey";
  const method: HttpMethod = data.method ?? "POST";
  const headers: { name: string; value: string }[] = data.headers ?? [];
  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const request = webhookRequest(data as WebhookData);
  const send = async () => {
    if ("error" in request) return setResult({ ok: false, text: t(request.error) });
    setSending(true);
    setResult(null);
    try {
      const response = await callWebhookNow(hass, request.data);
      const body = response.body.trim();
      setResult({ ok: true, text: `HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}` });
    } catch (error) {
      setResult({ ok: false, text: errorMessage(error) });
    } finally {
      setSending(false);
    }
  };

  const setHeader = (index: number, patch: Partial<{ name: string; value: string }>) =>
    set({ headers: headers.map((header, i) => (i === index ? { ...header, ...patch } : header)) });

  return (
    <>
      <Field label="Soort">
        <select className="input" value={mode} onChange={event => set({ mode: event.target.value })}>
          <option value="homey">{t("Homey-flow starten")}</option>
          <option value="custom">{t("Andere webservice (URL)")}</option>
        </select>
      </Field>

      {mode === "homey" ? (
        <>
          <p className="muted">
            {t("Maak in Homey een flow die start met de webhook-kaart (zoek bij een nieuwe flow op \"webhook\") en gebruik daar dezelfde eventnaam. Plak de webhook-URL die Homey toont hieronder, of vul de velden zelf in.")}
          </p>
          <Field label="Webhook-URL uit Homey (plakken)">
            <input className="input" value={pasted} placeholder="https://webhooks.athom.com/webhook/…?homey=…&event=…"
              onChange={event => {
                setPasted(event.target.value);
                const parsed = parseHomeyUrl(event.target.value);
                if (parsed) {
                  set({ ...parsed, event: parsed.event || data.event, tag: parsed.tag ?? data.tag });
                }
              }} />
            {pasted && !parseHomeyUrl(pasted) && (
              <span className="issue">{t("Verwacht: {format}", { format: "https://webhooks.athom.com/webhook/…?homey=…&event=…" })}</span>
            )}
          </Field>
          <Field label="Webhook-ID" hint="Het deel na /webhook/ in de URL.">
            <input className="input" value={data.webhook_id ?? ""} onChange={event => set({ webhook_id: event.target.value })} />
          </Field>
          <Field label="Homey-ID" hint="De waarde achter homey= in de URL.">
            <input className="input" value={data.homey_id ?? ""} onChange={event => set({ homey_id: event.target.value })} />
          </Field>
          <Field label="Event">
            <input className="input" value={data.event ?? ""} placeholder={t("bijv. tuinlampen_aan")}
              onChange={event => set({ event: event.target.value })} />
          </Field>
          <Field label="Tag (optioneel)" hint="Waarde die je in de Homey-flow kunt gebruiken. Templates mogen, bijv. {{ states('sensor.temperatuur') }}.">
            <input className="input" value={data.tag ?? ""} onChange={event => set({ tag: event.target.value })} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Methode">
            <select className="input" value={method} onChange={event => set({ method: event.target.value })}>
              {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="URL">
            <input className="input" type="url" value={data.url ?? ""} placeholder="https://…"
              onChange={event => set({ url: event.target.value })} />
          </Field>
          <div className="field">
            <span className="field-label">{t("Headers (optioneel)")}</span>
            {headers.map((header, index) => (
              <div className="header-row" key={index}>
                <input className="input" value={header.name} placeholder={t("Naam")} onChange={event => setHeader(index, { name: event.target.value })} />
                <input className="input" value={header.value} placeholder={t("Waarde")} onChange={event => setHeader(index, { value: event.target.value })} />
                <button type="button" className="icon-btn" title={t("Verwijderen")}
                  onClick={() => set({ headers: headers.filter((_, i) => i !== index) })}>×</button>
              </div>
            ))}
            <button type="button" className="btn secondary small-btn"
              onClick={() => set({ headers: [...headers, { name: "", value: "" }] })}>＋ Header</button>
          </div>
          {method !== "GET" && method !== "DELETE" && (
            <Field label="Body (optioneel)">
              <select className="input" value={data.body_type ?? "json"} onChange={event => set({ body_type: event.target.value })}>
                <option value="json">JSON</option>
                <option value="text">{t("Tekst")}</option>
              </select>
              <textarea className="input code" rows={4} value={data.body ?? ""}
                placeholder={(data.body_type ?? "json") === "json" ? '{"scene": "avond"}' : ""}
                onChange={event => set({ body: event.target.value })} />
            </Field>
          )}
        </>
      )}

      <div className="field">
        <button type="button" className="btn secondary" onClick={send} disabled={sending}>
          {sending ? t("Versturen…") : t("Nu versturen (test)")}
        </button>
        {result && <span className={result.ok ? "success" : "issue"}>{result.ok ? "✔" : "✘"} {result.text}</span>}
        <span className="field-hint">{t("Bij een test worden templates niet ingevuld; in de flow wel.")}</span>
      </div>
    </>
  );
}

const LIGHT_ACTIONS: Record<LightAction, string> = {
  on: "Aan",
  dim: "Dimmen naar %",
  step: "Feller / donkerder maken",
  off: "Uit",
  toggle: "Schakelen (aan ↔ uit)",
};

/** HA reports only "onoff" as colour mode for lights it cannot dim. */
const isDimmable = (hass: Hass, entityId: string): boolean | undefined => {
  const modes = hass.states[entityId]?.attributes.supported_color_modes;
  return Array.isArray(modes) ? modes.some((mode: string) => mode !== "onoff") : undefined;
};

function LightForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const lamps = useEntityOptions(["light"]);
  const entities: string[] = data.entities ?? [];
  const action: LightAction = data.action ?? "on";
  const usesBrightness = action === "on" || action === "dim";
  const notDimmable = entities.filter(id => isDimmable(hass, id) === false);
  const kelvin = entities
    .map(id => hass.states[id]?.attributes)
    .filter(attributes => attributes?.min_color_temp_kelvin && attributes?.max_color_temp_kelvin);
  const minKelvin = kelvin.length ? Math.max(...kelvin.map(a => a!.min_color_temp_kelvin)) : 2000;
  const maxKelvin = kelvin.length ? Math.min(...kelvin.map(a => a!.max_color_temp_kelvin)) : 6500;
  const step = Number(data.step ?? 20);

  return (
    <>
      <EntityChips label="Lampen" value={entities} options={lamps} placeholder="+ lamp toevoegen…"
        onChange={value => set({ entities: value })} />
      <Field label="Wat moet er gebeuren?">
        <select className="input" value={action} onChange={event => set({ action: event.target.value })}>
          {Object.entries(LIGHT_ACTIONS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </Field>

      {usesBrightness && (
        <Field label={action === "dim" ? "Helderheid" : "Helderheid (optioneel)"}>
          <div className="slider-row">
            <input type="range" min={1} max={100} value={data.brightness ?? 100}
              onChange={event => set({ brightness: Number(event.target.value) })} />
            <input className="input" type="number" min={1} max={100} value={data.brightness ?? ""}
              placeholder={action === "dim" ? "%" : "—"}
              onChange={event => set({ brightness: event.target.value === "" ? undefined : Number(event.target.value) })} />
            <span>%</span>
          </div>
        </Field>
      )}

      {action === "step" && (
        <Field label={t(step < 0 ? "{percent} % donkerder" : "{percent} % feller", { percent: Math.abs(step) })}>
          <div className="slider-row">
            <input type="range" min={-100} max={100} step={5} value={step}
              onChange={event => set({ step: Number(event.target.value) })} />
            <input className="input" type="number" min={-100} max={100} value={data.step ?? 20}
              onChange={event => set({ step: Number(event.target.value) })} />
            <span>%</span>
          </div>
          <div className="chips">
            {[-50, -20, 20, 50].map(value => (
              <button type="button" key={value} className={`chip ${step === value ? "on" : ""}`} onClick={() => set({ step: value })}>
                {value > 0 ? `+${value}` : value} %
              </button>
            ))}
          </div>
        </Field>
      )}

      {usesBrightness && kelvin.length > 0 && (
        <Field label="Kleurtemperatuur (optioneel)" hint={t("{warm} K is warm, {cool} K is koel.", { warm: minKelvin, cool: maxKelvin })}>
          <div className="slider-row">
            <input type="range" min={minKelvin} max={maxKelvin} step={50} value={data.color_temp ?? minKelvin}
              onChange={event => set({ color_temp: Number(event.target.value) })} />
            <input className="input" type="number" min={minKelvin} max={maxKelvin} value={data.color_temp ?? ""} placeholder="—"
              onChange={event => set({ color_temp: event.target.value === "" ? undefined : Number(event.target.value) })} />
            <span>K</span>
          </div>
        </Field>
      )}

      {action !== "toggle" && (
        <Field label="Overgangstijd (optioneel)" hint="Hoe lang het dimmen of uitgaan duurt, voor een zachte overgang.">
          <div className="slider-row">
            <input className="input" type="number" min={0} step="0.5" value={data.transition ?? ""} placeholder="0"
              onChange={event => set({ transition: event.target.value === "" ? undefined : Number(event.target.value) })} />
            <span>sec</span>
          </div>
        </Field>
      )}

      {(usesBrightness || action === "step") && notDimmable.length > 0 && (
        <div className="issue">
          ⚠ {t("Home Assistant ziet {lamps} niet als dimbaar; de helderheid wordt daar genegeerd. Controleer in HA of dit een lamp met dimfunctie is.", { lamps: notDimmable.map(id => entityName(hass, id)).join(", ") })}
        </div>
      )}
    </>
  );
}

const WEBHOOK_METHODS: WebhookMethod[] = ["POST", "PUT", "GET", "HEAD"];

/** Copyable, read-only URL field. */
function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label}>
      <div className="copy-row">
        <input className="input code" readOnly value={value} onFocus={event => event.target.select()} />
        <button type="button" className="btn secondary small-btn" onClick={() => {
          navigator.clipboard?.writeText(value).then(() => setCopied(true), () => setCopied(false));
        }}>{copied ? t("Gekopieerd") : t("Kopiëren")}</button>
      </div>
    </Field>
  );
}

function WebhookTriggerForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const config = (hass as unknown as { config?: { internal_url?: string | null; external_url?: string | null } }).config ?? {};
  const path = `/api/webhook/${data.webhook_id ?? ""}`;
  const localBase = (config.internal_url || window.location.origin).replace(/\/$/, "");
  const externalBase = config.external_url?.replace(/\/$/, "");
  const localOnly = data.local_only ?? true;
  const methods: WebhookMethod[] = data.methods?.length ? data.methods : ["POST", "PUT"];

  const toggleMethod = (method: WebhookMethod) => {
    const next = methods.includes(method) ? methods.filter(m => m !== method) : [...methods, method];
    if (next.length) set({ methods: WEBHOOK_METHODS.filter(m => next.includes(m)) });
  };

  const test = async () => {
    const method = methods.includes("POST") ? "POST" : methods[0];
    const withBody = method === "POST" || method === "PUT";
    try {
      const response = await fetch(path, {
        method,
        headers: withBody ? { "Content-Type": "application/json" } : undefined,
        body: withBody ? JSON.stringify({ tag: "test" }) : undefined,
      });
      setResult({ ok: response.ok, text: t("Verstuurd (HTTP {status}). Kijk bij Traces of de flow is gestart.", { status: response.status }) });
    } catch (error) {
      setResult({ ok: false, text: errorMessage(error) });
    }
  };

  return (
    <>
      <p className="muted">
        {t("Gebruik in Homey een kaart die een webverzoek (HTTP) verstuurt, bijvoorbeeld uit de app \"HTTP request flow cards\", met het adres hieronder. Homey Pro in je eigen netwerk kan het lokale adres gebruiken.")}
      </p>
      <CopyField label="Adres in je eigen netwerk" value={`${localBase}${path}`} />
      {!localOnly && (externalBase
        ? <CopyField label="Adres via internet" value={`${externalBase}${path}`} />
        : <div className="issue">{t("Stel in Home Assistant een extern adres in (Instellingen → Systeem → Netwerk, of Nabu Casa) om de webhook via internet te gebruiken.")}</div>)}
      <label className="checkbox">
        <input type="checkbox" checked={localOnly} onChange={event => set({ local_only: event.target.checked })} />
        {t("Alleen vanuit mijn eigen netwerk (aanbevolen)")}
      </label>
      <Field label="Toegestane methodes">
        <div className="chips">
          {WEBHOOK_METHODS.map(method => (
            <button type="button" key={method} className={`chip ${methods.includes(method) ? "on" : ""}`} onClick={() => toggleMethod(method)}>
              {method}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Webhook-ID" hint="Werkt als wachtwoord: iedereen met dit adres kan de flow starten.">
        <div className="copy-row">
          <input className="input code" value={data.webhook_id ?? ""} onChange={event => set({ webhook_id: event.target.value.trim() })} />
          <button type="button" className="btn secondary small-btn" title={t("Het oude adres werkt daarna niet meer.")}
            onClick={() => set({ webhook_id: newWebhookId() })}>{t("Nieuw ID")}</button>
        </div>
      </Field>
      <p className="muted">
        {t("Meegestuurde gegevens gebruik je in latere kaarten met {{ trigger.json.naam }} (JSON) of {{ trigger.query.naam }} (URL-parameters).")}
      </p>
      <div className="field">
        <button type="button" className="btn secondary" onClick={test}>{t("Nu testen")}</button>
        {result && <span className={result.ok ? "success" : "issue"}>{result.ok ? "✔" : "✘"} {result.text}</span>}
      </div>
    </>
  );
}

/** Trigger kinds a "wait until" card can wait for. */
const WAIT_KINDS = ["device", "state", "time", "sun", "weather", "presence", "webhook"];

function WaitForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const t = useT();
  const inner: Data = data.trigger ?? { kind: "state" };
  const setInner = (next: Data) => set({ trigger: next });

  return (
    <>
      <Field label="Wacht tot…">
        <select className="input" value={inner.kind} onChange={event => {
          const item = catalogItem("trigger", event.target.value);
          setInner({ kind: event.target.value, ...(item ? catalogDefaults(item) : {}) });
        }}>
          {WAIT_KINDS.map(kind => <option key={kind} value={kind}>{t(catalogItem("trigger", kind)?.title ?? kind)}</option>)}
        </select>
      </Field>
      <div className="nested">
        {inner.kind === "device" ? (
          <DeviceCardForm cardType="trigger" data={inner as any} question="Waarop moet de flow wachten?"
            onChange={next => setInner({ ...next })} />
        ) : (
          <KindForm type="trigger" data={inner} set={patch => setInner({ ...inner, ...patch })} />
        )}
      </div>
      <Field label="Maximaal wachten (optioneel)" hint="Na deze tijd gaat de flow verder via 'tijd verstreken'. Zonder maximum wacht de flow tot het gebeurt.">
        <DurationInput value={data.timeout} onChange={timeout => set({ timeout })} />
      </Field>
      <p className="muted">
        {t("Voorbeeld: ALS beweging → Lamp aan → Wacht tot \"geen beweging, 2 min lang\" → Lamp uit. Met \"Opnieuw starten als hij al loopt\" begint het wachten opnieuw bij nieuwe beweging.")}
      </p>
    </>
  );
}

const pad = (value: unknown) => String(Number(value) || 0).padStart(2, "0");
const hhmmss = (value: { hours?: unknown; minutes?: unknown; seconds?: unknown }) =>
  `${pad(value.hours)}:${pad(value.minutes)}:${pad(value.seconds)}`;

/** Timer choice with inline creation of a new timer helper. */
function TimerPicker({ value, onChange }: { value?: string; onChange: (entityId: string) => void }) {
  const hass = useHass();
  const t = useT();
  const timers = useEntityOptions(["timer"]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [length, setLength] = useState<Data>({ minutes: 5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      onChange(await createTimer(hass, name.trim(), hhmmss(length)));
      setCreating(false);
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Field label="Timer">
        <SearchSelect value={value} options={timers} placeholder="Kies een timer…" onChange={onChange} />
      </Field>
      {!creating ? (
        <div className="rename-row">
          <button type="button" className="link-btn" onClick={() => setCreating(true)}>＋ {t("Nieuwe timer")}</button>
        </div>
      ) : (
        <div className="field rename-box">
          <Field label="Naam van de timer">
            <input className="input" value={name} autoFocus placeholder={t("bijv. Nalooptijd bijkeuken")} onChange={event => setName(event.target.value)} />
          </Field>
          <Field label="Standaardduur">
            <DurationInput value={length} onChange={setLength} />
          </Field>
          <span className="field-hint">{t("De timer wordt als helper in Home Assistant aangemaakt en loopt door na een herstart.")}</span>
          {error && <span className="issue">{error}</span>}
          <div className="rename-actions">
            <button type="button" className="btn small-btn" disabled={busy || !name.trim()} onClick={() => void create()}>{t("Aanmaken")}</button>
            <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setCreating(false)}>{t("Annuleren")}</button>
          </div>
        </div>
      )}
    </>
  );
}

const TIMER_ACTIONS = { start: "Starten (of opnieuw starten)", cancel: "Stoppen", pause: "Pauzeren", finish: "Direct laten aflopen" };

function TimerActionForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const action = data.action ?? "start";
  const standard = data.entity_id ? hass.states[data.entity_id]?.attributes.duration : undefined;
  return (
    <>
      <TimerPicker value={data.entity_id} onChange={entity_id => set({ entity_id })} />
      <Field label="Wat moet er gebeuren?">
        <select className="input" value={action} onChange={event => set({ action: event.target.value })}>
          {Object.entries(TIMER_ACTIONS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </Field>
      {action === "start" && (
        <Field label="Duur (optioneel)" hint={standard ? t("Leeg = standaardduur van de timer ({duration}).", { duration: standard }) : undefined}>
          <DurationInput value={data.duration} onChange={duration => set({ duration })} />
        </Field>
      )}
      <p className="muted">
        {t("Tip: ALS beweging → Lamp aan + Timer starten; ALS timer afgelopen → Lamp uit. Opnieuw starten terwijl de timer loopt, begint het aftellen opnieuw.")}
      </p>
    </>
  );
}

/** Condition kinds a repeat card can use for while/until. */
const REPEAT_CONDITION_KINDS = ["device", "state", "numeric_state", "time", "sun", "weather", "presence", "timer"];

function RepeatForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const t = useT();
  const mode = data.mode ?? "count";
  const inner: Data = data.condition ?? { kind: "state" };
  const setInner = (next: Data) => set({ condition: next });
  return (
    <>
      <Field label="Hoe vaak?">
        <select className="input" value={mode} onChange={event => set({ mode: event.target.value })}>
          <option value="count">{t("Een vast aantal keer")}</option>
          <option value="while">{t("Zolang iets geldt")}</option>
          <option value="until">{t("Totdat iets geldt")}</option>
        </select>
      </Field>
      {mode === "count" ? (
        <Field label="Aantal keer">
          <input className="input" type="number" min={1} max={1000} value={data.count ?? ""} onChange={event => set({ count: event.target.value })} />
        </Field>
      ) : (
        <>
          <Field label={mode === "while" ? "Zolang…" : "Totdat…"}>
            <select className="input" value={inner.kind} onChange={event => {
              const item = catalogItem("condition", event.target.value);
              setInner({ kind: event.target.value, ...(item ? catalogDefaults(item) : {}) });
            }}>
              {REPEAT_CONDITION_KINDS.map(kind => <option key={kind} value={kind}>{t(catalogItem("condition", kind)?.title ?? kind)}</option>)}
            </select>
          </Field>
          <div className="nested">
            {inner.kind === "device" ? (
              <DeviceCardForm cardType="condition" data={inner as any} onChange={next => setInner({ ...next })} />
            ) : (
              <KindForm type="condition" data={inner} set={patch => setInner({ ...inner, ...patch })} />
            )}
          </div>
          <Field label="Maximaal aantal keer" hint="Vangnet, zodat de lus nooit eindeloos doorgaat.">
            <input className="input" type="number" min={1} max={1000} value={data.max ?? 10} onChange={event => set({ max: event.target.value })} />
          </Field>
        </>
      )}
      <p className="muted">
        {t("Verbind de kaarten die herhaald moeten worden met de uitgang 'herhaal'. Daarna gaat de flow verder via 'klaar'. Zet een Wachten-kaart in de lus om tempo te bepalen.")}
      </p>
    </>
  );
}

function ServiceForm({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const hass = useHass();
  const t = useT();
  const services = useMemo(
    () => Object.entries(hass.services ?? {}).flatMap(([domain, list]) =>
      Object.keys(list).map(service => ({
        value: `${domain}.${service}`,
        label: serviceName(hass, domain, service),
        group: domain,
        secondary: `${domain}.${service}`,
      }))),
    [hass.services, t],
  );
  const domain = data.service?.split(".")[0];
  const hasEntities = !!domain && Object.keys(hass.states).some(id => id.startsWith(`${domain}.`));
  const entityOptionsList = useEntityOptions(hasEntities ? [domain] : undefined);
  const targets: string[] = [data.target?.entity_id ?? []].flat();
  const fields = domain ? hass.services?.[domain]?.[data.service.split(".")[1]]?.fields ?? {} : {};

  return (
    <>
      <Field label="Actie">
        <SearchSelect value={data.service} options={services} placeholder="Zoek bijv. 'lamp aan' of 'notify'…"
          onChange={service => set({ service })} />
      </Field>
      <EntityChips label="Op entiteiten" value={targets} options={entityOptionsList} placeholder="+ entiteit toevoegen…"
        onChange={entity_id => set({ target: { ...data.target, entity_id } })} />
      {data.service === WEBHOOK_ACTION && (
        <div className="banner">{t("Tip: gebruik de kaart Webhook (onder Dan…). Daar kun je de Homey-URL plakken en direct testen.")}</div>
      )}
      <DataEditor value={data.data} fields={Object.keys(fields)} onChange={value => set({ data: value })} />
    </>
  );
}

/** Parses the service-data YAML; returns an error message for anything but a `key: value` mapping. */
function parseServiceData(text: string, t: Translate): { value: Record<string, unknown> | undefined } | { error: string } {
  let parsed: unknown;
  try {
    parsed = text.trim() ? parse(text) : undefined;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (parsed === undefined || (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))) {
    return { value: parsed as Record<string, unknown> | undefined };
  }
  if (typeof parsed === "string" && /^https?:\/\//.test(parsed.trim())) {
    return { error: t("Zet de veldnaam ervoor, bijvoorbeeld:\nurl: {url}", { url: parsed.trim() }) };
  }
  return { error: t("Gebruik regels in de vorm 'veld: waarde', bijvoorbeeld brightness_pct: 60.") };
}

/** YAML editor for service data; only valid mappings are applied. */
function DataEditor({ value, fields, onChange }: {
  value: Record<string, unknown> | undefined;
  fields: string[];
  onChange: (value: Record<string, unknown> | undefined) => void;
}) {
  const t = useT();
  const [text, setText] = useState(() => (value && Object.keys(value).length ? stringify(value) : ""));
  const result = parseServiceData(text, t);

  return (
    <Field label="Extra gegevens (YAML, optioneel)" hint={fields.length ? t("Mogelijke velden: {fields}", { fields: fields.join(", ") }) : undefined}>
      <textarea className="input code" rows={4} value={text} placeholder="brightness_pct: 60"
        onChange={event => setText(event.target.value)}
        onBlur={() => "value" in result && onChange(result.value)} />
      {"error" in result && <span className="issue pre">{result.error}</span>}
    </Field>
  );
}
