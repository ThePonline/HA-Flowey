# HA Flow Builder

*English · [Nederlands](README.nl.md)*

Homey-style **Advanced Flows** for Home Assistant. Build automations on a canvas with cards:
**WHEN** (trigger) → **AND** (condition with yes/no outputs) → **THEN** (action).

Pick a device first, for example "Hall door sensor", and only the cards that belong to that device show up ("opened", "closed", "battery low"). They come straight from Home Assistant, in Dutch or English.

Every flow is saved as a **regular Home Assistant automation** in `automations.yaml` (id `flowey_…`). Home Assistant runs it itself, with traces, run modes and everything else. The visual layout (positions and connections) only lives in this panel.

## Installation

**HACS (recommended)**

1. HACS → ⋮ → *Custom repositories* → add `https://github.com/ThePonline/HA-Flowey` with type *Integration*.
2. Install **HA Flow Builder** and restart Home Assistant.
3. *Settings → Devices & services → Add integration → HA Flow Builder*.
4. **Flows** appears in the sidebar (admins only).

**Manual**: copy `custom_components/ha_flow_builder` to `config/custom_components/` and continue with step 2.

Your configuration needs `automation: !include automations.yaml`, which every default installation has.

## Cards

| When… | And… | Then… |
|---|---|---|
| Device (all device triggers of HA) | Device is… | Device (all device actions of HA) |
| Entity changes (also helpers) | Entity is… | Light (on/off, dim to %, brighter/darker, color temperature, transition) |
| Time (+ weekdays) | Value above/below | Action (any HA service) |
| Interval | Time & days | Send notification (HA, phone, notify entity) |
| Sun (rise/set ± offset) | Sun (after/before ± offset) | Webhook (start a Homey flow or call any URL) |
| Weather (becomes rainy/sunny/…, temperature/wind/humidity above/below) | Weather | Wait |
| Presence (someone arrives/leaves, first arrives/last leaves, per zone) | Presence | Wait until… (with maximum; outputs *happened* / *timed out*) |
| Webhook received (e.g. from Homey) | Timer running | Timer (start, stop, pause) |
| Timer finished | | Repeat (x times, while/until; outputs *repeat* / *done*) |

Canvas rules:
- Several connections from one output run **in parallel**.
- Several triggers may lead to the same card ("A **or** B → do X").
- Paths can only merge directly after triggers.

## Highlights

- **Autosave**: every change is saved after about a second. A complete flow updates the automation right away; an incomplete flow stays a draft and the automation keeps its last working version.
- **Language**: Dutch or English (or follow Home Assistant), including the device card texts.
- **Rename devices** from the editor, exactly like HA's device settings (entity IDs stay the same).
- **Homey**: the *Webhook* action starts Homey flows (paste the Homey webhook URL); the *Webhook received* trigger lets Homey start flows in HA.
- **Timers** survive an HA restart; *Wait until…* is simpler but does not.
- **Test** simulates a chosen trigger; the overview shows when each flow last ran and whether it succeeded.
- **Copy/paste** cards (Ctrl+C / Ctrl+V / Ctrl+D) and duplicate whole flows.
- **Changed in YAML**: if you edit the automation outside the panel, the panel notices and asks before overwriting.

## Development

```bash
cd frontend
npm install
npm test          # compiler tests (Vitest)
npm run build     # type check + bundle to custom_components/ha_flow_builder/static/flow_builder.js
npm run dev       # rebuild on every change
```

- `frontend/src/compiler/`: graph → HA automation config (no UI dependencies, tested).
- `frontend/src/canvas/`: editor (React Flow), cards, palette.
- `frontend/src/inspector/`: forms per card type.
- `frontend/src/api/ha.ts`: websocket/REST calls to Home Assistant.
- `custom_components/ha_flow_builder/`: thin integration: panel, storage of the canvas layout, websocket API and the `call_webhook` action.

The built bundle is committed, because HACS installs the repository as is. CI checks that it matches the sources. After a new build, restart Home Assistant so browsers load the new bundle.
