"""Learning, listing and deleting buttons of Broadlink remotes (infrared / RF).

The codes stay in the Broadlink integration's own storage. Compiled flows send them with
the native remote.send_command action, so they keep working without Flowey.
"""

from __future__ import annotations

import base64
import binascii
import logging
import time
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.storage import Store
import voluptuous as vol

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

BROADLINK = "broadlink"
# The Broadlink remote logs, instead of raising, when learning a button fails (e.g. a timeout).
BROADLINK_REMOTE_LOGGER = "homeassistant.components.broadlink.remote"
BROADLINK_CODE_STORAGE_VERSION = 1
# Broadlink saves deletions with a delay (15 s); deleted buttons stay hidden until then.
DELETE_GRACE_SECONDS = 30
# First byte of a Broadlink packet: 0x26 infrared, 0xb2 RF 433 MHz, 0xd7 RF 315 MHz.
PACKET_TYPES = {0x26: "ir", 0xB2: "rf", 0xD7: "rf"}

NAME = vol.All(cv.string, vol.Strip, vol.Length(min=1, max=100))


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_list_remotes)
    websocket_api.async_register_command(hass, ws_learn_button)
    websocket_api.async_register_command(hass, ws_delete_button)


def _remote_entries(hass: HomeAssistant) -> list[er.RegistryEntry]:
    return [
        entry
        for entry in er.async_get(hass).entities.values()
        if entry.platform == BROADLINK and entry.domain == "remote" and not entry.disabled
    ]


def _remote_entry(hass: HomeAssistant, entity_id: str) -> er.RegistryEntry | None:
    entry = er.async_get(hass).async_get(entity_id)
    if entry is None or entry.platform != BROADLINK or entry.domain != "remote":
        return None
    return entry


async def _async_load_codes(hass: HomeAssistant, entry: er.RegistryEntry) -> dict[str, dict[str, Any]]:
    """Codes per device per command, read from the Broadlink integration's storage."""
    config_entry = hass.config_entries.async_get_entry(entry.config_entry_id) if entry.config_entry_id else None
    if config_entry is None or not config_entry.unique_id:
        return {}
    store: Store[dict[str, dict[str, Any]]] = Store(
        hass, BROADLINK_CODE_STORAGE_VERSION, f"broadlink_remote_{config_entry.unique_id}_codes"
    )
    return await store.async_load() or {}


def _code_type(code: Any) -> str | None:
    """Infrared ("ir") or radio ("rf"); a toggle button stores a list of two codes."""
    first = code[0] if isinstance(code, list) and code else code
    if not isinstance(first, str):
        return None
    try:
        packet = base64.b64decode(first[:8])
    except binascii.Error, ValueError:
        return None
    return PACKET_TYPES.get(packet[0]) if packet else None


def _button(device: str, command: str, code: Any) -> dict[str, Any]:
    return {"device": device, "command": command, "type": _code_type(code), "toggle": isinstance(code, list)}


def _deleted(hass: HomeAssistant) -> dict[tuple[str, str, str], float]:
    """Recently deleted buttons (entity_id, device, command) → deletion time."""
    deleted: dict[tuple[str, str, str], float] = hass.data[DOMAIN].setdefault("deleted_buttons", {})
    now = time.monotonic()
    for key in [key for key, at in deleted.items() if now - at > DELETE_GRACE_SECONDS]:
        del deleted[key]
    return deleted


@websocket_api.websocket_command({vol.Required("type"): "ha_flow_builder/remotes/list"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list_remotes(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    deleted = _deleted(hass)
    remotes = []
    for entry in _remote_entries(hass):
        codes = await _async_load_codes(hass, entry)
        buttons = [
            _button(device, command, code)
            for device, commands in codes.items()
            if isinstance(commands, dict)
            for command, code in commands.items()
            if (entry.entity_id, device, command) not in deleted
        ]
        buttons.sort(key=lambda button: (button["device"].lower(), button["command"].lower()))
        remotes.append({"entity_id": entry.entity_id, "buttons": buttons})
    connection.send_result(msg["id"], {"remotes": remotes})


class _LearnErrors(logging.Handler):
    """Collects the warnings/errors the Broadlink remote logs about one learn attempt."""

    def __init__(self, entity_id: str, command: str) -> None:
        super().__init__(logging.WARNING)
        self.markers = (entity_id, f"'{command}'")
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        message = record.getMessage()
        if any(marker in message for marker in self.markers):
            self.messages.append(message)


def _failure_reason(message: str) -> str:
    if "turned off" in message:
        return "turned_off"
    if "support learning RF" in message:
        return "rf_unsupported"
    if "within" in message:
        return "timeout"
    return "error"


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_flow_builder/remotes/learn",
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("device"): NAME,
        vol.Required("command"): NAME,
        vol.Optional("command_type", default="ir"): vol.In(["ir", "rf"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_learn_button(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Puts the remote in learning mode and waits until a button was pressed (or the attempt failed)."""
    entity_id, device, command = msg["entity_id"], msg["device"], msg["command"]
    entry = _remote_entry(hass, entity_id)
    if entry is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, f"{entity_id} is not a Broadlink remote")
        return

    def failed(reason: str, message: str) -> None:
        _LOGGER.warning("Learning '%s' (%s) on %s failed: %s", command, device, entity_id, message)
        connection.send_result(msg["id"], {"learned": False, "reason": reason, "message": message})

    state = hass.states.get(entity_id)
    if state is None or state.state == "unavailable":
        failed("unavailable", f"{entity_id} is unavailable")
        return
    if state.state == "off":
        failed("turned_off", f"{entity_id} is turned off")
        return

    before = (await _async_load_codes(hass, entry)).get(device, {}).get(command)
    errors = _LearnErrors(entity_id, command)
    logger = logging.getLogger(BROADLINK_REMOTE_LOGGER)
    logger.addHandler(errors)
    try:
        await hass.services.async_call(
            "remote",
            "learn_command",
            {"entity_id": entity_id, "device": device, "command": [command], "command_type": msg["command_type"]},
            blocking=True,
        )
    except (HomeAssistantError, vol.Invalid, ValueError) as err:
        errors.messages.append(str(err))
    finally:
        logger.removeHandler(errors)

    if errors.messages:
        message = "; ".join(errors.messages)
        failed(_failure_reason(message), message)
        return
    after = (await _async_load_codes(hass, entry)).get(device, {}).get(command)
    if after is None or after == before:
        failed("no_code", "No new code was stored")
        return

    _deleted(hass).pop((entity_id, device, command), None)
    button = _button(device, command, after)
    _LOGGER.info("Learned %s button '%s' (%s) on %s", button["type"] or "unknown", command, device, entity_id)
    connection.send_result(msg["id"], {"learned": True, "button": button})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_flow_builder/remotes/delete",
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("device"): NAME,
        vol.Required("command"): NAME,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_button(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    entity_id, device, command = msg["entity_id"], msg["device"], msg["command"]
    if _remote_entry(hass, entity_id) is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, f"{entity_id} is not a Broadlink remote")
        return
    state = hass.states.get(entity_id)
    if state is None or state.state in ("off", "unavailable"):
        # Broadlink silently ignores the deletion then.
        connection.send_error(msg["id"], "remote_off", f"{entity_id} is turned off or unavailable")
        return
    try:
        await hass.services.async_call(
            "remote",
            "delete_command",
            {"entity_id": entity_id, "device": device, "command": [command]},
            blocking=True,
        )
    except (HomeAssistantError, vol.Invalid, ValueError) as err:
        connection.send_error(msg["id"], "delete_failed", str(err))
        return
    _deleted(hass)[(entity_id, device, command)] = time.monotonic()
    connection.send_result(msg["id"], {"ok": True})
