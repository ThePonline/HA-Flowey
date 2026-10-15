<p align="center">
  <img src="custom_components/ha_flow_builder/brand/icon.png" alt="" width="96" height="96">
</p>

<h1 align="center">Flowey</h1>

<p align="center">
  Homey-style <b>Advanced Flows</b> for Home Assistant: build automations on a canvas,<br>
  saved as regular Home Assistant automations.
</p>

<p align="center">
  <a href="https://github.com/ThePonline/HA-Flowey/releases"><img alt="Release" src="https://img.shields.io/github/v/release/ThePonline/HA-Flowey?sort=semver"></a>
  <a href="https://github.com/ThePonline/HA-Flowey/actions/workflows/validate.yml"><img alt="Validate" src="https://img.shields.io/github/actions/workflow/status/ThePonline/HA-Flowey/validate.yml?branch=main&label=validate"></a>
  <a href="https://hacs.xyz"><img alt="HACS custom repository" src="https://img.shields.io/badge/HACS-custom-41BDF5.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0 or commercial" src="https://img.shields.io/badge/license-AGPL--3.0%20%7C%20commercial-blue"></a>
</p>

<p align="center"><i>English · <a href="README.nl.md">Nederlands</a></i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/editor-dark.png">
  <img alt="The flow editor: a motion trigger, a sun condition with yes and no paths, and light, timer and notification actions" src="docs/images/editor.png">
</picture>

Build automations with cards:
**WHEN** (trigger) → **AND** (condition with yes/no outputs) → **THEN** (action).

Pick a device first, for example "Hall door sensor", and only the cards that belong to that device show up ("opened", "closed", "battery low"). They come straight from Home Assistant, in Dutch or English.

Every flow is saved as a **regular Home Assistant automation** in `automations.yaml` (id `flowey_…`). Home Assistant runs it itself, with traces, run modes and everything else. The visual layout (positions and connections) only lives in this panel. Uninstalling the panel leaves your automations working.

## Installation

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=ThePonline&repository=HA-Flowey&category=integration)

**HACS (recommended)**

1. Click the button above, or go to HACS → ⋮ → *Custom repositories* and add `https://github.com/ThePonline/HA-Flowey` with type *Integration*.
2. Install **Flowey** and restart Home Assistant.
3. Add the integration: [![Add integration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=ha_flow_builder)
   or go to *Settings → Devices & services → Add integration → Flowey*.
4. **Flowey** appears in the sidebar (admins only).

**Manual**: download the latest [release](https://github.com/ThePonline/HA-Flowey/releases), copy `custom_components/ha_flow_builder` to `config/custom_components/` and continue with step 2.

**Requirements**: Home Assistant 2024.10 or newer, and `automation: !include automations.yaml` in your configuration (every default installation has it).

**Updating from HA Flow Builder** (0.12 and older): just update in HACS and restart. Your flows, settings and automations are kept; only the name changes.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/overview-dark.png">
        <img alt="Overview of all flows with their status and last run" src="docs/images/overview.png">
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/inspector-dark.png">
        <img alt="Editing a light card: which lights, on, brightness and transition" src="docs/images/inspector.png">
      </picture>
    </td>
  </tr>
  <tr>
    <td align="center">Overview: status and last run of every flow</td>
    <td align="center">Editing a card</td>
  </tr>
</table>

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
| | | Remote control (send a learned infrared/RF button) |

Canvas rules:
- Several connections from one output run **in parallel**.
- Several triggers may lead to the same card ("A **or** B → do X").
- Paths can only merge directly after triggers.

## Highlights

- **Autosave**: every change is saved after about a second. A complete flow updates the automation right away; an incomplete flow stays a draft and the automation keeps its last working version.
- **Language**: Dutch or English (or follow Home Assistant), including the device card texts.
- **Rename devices** from the editor, exactly like HA's device settings (entity IDs stay the same).
- **Homey**: the *Webhook* action starts Homey flows (paste the Homey webhook URL); the *Webhook received* trigger lets Homey start flows in HA.
- **Remote control**: learn infrared and RF buttons of a Broadlink remote (e.g. RM4 mini) under your own names, with a live instruction and a log, and send them from any flow.
- **Timers** survive an HA restart; *Wait until…* is simpler but does not.
- **Test** simulates a chosen trigger; the overview shows when each flow last ran and whether it succeeded.
- **Copy/paste** cards (Ctrl+C / Ctrl+V / Ctrl+D) and duplicate whole flows.
- **Changed in YAML**: if you edit the automation outside the panel, the panel notices and asks before overwriting.

The Dutch README has more recipes (motion lighting, timers, Homey webhooks).

## Development

```bash
# Frontend (Node 24)
cd frontend
npm install
npm test          # compiler and UI logic tests (Vitest)
npm run build     # type check + bundle to custom_components/ha_flow_builder/static/
npm run dev       # rebuild on every change

# Backend (Python 3.14), from the repository root
pip install -r requirements_test.txt
pytest            # integration tests against a real Home Assistant core
ruff check . && ruff format --check .
```

- `frontend/src/compiler/`: graph → HA automation config (no UI dependencies, tested).
- `frontend/src/canvas/`: editor (React Flow), cards, palette.
- `frontend/src/inspector/`: forms per card type.
- `frontend/src/api/ha.ts`: websocket/REST calls to Home Assistant.
- `custom_components/ha_flow_builder/`: thin integration: panel, storage of the canvas layout, websocket API and the `call_webhook` action.
- `tests/`: backend tests (pytest-homeassistant-custom-component).

The built bundle is committed, because HACS installs the repository as is. CI checks that it matches the sources. After a new build, restart Home Assistant so browsers load the new bundle.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## License

Flowey is **dual-licensed**:

- **Free: [GNU AGPL-3.0](LICENSE).** Use it at home, change it, share it. If you distribute a modified version, or run a modified version as a service for others, you must publish your source code under the same license.
- **Commercial license.** For use in a commercial product or service without the AGPL obligations (for example in a closed-source product, or bundled with hardware or a paid installation service). Contact [@ThePonline](https://github.com/ThePonline) for terms.

The bundled libraries (React, React Flow, yaml) are MIT-licensed; their notices are in [THIRD_PARTY_LICENSES.md](custom_components/ha_flow_builder/static/THIRD_PARTY_LICENSES.md).
