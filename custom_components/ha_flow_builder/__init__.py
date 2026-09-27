"""Flowey - Homey-style visual flows compiled to native HA automations."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv

from . import services, websocket_api
from .const import DOMAIN, LEGACY_TITLE, PANEL_COMPONENT, PANEL_TITLE, PANEL_URL_PATH, STATIC_URL
from .store import FlowRepository

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    # Actions used by compiled flows (e.g. webhooks) must exist before automations load.
    services.async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.setdefault(DOMAIN, {})

    if entry.title == LEGACY_TITLE:
        hass.config_entries.async_update_entry(entry, title=PANEL_TITLE)

    if "repository" not in data:
        repository = FlowRepository(hass)
        await repository.async_load()
        data["repository"] = repository

    # Static paths and websocket commands cannot be unregistered, so they are
    # registered once per HA run even if the entry is reloaded.
    if not data.get("http_registered"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "static"), False)]
        )
        websocket_api.async_register(hass)
        data["http_registered"] = True

    await _register_panel(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    async_remove_panel(hass, PANEL_URL_PATH)
    hass.data[DOMAIN]["panel_registered"] = False
    return True


async def _register_panel(hass: HomeAssistant) -> None:
    # A failed config-entry setup can be retried by Home Assistant after the
    # panel has already been registered. Make registration idempotent so a
    # retry does not raise "Overwriting panel ... owned by custom".
    data = hass.data[DOMAIN]
    if data.get("panel_registered"):
        return

    manifest_version = await hass.async_add_executor_job(_bundle_version)
    await panel_custom.async_register_panel(
        hass=hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon="mdi:graph-outline",
        # Cache-bust the bundle whenever it is rebuilt.
        module_url=f"{STATIC_URL}/flow_builder.js?v={manifest_version}",
        embed_iframe=False,
        # Saving writes to automations.yaml via the config API, which is admin-only.
        require_admin=True,
    )
    data["panel_registered"] = True


def _bundle_version() -> str:
    bundle = Path(__file__).parent / "static" / "flow_builder.js"
    return str(int(bundle.stat().st_mtime)) if bundle.exists() else "0"
