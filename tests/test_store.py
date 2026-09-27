"""Tests for the flow repository and its storage migration."""

from __future__ import annotations

from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant

from custom_components.ha_flow_builder.const import STORAGE_KEY, STORAGE_VERSION
from custom_components.ha_flow_builder.store import FlowRepository


def make_flow(flow_id: str = "flowey_1", **overrides: Any) -> dict[str, Any]:
    return {
        "id": flow_id,
        "name": "Hallway light",
        "enabled": True,
        "mode": "restart",
        "graph": {"nodes": [], "edges": []},
        "config_hash": None,
        **overrides,
    }


async def load_repository(hass: HomeAssistant) -> FlowRepository:
    repository = FlowRepository(hass)
    await repository.async_load()
    return repository


async def test_empty_store_uses_defaults(hass: HomeAssistant, hass_storage: dict[str, Any]) -> None:
    repository = await load_repository(hass)

    assert repository.flows == {}
    assert repository.settings == {"language": "auto"}


async def test_upsert_keeps_created_and_updates_timestamp(
    hass: HomeAssistant, hass_storage: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    repository = await load_repository(hass)

    freezer.move_to("2026-01-01T10:00:00+00:00")
    first = await repository.async_upsert(make_flow())
    freezer.move_to("2026-01-02T10:00:00+00:00")
    second = await repository.async_upsert(make_flow(name="Renamed"))

    assert first["created"] == second["created"] == "2026-01-01T10:00:00+00:00"
    assert second["updated"] == "2026-01-02T10:00:00+00:00"
    assert repository.flows["flowey_1"]["name"] == "Renamed"


async def test_changes_are_persisted(hass: HomeAssistant, hass_storage: dict[str, Any]) -> None:
    repository = await load_repository(hass)
    await repository.async_upsert(make_flow("flowey_1"))
    await repository.async_upsert(make_flow("flowey_2"))
    assert await repository.async_delete("flowey_1")
    await repository.async_update_settings({"language": "nl"})

    reloaded = await load_repository(hass)
    assert list(reloaded.flows) == ["flowey_2"]
    assert reloaded.settings == {"language": "nl"}
    assert hass_storage[STORAGE_KEY]["version"] == STORAGE_VERSION


async def test_delete_unknown_flow(hass: HomeAssistant, hass_storage: dict[str, Any]) -> None:
    repository = await load_repository(hass)

    assert not await repository.async_delete("missing")


async def test_migrates_v1_list_based_flows(hass: HomeAssistant, hass_storage: dict[str, Any]) -> None:
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": STORAGE_KEY,
        "data": {
            "flows": [
                {
                    "id": "old",
                    "name": "Old flow",
                    "enabled": False,
                    "trigger": {"entity_id": "binary_sensor.door", "to": "on"},
                    "conditions": [
                        {"type": "state", "entity_id": "sun.sun", "state": "below_horizon"},
                        {"type": "numeric_state", "entity_id": "sensor.lux", "below": 20},
                        {"type": "time", "after": "18:00", "before": "23:00"},
                    ],
                    "actions": [
                        {"type": "service", "service": "light.turn_on", "entity_id": "light.hall"},
                        {"type": "delay", "seconds": 5},
                    ],
                }
            ]
        },
    }

    flow = (await load_repository(hass)).flows["old"]
    assert flow["enabled"] is False
    assert flow["mode"] == "restart"
    assert flow["config_hash"] is None

    nodes = flow["graph"]["nodes"]
    assert [(n["type"], n["data"]["kind"]) for n in nodes] == [
        ("trigger", "state"),
        ("condition", "state"),
        ("condition", "numeric_state"),
        ("condition", "time"),
        ("action", "service"),
        ("action", "delay"),
    ]
    assert nodes[0]["data"] == {"kind": "state", "entity_id": "binary_sensor.door", "to": "on"}
    assert nodes[2]["data"] == {"kind": "numeric_state", "entity_id": "sensor.lux", "below": 20}
    assert nodes[4]["data"]["target"] == {"entity_id": "light.hall"}

    # A linear chain; conditions continue through their "yes" output.
    edges = flow["graph"]["edges"]
    assert [(e["source"], e["target"], e["sourceHandle"]) for e in edges] == [
        ("n1", "n2", "out"),
        ("n2", "n3", "yes"),
        ("n3", "n4", "yes"),
        ("n4", "n5", "yes"),
        ("n5", "n6", "out"),
    ]
