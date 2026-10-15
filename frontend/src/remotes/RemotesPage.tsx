/** "Afstandsbediening": learn buttons of a Broadlink remote (with a log), test and delete them. */
import { useEffect, useRef, useState } from "react";
import {
  buttonTypeLabel,
  deleteButton,
  entityName,
  errorMessage,
  learnButton,
  listRemotes,
  sendButton,
  subscribeLearnNotification,
  type BroadlinkRemote,
  type LearnFailure,
  type RemoteButton,
} from "../api/ha";
import { toast, useHass } from "../context";
import { useLang, useT, type Translate } from "../i18n";

interface LogEntry {
  id: number;
  time: Date;
  ok: boolean;
  text: string;
  detail?: string;
}

// Kept for the session, so the log and the last group survive a visit to the flow editor.
let sessionLog: LogEntry[] = [];
let lastGroup = "Algemeen";
let nextLogId = 1;

const FAILURES: Record<LearnFailure, string> = {
  timeout: "Geen signaal ontvangen binnen 30 seconden. Richt de afstandsbediening op het apparaat (infrarood) of houd hem er vlakbij (RF) en probeer opnieuw.",
  turned_off: "De afstandsbediening staat uit in Home Assistant. Zet hem aan en probeer opnieuw.",
  unavailable: "Het apparaat is niet bereikbaar. Controleer of het nog in je wifi zit.",
  rf_unsupported: "Dit apparaat kan geen RF-signalen leren; kies Infrarood.",
  no_code: "Er is geen nieuwe code opgeslagen.",
  error: "Er ging iets mis.",
};

/** Dutch version of Broadlink's (English) learning notification. */
function instructionText(message: string, t: Translate): string {
  const name = /'(.+)'/.exec(message)?.[1] ?? "";
  if (message.startsWith("Press and hold")) {
    return t("Houd de knop \"{name}\" ingedrukt tot deze tekst verandert (de frequentie wordt gezocht).", { name });
  }
  if (message.includes("again")) return t("Laat los en druk nu nog één keer kort op \"{name}\".", { name });
  return t("Druk nu op de knop \"{name}\" van je afstandsbediening.", { name });
}

export function RemotesPage({ narrow, onBack }: { narrow: boolean; onBack: () => void }) {
  const hass = useHass();
  const t = useT();
  const { lang } = useLang();
  const root = useRef<HTMLDivElement>(null);
  const [remotes, setRemotes] = useState<BroadlinkRemote[] | null>(null);
  const [error, setError] = useState("");
  const [entityId, setEntityId] = useState("");
  const [group, setGroup] = useState(lastGroup);
  const [name, setName] = useState("");
  const [commandType, setCommandType] = useState<"ir" | "rf">("ir");
  const [learning, setLearning] = useState<string | null>(null);
  const [instruction, setInstruction] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>(sessionLog);

  const load = async (refresh = false) => {
    try {
      const list = await listRemotes(hass, refresh);
      setRemotes(list);
      setError("");
      setEntityId(current => current || list[0]?.entity_id || "");
    } catch (err) {
      setError(t("Kan afstandsbedieningen niet laden: {error}", { error: errorMessage(err) }));
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  const addLog = (entry: Omit<LogEntry, "id" | "time">) => {
    sessionLog = [{ ...entry, id: nextLogId++, time: new Date() }, ...sessionLog].slice(0, 100);
    setLog(sessionLog);
  };

  const remote = remotes?.find(item => item.entity_id === entityId);
  const state = entityId ? hass.states[entityId]?.state : undefined;
  const groups = [...new Set(remote?.buttons.map(button => button.device) ?? [])];
  const command = name.trim();
  const device = group.trim();

  const learn = async () => {
    if (!remote || !command || !device) return;
    const exists = remote.buttons.some(button => button.device === device && button.command === command);
    if (exists && !window.confirm(t("\"{name}\" bestaat al in groep \"{group}\". Opnieuw leren en vervangen?", { name: command, group: device }))) {
      return;
    }
    lastGroup = device;
    setLearning(command);
    setInstruction(null);
    const unsubscribe = await subscribeLearnNotification(hass, setInstruction).catch(() => undefined);
    try {
      const result = await learnButton(hass, remote.entity_id, device, command, commandType);
      if (result.learned) {
        addLog({
          ok: true,
          text: t("Knop \"{name}\" geleerd in groep \"{group}\" ({type}).", {
            name: command, group: device, type: buttonTypeLabel(result.button.type),
          }),
        });
        setName("");
        await load(true);
      } else {
        addLog({ ok: false, text: t("\"{name}\" niet geleerd: {reason}", { name: command, reason: t(FAILURES[result.reason]) }), detail: result.message });
      }
    } catch (err) {
      addLog({ ok: false, text: t("\"{name}\" niet geleerd: {reason}", { name: command, reason: t(FAILURES.error) }), detail: errorMessage(err) });
    } finally {
      void unsubscribe?.();
      setLearning(null);
      setInstruction(null);
    }
  };

  const test = async (button: RemoteButton) => {
    if (!remote) return;
    try {
      await sendButton(hass, remote.entity_id, button.device, button.command);
      addLog({ ok: true, text: t("\"{name}\" ({group}) verstuurd.", { name: button.command, group: button.device }) });
    } catch (err) {
      addLog({ ok: false, text: t("Versturen van \"{name}\" mislukt.", { name: button.command }), detail: errorMessage(err) });
    }
  };

  const remove = async (button: RemoteButton) => {
    if (!remote) return;
    if (!window.confirm(t("Knop \"{name}\" ({group}) verwijderen? Flows die hem gebruiken werken dan niet meer.", { name: button.command, group: button.device }))) return;
    try {
      await deleteButton(hass, remote.entity_id, button.device, button.command);
      addLog({ ok: true, text: t("Knop \"{name}\" ({group}) verwijderd.", { name: button.command, group: button.device }) });
      await load(true);
    } catch (err) {
      toast(root.current, t("Verwijderen mislukt: {error}", { error: errorMessage(err) }));
    }
  };

  const byGroup = new Map<string, RemoteButton[]>();
  for (const button of remote?.buttons ?? []) byGroup.set(button.device, [...(byGroup.get(button.device) ?? []), button]);
  const timeFormat = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="page" ref={root}>
      <header className="page-head">
        {narrow && (
          <button type="button" className="icon-btn" title={t("Menu")}
            onClick={event => event.currentTarget.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }))}>
            ☰
          </button>
        )}
        <button type="button" className="icon-btn" title={t("Terug naar overzicht")} onClick={onBack}>←</button>
        <div>
          <h1>📡 {t("Afstandsbediening")}</h1>
          <div className="muted">{t("Leer de knoppen van je afstandsbedieningen en gebruik ze in je flows.")}</div>
        </div>
      </header>

      {error && <div className="banner">{error}</div>}
      {!remotes && !error && <div className="muted">{t("Laden…")}</div>}
      {remotes?.length === 0 && (
        <div className="empty">
          <div className="big">📡</div>
          <h2>{t("Geen Broadlink-apparaat gevonden")}</h2>
          <p>{t("Voeg in Home Assistant de integratie Broadlink toe (Instellingen → Apparaten & diensten), bijvoorbeeld voor een RM4 mini. Daarna kun je hier knoppen leren.")}</p>
        </div>
      )}

      {remote && (
        <div className="remote-layout">
          <section className="remote-card">
            <h2>{t("Knop leren")}</h2>
            {remotes!.length > 1 && (
              <label className="field">
                <span className="field-label">{t("Apparaat")}</span>
                <select className="input" value={entityId} disabled={!!learning} onChange={event => setEntityId(event.target.value)}>
                  {remotes!.map(item => <option key={item.entity_id} value={item.entity_id}>{entityName(hass, item.entity_id)}</option>)}
                </select>
              </label>
            )}
            {state === "off" && (
              <div className="banner">
                {t("{name} staat uit in Home Assistant; dan kan hij niets leren of versturen.", { name: entityName(hass, entityId) })}{" "}
                <button type="button" className="link-btn" onClick={() => hass.callService("remote", "turn_on", { entity_id: entityId })}>
                  {t("Aanzetten")}
                </button>
              </div>
            )}
            <label className="field">
              <span className="field-label">{t("Naam van de knop")}</span>
              <input className="input" value={name} disabled={!!learning} placeholder={t("bijv. lamp aan")}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => event.key === "Enter" && void learn()} />
            </label>
            <label className="field">
              <span className="field-label">{t("Groep")}</span>
              <input className="input" list="remote-groups" value={group} disabled={!!learning} placeholder={t("bijv. TV of Woonkamerlamp")}
                onChange={event => setGroup(event.target.value)} />
              <datalist id="remote-groups">{groups.map(item => <option key={item} value={item} />)}</datalist>
              <span className="field-hint">{t("Knoppen met dezelfde naam mogen in verschillende groepen staan (bijv. \"aan\" bij TV en bij Versterker).")}</span>
            </label>
            <label className="field">
              <span className="field-label">{t("Soort signaal")}</span>
              <select className="input" value={commandType} disabled={!!learning}
                onChange={event => setCommandType(event.target.value as "ir" | "rf")}>
                <option value="ir">{t("Infrarood (tv, airco, versterker, …)")}</option>
                <option value="rf">{t("RF 433 MHz (stopcontacten, rolluiken, lampen, …)")}</option>
              </select>
            </label>
            <button type="button" className="btn" disabled={!!learning || !command || !device || state === "off"} onClick={() => void learn()}>
              {learning ? t("Wachten op knop…") : t("Leer knop")}
            </button>
            {learning && (
              <div className="learn-instruction">
                <span className="pulse" />
                {instruction
                  ? instructionText(instruction, t)
                  : t(commandType === "rf"
                    ? "Houd de knop \"{name}\" van je afstandsbediening vlak bij het apparaat ingedrukt."
                    : "Richt je afstandsbediening op het apparaat en druk op de knop \"{name}\".", { name: learning })}
              </div>
            )}

            <h3 className="log-title">{t("Logboek")}</h3>
            {log.length === 0 && <div className="muted small">{t("Hier zie je welke knoppen je hebt geleerd, getest of verwijderd.")}</div>}
            <ol className="remote-log">
              {log.map(entry => (
                <li key={entry.id} className={entry.ok ? "" : "failed"}>
                  <span className="log-time">{timeFormat.format(entry.time)}</span>
                  <span>{entry.ok ? "✔" : "✘"} {entry.text}</span>
                  {entry.detail && <span className="log-detail">{entry.detail}</span>}
                </li>
              ))}
            </ol>
          </section>

          <section className="remote-card">
            <div className="remote-card-head">
              <h2>{t("Geleerde knoppen")}</h2>
              <button type="button" className="icon-btn" title={t("Vernieuwen")} onClick={() => void load(true)}>↻</button>
            </div>
            {remote.buttons.length === 0 && <div className="muted">{t("Nog geen knoppen geleerd.")}</div>}
            {[...byGroup].map(([groupName, buttons]) => (
              <div key={groupName} className="remote-group">
                <h3>{groupName}</h3>
                {buttons.map(button => (
                  <div key={button.command} className="remote-button">
                    <span className={`badge type-${button.type ?? "unknown"}`}>{buttonTypeLabel(button.type)}</span>
                    <span className="remote-button-name">{button.command}</span>
                    <button type="button" className="btn secondary small-btn" disabled={!!learning} onClick={() => void test(button)}>
                      ▶ {t("Test")}
                    </button>
                    <button type="button" className="icon-btn danger" title={t("Verwijderen")} disabled={!!learning}
                      onClick={() => void remove(button)}>🗑</button>
                  </div>
                ))}
              </div>
            ))}
            <p className="muted small">
              {t("Gebruik een knop in een flow met de kaart Afstandsbediening (onder Dan…), bijvoorbeeld: ALS Tijdstip 19:00 → DAN Afstandsbediening \"lamp aan\".")}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
