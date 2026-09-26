/** Small form building blocks for the inspector. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WEEKDAYS, type Duration, type Weekday } from "../compiler/types";
import { useT } from "../i18n";
import { weekdayLabel } from "../nodes/catalog";

/** Labelled form row. Label and hint are Dutch texts and are translated here. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const t = useT();
  return (
    <label className="field">
      <span className="field-label">{t(label)}</span>
      {children}
      {hint && <span className="field-hint">{t(hint)}</span>}
    </label>
  );
}

export interface SearchOption {
  value: string;
  label: string;
  group?: string;
  secondary?: string;
}

/** Searchable single-select with grouped options (devices per room, entities per device, …). */
export function SearchSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string | undefined;
  options: SearchOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!event.composedPath().includes(wrapper.current!)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options
      .filter(option => {
        const haystack = `${option.label} ${option.group ?? ""} ${option.value} ${option.secondary ?? ""}`.toLowerCase();
        return terms.every(term => haystack.includes(term));
      })
      .slice(0, 200);
  }, [options, query]);

  let lastGroup: string | undefined;
  return (
    <div className="search-select" ref={wrapper}>
      <input
        className="input"
        value={open ? query : selected ? selected.label : value ?? ""}
        placeholder={selected ? selected.label : t(placeholder)}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && filtered[0]) {
            onChange(filtered[0].value);
            setOpen(false);
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      {open && (
        <div className="search-list" role="listbox">
          {filtered.length === 0 && <div className="search-empty">{t("Niets gevonden")}</div>}
          {filtered.map(option => {
            const header = option.group && option.group !== lastGroup ? option.group : undefined;
            lastGroup = option.group;
            return (
              <div key={option.value}>
                {header && <div className="search-group">{header}</div>}
                <button
                  type="button"
                  className={`search-option ${option.value === value ? "selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {option.secondary && <span className="search-secondary">{option.secondary}</span>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const numberOrUndefined = (value: string) => (value === "" ? undefined : Number(value));

export function DurationInput({ value, onChange }: { value: Duration | undefined; onChange: (value: Duration) => void }) {
  const t = useT();
  const current = value ?? {};
  const part = (key: keyof Duration, label: string) => (
    <label className="duration-part">
      <input
        className="input"
        type="number"
        min={0}
        value={current[key] ?? ""}
        onChange={event => onChange({ ...current, [key]: numberOrUndefined(event.target.value) })}
      />
      <span>{t(label)}</span>
    </label>
  );
  return <div className="duration">{part("hours", "uur")}{part("minutes", "min")}{part("seconds", "sec")}</div>;
}

export function WeekdayPicker({ value, onChange }: { value: Weekday[] | undefined; onChange: (value: Weekday[]) => void }) {
  const t = useT();
  const selected = value?.length ? value : WEEKDAYS;
  const toggle = (day: Weekday) => {
    const next = selected.includes(day) ? selected.filter(d => d !== day) : WEEKDAYS.filter(d => d === day || selected.includes(d));
    onChange(next.length === 0 || next.length === 7 ? [] : next);
  };
  return (
    <div className="chips">
      {WEEKDAYS.map(day => (
        <button type="button" key={day} className={`chip ${selected.includes(day) ? "on" : ""}`} onClick={() => toggle(day)}>
          {weekdayLabel(day, t)}
        </button>
      ))}
    </div>
  );
}

/** "30 min vóór" / "precies" / "15 min ná" editor for sun offsets, stored as ±HH:MM. */
export function OffsetInput({ value, onChange }: { value: string | undefined; onChange: (value: string | undefined) => void }) {
  const t = useT();
  const negative = value?.startsWith("-") ?? false;
  const time = value?.replace(/^[+-]/, "") ?? "";
  const zero = !time || /^0{1,2}:00(:00)?$/.test(time);
  const direction = zero ? "exact" : negative ? "before" : "after";
  const set = (dir: string, hhmm: string) => onChange(dir === "exact" || !hhmm ? undefined : `${dir === "before" ? "-" : ""}${hhmm}`);
  return (
    <div className="offset">
      <select className="input" value={direction} onChange={event => set(event.target.value, zero ? "00:30" : time)}>
        <option value="exact">{t("Precies op het moment")}</option>
        <option value="before">{t("Eerder, namelijk…")}</option>
        <option value="after">{t("Later, namelijk…")}</option>
      </select>
      {direction !== "exact" && (
        <input className="input" type="time" value={time.slice(0, 5)} onChange={event => set(direction, event.target.value)} />
      )}
    </div>
  );
}
