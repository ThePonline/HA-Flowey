"""Persistent storage of flow graphs (canvas layout + node configuration).

The executable automation itself lives in Home Assistant's automations.yaml;
this store only keeps what is needed to draw and edit the flow visually.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN, STORAGE_KEY, STORAGE_VERSION

NODE_SPACING_X = 320


class FlowStore(Store[dict[str, Any]]):
    """Store with migration from the v0.4 list-based flow format."""

    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: dict[str, Any]
    ) -> dict[str, Any]:
        if old_major_version < 2:
            return {"flows": [_migrate_v1_flow(flow) for flow in old_data.get("flows", [])]}
        return old_data


def _migrate_v1_flow(flow: dict[str, Any]) -> dict[str, Any]:
    """Convert a v0.4 flow (trigger + conditions + actions) into a linear graph."""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    def add(node_type: str, data: dict[str, Any]) -> None:
        node_id = f"n{len(nodes) + 1}"
        if nodes:
            source = nodes[-1]
            edges.append(
                {
                    "id": f"e{len(edges) + 1}",
                    "source": source["id"],
                    "sourceHandle": "yes" if source["type"] == "condition" else "out",
                    "target": node_id,
                }
            )
        nodes.append(
            {
                "id": node_id,
                "type": node_type,
                "position": {"x": len(nodes) * NODE_SPACING_X, "y": 0},
                "data": data,
            }
        )

    trigger = flow.get("trigger") or {}
    trigger_data: dict[str, Any] = {"kind": "state", "entity_id": trigger.get("entity_id", "")}
    if trigger.get("to"):
        trigger_data["to"] = trigger["to"]
    if trigger.get("from"):
        trigger_data["from"] = trigger["from"]
    add("trigger", trigger_data)

    for condition in flow.get("conditions", []):
        ctype = condition.get("type")
        if ctype == "state":
            add(
                "condition",
                {"kind": "state", "entity_id": condition.get("entity_id", ""), "state": condition.get("state", "")},
            )
        elif ctype == "numeric_state":
            data = {"kind": "numeric_state", "entity_id": condition.get("entity_id", "")}
            for key in ("above", "below"):
                if condition.get(key) is not None:
                    data[key] = condition[key]
            add("condition", data)
        elif ctype == "time":
            add(
                "condition",
                {"kind": "time", "after": condition.get("after", "00:00"), "before": condition.get("before", "23:59")},
            )

    for action in flow.get("actions", []):
        if action.get("type") == "delay":
            add("action", {"kind": "delay", "seconds": action.get("seconds", 1)})
        elif action.get("type") == "service":
            data = {"kind": "service", "service": action.get("service", ""), "data": action.get("data") or {}}
            if action.get("entity_id"):
                data["target"] = {"entity_id": action["entity_id"]}
            add("action", data)

    now = dt_util.utcnow().isoformat()
    return {
        "id": flow["id"],
        "name": flow.get("name", "Flow"),
        "enabled": flow.get("enabled", True),
        "mode": "restart",
        "graph": {"nodes": nodes, "edges": edges},
        # Not yet published as a native automation.
        "config_hash": None,
        "created": now,
        "updated": now,
    }


DEFAULT_SETTINGS: dict[str, Any] = {"language": "auto"}


class FlowRepository:
    """In-memory cache of all flows and panel settings, persisted through FlowStore."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store = FlowStore(hass, STORAGE_VERSION, STORAGE_KEY)
        self.flows: dict[str, dict[str, Any]] = {}
        self.settings: dict[str, Any] = dict(DEFAULT_SETTINGS)

    async def async_load(self) -> None:
        stored = await self._store.async_load() or {}
        self.flows = {flow["id"]: flow for flow in stored.get("flows", [])}
        self.settings = {**DEFAULT_SETTINGS, **stored.get("settings", {})}

    async def async_update_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        self.settings = {**self.settings, **settings}
        await self._async_save()
        return self.settings

    async def async_upsert(self, flow: dict[str, Any]) -> dict[str, Any]:
        now = dt_util.utcnow().isoformat()
        existing = self.flows.get(flow["id"])
        flow = {**flow, "created": existing["created"] if existing else now, "updated": now}
        self.flows[flow["id"]] = flow
        await self._async_save()
        return flow

    async def async_delete(self, flow_id: str) -> bool:
        if self.flows.pop(flow_id, None) is None:
            return False
        await self._async_save()
        return True

    async def _async_save(self) -> None:
        await self._store.async_save({"flows": list(self.flows.values()), "settings": self.settings})


def get_repository(hass: HomeAssistant) -> FlowRepository:
    return hass.data[DOMAIN]["repository"]
