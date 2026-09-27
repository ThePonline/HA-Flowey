"""Websocket commands used by the Flow Builder panel."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
import homeassistant.helpers.config_validation as cv
import voluptuous as vol

from .store import get_repository

NODE_SCHEMA = vol.Schema(
    {
        vol.Required("id"): cv.string,
        vol.Required("type"): vol.In(["trigger", "condition", "action"]),
        vol.Required("position"): {vol.Required("x"): vol.Coerce(float), vol.Required("y"): vol.Coerce(float)},
        vol.Required("data"): vol.Schema({vol.Required("kind"): cv.string}, extra=vol.ALLOW_EXTRA),
    },
    extra=vol.ALLOW_EXTRA,
)

EDGE_SCHEMA = vol.Schema(
    {
        vol.Required("id"): cv.string,
        vol.Required("source"): cv.string,
        vol.Required("target"): cv.string,
        vol.Optional("sourceHandle"): vol.Any(None, cv.string),
    },
    extra=vol.ALLOW_EXTRA,
)

FLOW_SCHEMA = vol.Schema(
    {
        vol.Required("id"): vol.All(cv.string, vol.Match(r"^[A-Za-z0-9_-]+$")),
        vol.Required("name"): vol.All(cv.string, vol.Length(min=1)),
        vol.Required("enabled"): cv.boolean,
        vol.Required("mode"): vol.In(["single", "restart", "queued", "parallel"]),
        vol.Required("graph"): {
            vol.Required("nodes"): [NODE_SCHEMA],
            vol.Required("edges"): [EDGE_SCHEMA],
        },
        vol.Required("config_hash"): vol.Any(None, cv.string),
    }
)


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_list_flows)
    websocket_api.async_register_command(hass, ws_save_flow)
    websocket_api.async_register_command(hass, ws_delete_flow)
    websocket_api.async_register_command(hass, ws_get_settings)
    websocket_api.async_register_command(hass, ws_set_settings)


@websocket_api.websocket_command({vol.Required("type"): "ha_flow_builder/flows/list"})
@websocket_api.require_admin
@callback
def ws_list_flows(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"flows": list(get_repository(hass).flows.values())})


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_flow_builder/flows/save", vol.Required("flow"): FLOW_SCHEMA}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_flow(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    flow = await get_repository(hass).async_upsert(msg["flow"])
    connection.send_result(msg["id"], {"flow": flow})


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_flow_builder/flows/delete", vol.Required("flow_id"): cv.string}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_flow(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not await get_repository(hass).async_delete(msg["flow_id"]):
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Flow not found")
        return
    connection.send_result(msg["id"], {"ok": True})


SETTINGS_SCHEMA = vol.Schema({vol.Optional("language"): vol.In(["auto", "nl", "en"])})


@websocket_api.websocket_command({vol.Required("type"): "ha_flow_builder/settings/get"})
@websocket_api.require_admin
@callback
def ws_get_settings(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"settings": get_repository(hass).settings})


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_flow_builder/settings/set", vol.Required("settings"): SETTINGS_SCHEMA}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_settings(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    settings = await get_repository(hass).async_update_settings(msg["settings"])
    connection.send_result(msg["id"], {"settings": settings})
