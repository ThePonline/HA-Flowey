/**
 * Device → card → extra fields. The cards come straight from Home Assistant's
 * device automation API, so every integration's own triggers/conditions/actions
 * (with its own translations) show up automatically.
 */
import { useEffect, useMemo, useState } from "react";
import {
  cardLabelParts,
  deviceName,
  deviceOptions,
  errorMessage,
  formatCardLabel,
  getCardCapabilities,
  listDeviceCards,
  renameDevice,
  type CapabilityField,
  type CardLabelParts,
  type CardType,
  type HassDevice,
} from "../api/ha";
import type { DeviceCard, DeviceNodeData, Duration } from "../compiler/types";
import { stableStringify } from "../compiler/compile";
import { useHass } from "../context";
import { useLang, useT } from "../i18n";
import { stripDeviceName } from "../nodes/catalog";
import { DurationInput, Field, SearchSelect } from "./fields";

const CARD_QUESTION: Record<CardType, string> = {
  trigger: "Wanneer moet de flow starten?",
  condition: "Waar moet het apparaat aan voldoen?",
  action: "Wat moet het apparaat doen?",
};

const sameCard = (a: DeviceCard | undefined, b: DeviceCard) => {
  if (!a) return false;
  const { metadata: _a, ...left } = a;
  const { metadata: _b, ...right } = b;
  return stableStringify(left) === stableStringify(right);
};

export function DeviceCardForm({
  cardType,
  data,
  onChange,
  question,
}: {
  cardType: CardType;
  data: DeviceNodeData;
  onChange: (data: DeviceNodeData) => void;
  /** Overrides the default question above the card list (e.g. inside a "wait until" card). */
  question?: string;
}) {
  const hass = useHass();
  const { lang, t } = useLang();
  const devices = useMemo(
    () => deviceOptions(hass, t).map(device => ({ value: device.id, label: device.name, group: device.area })),
    [hass.devices, hass.areas, t],
  );
  const device = data.device_id ? hass.devices?.[data.device_id] : undefined;

  const [cards, setCards] = useState<{ card: DeviceCard; parts: CardLabelParts }[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setCards(null);
    setError("");
    if (!data.device_id) return;
    let cancelled = false;
    listDeviceCards(hass, cardType, data.device_id)
      .then(list => Promise.all(list.map(async card => ({ card, parts: await cardLabelParts(hass, lang, cardType, card) }))))
      .then(list => !cancelled && setCards(list))
      .catch(err => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
    // hass changes on every state update; the card list only depends on the device.
  }, [cardType, data.device_id, lang]);

  // Labels are formatted on every render, so they follow a rename right away.
  const labelled = (cards ?? [])
    .map(({ card, parts }) => ({ card, label: formatCardLabel(hass, parts) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <Field label="Apparaat">
        <SearchSelect
          value={data.device_id}
          options={devices}
          placeholder="Zoek een apparaat…"
          onChange={device_id => onChange({ kind: "device", device_id })}
        />
      </Field>
      {device && <DeviceRename device={device} />}

      {data.device_id && (
        <div className="field">
          <span className="field-label">{t(question ?? CARD_QUESTION[cardType])}</span>
          {error && <div className="issue">{error}</div>}
          {!cards && !error && <div className="muted">{t("Kaarten laden…")}</div>}
          {cards?.length === 0 && <div className="muted">{t("Dit apparaat heeft geen kaarten van dit type.")}</div>}
          <div className="card-list">
            {labelled.map(({ card, label }) => (
              <button
                type="button"
                key={stableStringify(card)}
                className={`card-option ${sameCard(data.card, card) ? "selected" : ""}`}
                onClick={() => onChange({ kind: "device", device_id: data.device_id, card, label, extra: {} })}
              >
                {device ? stripDeviceName(label, deviceName(device)) : label}
              </button>
            ))}
          </div>
        </div>
      )}

      {data.card && (
        <CapabilityFields
          cardType={cardType}
          card={data.card}
          values={data.extra ?? {}}
          onChange={extra => onChange({ ...data, extra })}
        />
      )}
    </>
  );
}

/**
 * Renames the device in Home Assistant itself (device registry `name_by_user`), exactly like
 * Settings → Devices → ✏️ does, so the new name is used everywhere in HA.
 */
function DeviceRename({ device }: { device: HassDevice }) {
  const hass = useHass();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Typing the integration's own name again clears name_by_user, just like in HA.
  const save = async (value: string | null) => {
    setBusy(true);
    setError("");
    try {
      await renameDevice(hass, device.id, value === null || value === device.name ? null : value);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="rename-row">
        <button type="button" className="link-btn" onClick={() => {
          setName(deviceName(device));
          setEditing(true);
        }}>✏️ {t("Apparaat hernoemen")}</button>
      </div>
    );
  }

  const trimmed = name.trim();
  return (
    <div className="field rename-box">
      <span className="field-label">{t("Nieuwe naam voor dit apparaat")}</span>
      <input className="input" value={name} autoFocus onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && trimmed) void save(trimmed);
          if (event.key === "Escape") setEditing(false);
        }} />
      <span className="field-hint">
        {t("De naam wordt in Home Assistant zelf aangepast en is overal in HA zichtbaar. Entiteit-ID's blijven gelijk, zodat bestaande automations blijven werken.")}
      </span>
      {error && <span className="issue">{error}</span>}
      <div className="rename-actions">
        <button type="button" className="btn small-btn" disabled={busy || !trimmed} onClick={() => void save(trimmed)}>
          {t("Opslaan")}
        </button>
        <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setEditing(false)}>
          {t("Annuleren")}
        </button>
        {device.name_by_user && device.name && (
          <button type="button" className="link-btn" disabled={busy} onClick={() => void save(null)}>
            {t("Oorspronkelijke naam herstellen ({name})", { name: device.name })}
          </button>
        )}
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  for: "Gedurende",
  above: "Boven",
  below: "Onder",
  brightness_pct: "Helderheid (%)",
  value: "Waarde",
  position: "Positie (%)",
  mode: "Modus",
  code: "Code",
  temperature: "Temperatuur",
  to: "Naar",
  from: "Van",
};

/** Renders capabilities.extra_fields (serialized voluptuous schema). */
function CapabilityFields({
  cardType,
  card,
  values,
  onChange,
}: {
  cardType: CardType;
  card: DeviceCard;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const hass = useHass();
  const t = useT();
  const [fields, setFields] = useState<CapabilityField[] | null>(null);
  const cardKey = stableStringify(card);

  useEffect(() => {
    let cancelled = false;
    setFields(null);
    getCardCapabilities(hass, cardType, card).then(result => !cancelled && setFields(result));
    return () => {
      cancelled = true;
    };
  }, [cardType, cardKey]);

  const set = (name: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined || value === "") delete next[name];
    else next[name] = value;
    onChange(next);
  };

  // Lights without a brightness field are not dimmable according to HA; the Lamp card explains why.
  const lightWithoutBrightness = cardType === "action" && card.domain === "light" && card.type === "turn_on" &&
    fields !== null && !fields.some(field => field.name === "brightness_pct");

  return (
    <>
      {lightWithoutBrightness && (
        <p className="muted">
          {t("Home Assistant biedt hier geen helderheid aan, dus ziet deze lamp als niet dimbaar. Gebruik de kaart 💡 Lamp om te dimmen; die laat ook zien wat HA van de lamp weet.")}
        </p>
      )}
      {(fields ?? []).map(field => {
        const label = t(FIELD_LABELS[field.name] ?? field.name.replaceAll("_", " ")) + (field.required ? "" : ` ${t("(optioneel)")}`);
        const value = values[field.name];
        const selector = field.selector ?? {};
        const kind = field.type ?? Object.keys(selector)[0];
        const suffix = field.description?.suffix ?? selector.number?.unit_of_measurement;

        if (kind === "positive_time_period_dict" || kind === "duration") {
          return (
            <Field key={field.name} label={label}>
              <DurationInput value={value as Duration} onChange={duration => set(field.name, duration)} />
            </Field>
          );
        }
        if (kind === "boolean") {
          return (
            <label key={field.name} className="checkbox">
              <input type="checkbox" checked={!!value} onChange={event => set(field.name, event.target.checked)} />
              {label}
            </label>
          );
        }
        const options = field.options ?? selector.select?.options;
        if (kind === "select" && options) {
          return (
            <Field key={field.name} label={label}>
              <select className="input" value={String(value ?? "")} onChange={event => set(field.name, event.target.value)}>
                <option value="">—</option>
                {options.map((option: any) => {
                  const [optionValue, optionLabel] = Array.isArray(option)
                    ? option
                    : typeof option === "object" ? [option.value, option.label] : [option, option];
                  return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
                })}
              </select>
            </Field>
          );
        }
        const numeric = kind === "float" || kind === "integer" || kind === "number";
        return (
          <Field key={field.name} label={label} hint={suffix ? t("in {unit}", { unit: suffix }) : undefined}>
            <input
              className="input"
              type={numeric ? "number" : "text"}
              min={field.valueMin ?? selector.number?.min}
              max={field.valueMax ?? selector.number?.max}
              step={kind === "integer" ? 1 : "any"}
              value={String(value ?? "")}
              onChange={event => set(field.name, numeric && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
            />
          </Field>
        );
      })}
    </>
  );
}
