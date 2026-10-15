"""Tests for learning and managing Broadlink remote buttons."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_flow_builder.remotes import BROADLINK_REMOTE_LOGGER

pytestmark = pytest.mark.usefixtures("mock_bundle_version", "setup_integration")

MAC = "a043b0b904a0"
ENTITY_ID = "remote.rm4_mini"
STORAGE_KEY = f"broadlink_remote_{MAC}_codes"
# Packets start with 0x26 (infrared) or 0xb2 (RF 433 MHz).
IR_CODE = "JgBQAAABKZQTEhM2EhMTNhI="
RF_CODE = "sgA8AQ0RDhEODg4RDREODg4R"


@pytest.fixture
def remote(hass: HomeAssistant) -> str:
    """A Broadlink remote entity, as the Broadlink integration registers it."""
    entry = MockConfigEntry(domain="broadlink", unique_id=MAC, title="RM4 mini")
    entry.add_to_hass(hass)
    er.async_get(hass).async_get_or_create(
        "remote", "broadlink", MAC, config_entry=entry, suggested_object_id="rm4_mini"
    )
    hass.states.async_set(ENTITY_ID, "on")
    return ENTITY_ID


async def save_codes(hass: HomeAssistant, codes: dict[str, Any]) -> None:
    await Store(hass, 1, STORAGE_KEY).async_save(codes)


def register_service(hass: HomeAssistant, service: str, handler: Any) -> list[ServiceCall]:
    calls: list[ServiceCall] = []

    async def wrapped(call: ServiceCall) -> None:
        calls.append(call)
        await handler(call)

    hass.services.async_register("remote", service, wrapped)
    return calls


async def ws(hass: HomeAssistant, hass_ws_client: Any, message: dict[str, Any]) -> dict[str, Any]:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(message)
    return await client.receive_json()


async def test_list_remotes_with_buttons(hass: HomeAssistant, hass_ws_client: Any, remote: str) -> None:
    await save_codes(hass, {"tv": {"aan": IR_CODE}, "Lamp": {"aan": [RF_CODE, RF_CODE]}})

    response = await ws(hass, hass_ws_client, {"type": "ha_flow_builder/remotes/list"})

    assert response["result"] == {
        "remotes": [
            {
                "entity_id": remote,
                "buttons": [
                    {"device": "Lamp", "command": "aan", "type": "rf", "toggle": True},
                    {"device": "tv", "command": "aan", "type": "ir", "toggle": False},
                ],
            }
        ]
    }


async def test_learn_button(hass: HomeAssistant, hass_ws_client: Any, remote: str) -> None:
    async def learn(call: ServiceCall) -> None:
        await save_codes(hass, {call.data["device"]: {call.data["command"][0]: RF_CODE}})

    calls = register_service(hass, "learn_command", learn)

    response = await ws(
        hass,
        hass_ws_client,
        {
            "type": "ha_flow_builder/remotes/learn",
            "entity_id": remote,
            "device": " Woonkamer ",
            "command": "lamp aan",
            "command_type": "rf",
        },
    )

    assert response["result"] == {
        "learned": True,
        "button": {"device": "Woonkamer", "command": "lamp aan", "type": "rf", "toggle": False},
    }
    assert calls[0].data == {
        "entity_id": remote,
        "device": "Woonkamer",
        "command": ["lamp aan"],
        "command_type": "rf",
    }


async def test_learn_timeout_is_reported(hass: HomeAssistant, hass_ws_client: Any, remote: str) -> None:
    async def learn(call: ServiceCall) -> None:
        # What the Broadlink remote does when nobody presses a button.
        logging.getLogger(BROADLINK_REMOTE_LOGGER).error(
            "Failed to learn '%s': %s", "lamp aan", "No infrared code received within 30.0 seconds"
        )

    register_service(hass, "learn_command", learn)

    response = await ws(
        hass,
        hass_ws_client,
        {"type": "ha_flow_builder/remotes/learn", "entity_id": remote, "device": "tv", "command": "lamp aan"},
    )

    assert response["result"]["learned"] is False
    assert response["result"]["reason"] == "timeout"
    assert "No infrared code received" in response["result"]["message"]


async def test_learn_without_new_code(hass: HomeAssistant, hass_ws_client: Any, remote: str) -> None:
    """Also when Broadlink's logging is silenced, an unchanged code counts as a failure."""
    await save_codes(hass, {"tv": {"aan": IR_CODE}})

    async def learn(call: ServiceCall) -> None:
        return None

    register_service(hass, "learn_command", learn)

    response = await ws(
        hass,
        hass_ws_client,
        {"type": "ha_flow_builder/remotes/learn", "entity_id": remote, "device": "tv", "command": "aan"},
    )

    assert response["result"]["reason"] == "no_code"


async def test_learn_on_turned_off_remote(hass: HomeAssistant, hass_ws_client: Any, remote: str) -> None:
    hass.states.async_set(remote, "off")

    response = await ws(
        hass,
        hass_ws_client,
        {"type": "ha_flow_builder/remotes/learn", "entity_id": remote, "device": "tv", "command": "aan"},
    )

    assert response["result"]["reason"] == "turned_off"


async def test_learn_service_error(hass: HomeAssistant, hass_ws_client: Any, remote: str) -> None:
    async def learn(call: ServiceCall) -> None:
        raise HomeAssistantError("remote.rm4_mini doesn't support learning RF commands")

    register_service(hass, "learn_command", learn)

    response = await ws(
        hass,
        hass_ws_client,
        {
            "type": "ha_flow_builder/remotes/learn",
            "entity_id": remote,
            "device": "tv",
            "command": "aan",
            "command_type": "rf",
        },
    )

    assert response["result"]["reason"] == "rf_unsupported"


async def test_learn_rejects_other_entities(hass: HomeAssistant, hass_ws_client: Any) -> None:
    hass.states.async_set("remote.other", "on")

    response = await ws(
        hass,
        hass_ws_client,
        {"type": "ha_flow_builder/remotes/learn", "entity_id": "remote.other", "device": "tv", "command": "aan"},
    )

    assert response["error"]["code"] == "not_found"


async def test_delete_hides_button_until_saved(hass: HomeAssistant, hass_ws_client: Any, remote: str) -> None:
    await save_codes(hass, {"tv": {"aan": IR_CODE, "uit": IR_CODE}})

    async def delete(call: ServiceCall) -> None:
        # Broadlink writes the deletion only after a delay.
        return None

    calls = register_service(hass, "delete_command", delete)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "ha_flow_builder/remotes/delete", "entity_id": remote, "device": "tv", "command": "aan"}
    )
    assert (await client.receive_json())["result"] == {"ok": True}
    assert calls[0].data["command"] == ["aan"]

    await client.send_json_auto_id({"type": "ha_flow_builder/remotes/list"})
    buttons = (await client.receive_json())["result"]["remotes"][0]["buttons"]
    assert [button["command"] for button in buttons] == ["uit"]
