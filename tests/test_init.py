"""Tests for setting up and unloading the integration."""

from __future__ import annotations

import json
from pathlib import Path

from homeassistant.components.frontend import DATA_PANELS
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_flow_builder import _bundle_version, _short_version
from custom_components.ha_flow_builder.const import DOMAIN, PANEL_URL_PATH, STATIC_URL
from custom_components.ha_flow_builder.services import SERVICE_CALL_WEBHOOK


@pytest.mark.usefixtures("mock_bundle_version")
async def test_setup_registers_panel_and_action(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    assert setup_integration.state is ConfigEntryState.LOADED

    panel = hass.data[DATA_PANELS][PANEL_URL_PATH]
    manifest = Path(__file__).parents[1] / "custom_components" / DOMAIN / "manifest.json"
    version = json.loads(manifest.read_text())["version"]
    assert panel.sidebar_title == f"Flowey ({_short_version(version)})"
    assert panel.require_admin is True
    assert panel.config["_panel_custom"]["module_url"] == f"{STATIC_URL}/flow_builder.js?v=123"

    assert hass.services.has_service(DOMAIN, SERVICE_CALL_WEBHOOK)


@pytest.mark.usefixtures("mock_bundle_version")
async def test_unload_removes_panel(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    await hass.async_block_till_done()

    assert setup_integration.state is ConfigEntryState.NOT_LOADED
    assert PANEL_URL_PATH not in hass.data[DATA_PANELS]
    # Compiled automations may still call the action, so it stays registered.
    assert hass.services.has_service(DOMAIN, SERVICE_CALL_WEBHOOK)


@pytest.mark.usefixtures("mock_bundle_version")
async def test_reload_registers_panel_again(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    assert await hass.config_entries.async_reload(setup_integration.entry_id)
    await hass.async_block_till_done()

    assert setup_integration.state is ConfigEntryState.LOADED
    assert PANEL_URL_PATH in hass.data[DATA_PANELS]


def test_bundle_version_follows_bundle_file() -> None:
    # The committed bundle exists, so the cache-buster is its modification time.
    assert _bundle_version().isdigit()
    assert _bundle_version() != "0"


@pytest.mark.usefixtures("mock_bundle_version")
async def test_renames_entry_from_before_flowey(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, title="HA Flow Builder")
    entry.add_to_hass(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.title == "Flowey"


@pytest.mark.parametrize(
    ("version", "short"), [("1.11.0", "1.11"), ("1.11.2", "1.11.2"), ("1.10.0", "1.10"), ("2.0", "2.0")]
)
def test_short_version(version: str, short: str) -> None:
    assert _short_version(version) == short
