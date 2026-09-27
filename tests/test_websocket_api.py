"""Tests for the websocket commands used by the panel."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
import pytest

from .test_store import make_flow

pytestmark = pytest.mark.usefixtures("mock_bundle_version", "setup_integration")


async def test_flow_lifecycle(hass: HomeAssistant, hass_ws_client: Any) -> None:
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ha_flow_builder/flows/list"})
    assert (await client.receive_json())["result"] == {"flows": []}

    await client.send_json_auto_id({"type": "ha_flow_builder/flows/save", "flow": make_flow()})
    saved = (await client.receive_json())["result"]["flow"]
    assert saved["name"] == "Hallway light"
    assert "created" in saved

    await client.send_json_auto_id({"type": "ha_flow_builder/flows/list"})
    assert [f["id"] for f in (await client.receive_json())["result"]["flows"]] == ["flowey_1"]

    await client.send_json_auto_id({"type": "ha_flow_builder/flows/delete", "flow_id": "flowey_1"})
    assert (await client.receive_json())["result"] == {"ok": True}

    await client.send_json_auto_id({"type": "ha_flow_builder/flows/delete", "flow_id": "flowey_1"})
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "not_found"


async def test_save_keeps_node_data(hass: HomeAssistant, hass_ws_client: Any) -> None:
    graph = {
        "nodes": [
            {"id": "n1", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"kind": "time", "at": "07:00"}},
            {"id": "n2", "type": "action", "position": {"x": 320, "y": 0}, "data": {"kind": "delay", "seconds": 5}},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2", "sourceHandle": "out"}],
    }
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "ha_flow_builder/flows/save", "flow": make_flow(graph=graph)})
    saved = (await client.receive_json())["result"]["flow"]

    assert saved["graph"]["nodes"][0]["data"] == {"kind": "time", "at": "07:00"}
    assert saved["graph"]["edges"][0]["sourceHandle"] == "out"


def node(**overrides: Any) -> dict[str, Any]:
    return {"id": "n1", "type": "action", "position": {"x": 0, "y": 0}, "data": {"kind": "delay"}, **overrides}


@pytest.mark.parametrize(
    "overrides",
    [
        {"id": "no spaces/slashes"},
        {"name": ""},
        {"mode": "sometimes"},
        {"graph": {"nodes": [node(type="banana")], "edges": []}},
        {"graph": {"nodes": [node(data={})], "edges": []}},
    ],
)
async def test_save_rejects_invalid_flows(hass: HomeAssistant, hass_ws_client: Any, overrides: dict) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "ha_flow_builder/flows/save", "flow": make_flow(**overrides)})
    response = await client.receive_json()

    assert response["success"] is False
    assert response["error"]["code"] == "invalid_format"


async def test_settings(hass: HomeAssistant, hass_ws_client: Any) -> None:
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ha_flow_builder/settings/get"})
    assert (await client.receive_json())["result"] == {"settings": {"language": "auto"}}

    await client.send_json_auto_id({"type": "ha_flow_builder/settings/set", "settings": {"language": "en"}})
    assert (await client.receive_json())["result"] == {"settings": {"language": "en"}}

    await client.send_json_auto_id({"type": "ha_flow_builder/settings/set", "settings": {"language": "fr"}})
    assert (await client.receive_json())["success"] is False


@pytest.mark.parametrize(
    "message",
    [
        {"type": "ha_flow_builder/flows/list"},
        {"type": "ha_flow_builder/flows/save", "flow": make_flow()},
        {"type": "ha_flow_builder/flows/delete", "flow_id": "flowey_1"},
        {"type": "ha_flow_builder/settings/get"},
        {"type": "ha_flow_builder/settings/set", "settings": {"language": "nl"}},
    ],
)
async def test_commands_require_admin(
    hass: HomeAssistant, hass_ws_client: Any, hass_read_only_access_token: str, message: dict
) -> None:
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id(message)
    response = await client.receive_json()

    assert response["success"] is False
    assert response["error"]["code"] == "unauthorized"
