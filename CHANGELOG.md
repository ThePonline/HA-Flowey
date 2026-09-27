# Changelog

All notable changes to Flowey (called HA Flow Builder before 0.13.0) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.13.0] - 2026-09-27

### Changed
- **HA Flow Builder is now called Flowey.** The sidebar item, the integration, the HACS entry and the panel all use the new name.
- Nothing to do when updating: the integration id (`ha_flow_builder`), the panel URL, your flows, settings and the `ha_flow_builder.call_webhook` action stay the same. The existing integration entry is renamed automatically, and when you open the panel, flows whose automation only still says "Beheerd door HA Flow Builder" are republished with the new description.

## [0.12.0] - 2026-09-27

### Changed
- **License**: HA Flow Builder is now dual-licensed under the [GNU AGPL-3.0](https://github.com/ThePonline/HA-Flowey/blob/main/LICENSE) and a commercial license. See [License](https://github.com/ThePonline/HA-Flowey#license).
- The integration ships its own brand icon (`brand/icon.png`), which Home Assistant and HACS show for the integration.

### Fixed
- The overview showed a red "aborted" for runs that stopped because an AND card did not hold. These now show "conditions not met".
- The language picker in the overview no longer stretches across the header and squeezes the subtitle.

### Added
- Backend test suite (pytest-homeassistant-custom-component) for setup/unload, the config flow, storage and migration, the websocket API and the `call_webhook` action.
- Linting and formatting with ruff; CI runs ruff, pytest, the frontend tests, hassfest and HACS validation.
- Release workflow: pushing a `v*` tag creates a GitHub release from this changelog after checking that the tag matches the manifest version.
- `THIRD_PARTY_LICENSES.md` next to the bundle with the licenses of the bundled libraries.
- Screenshots, badges, a contributing guide and issue templates.

## [0.11.0] - 2026-09-26

### Added
- **Test** asks which trigger to simulate when triggers have their own paths.
- The overview shows when each flow last ran and the outcome, with a traces button.
- Copy, paste and duplicate cards (Ctrl+C / Ctrl+V / Ctrl+D), also between flows. Copied webhook triggers get a new secret id.
- Duplicate whole flows; the copy starts switched off.
- Timer cards: *timer finished* (WHEN), *timer running* (AND) and start/stop/pause/finish (THEN). Timers survive a Home Assistant restart.
- *Repeat* card: a number of times, while or until, with a safety maximum.

### Fixed
- Duplicating a flow could leave the copy enabled.

## [0.10.0] - 2026-09-26

### Added
- *Webhook received* trigger, e.g. to start flows from Homey (random id, selectable methods, local only by default).
- *Wait until…* card with an optional maximum and separate *happened* / *timed out* outputs.
- Rename devices from the editor, the same way Home Assistant's device settings do.

## [0.9.0] - 2026-09-26

### Added
- First public version: a canvas editor with device, entity, time, sun, weather and presence triggers and conditions, and light, notify, webhook, service and delay actions.
- Flows are saved as regular automations in `automations.yaml`, with autosave, Dutch/English texts and detection of external YAML edits.

[Unreleased]: https://github.com/ThePonline/HA-Flowey/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/ThePonline/HA-Flowey/releases/tag/v0.13.0
[0.12.0]: https://github.com/ThePonline/HA-Flowey/releases/tag/v0.12.0
[0.11.0]: https://github.com/ThePonline/HA-Flowey/commit/fd48ac1
[0.10.0]: https://github.com/ThePonline/HA-Flowey/commit/4bb2d61
[0.9.0]: https://github.com/ThePonline/HA-Flowey/commit/474ba2a
