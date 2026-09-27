"""Tests for the call_webhook action."""

from __future__ import annotations

from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
import pytest
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker
import voluptuous as vol

from custom_components.ha_flow_builder import services
from custom_components.ha_flow_builder.const import DOMAIN

URL = "https://webhook.homey.app/abc/lights_on"


@pytest.fixture(autouse=True)
def register_services(hass: HomeAssistant) -> None:
    services.async_register(hass)


async def call(hass: HomeAssistant, return_response: bool = False, **data: Any) -> Any:
    return await hass.services.async_call(
        DOMAIN, services.SERVICE_CALL_WEBHOOK, data, blocking=True, return_response=return_response
    )


async def test_post_json_payload(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.post(URL, text="ok")

    response = await call(hass, return_response=True, url=URL, payload={"room": "hall"}, headers={"X-Key": "1"})

    assert response == {"status": 200, "body": "ok"}
    method, url, body, headers = aioclient_mock.mock_calls[0]
    assert (method, str(url)) == ("POST", URL)
    assert body == {"room": "hall"}
    assert headers == {"X-Key": "1"}


async def test_text_payload_and_method(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.put(URL, text="")

    await call(hass, url=URL, method="put", payload="on")

    method, _, body, _ = aioclient_mock.mock_calls[0]
    assert method == "PUT"
    assert body == b"on"


async def test_empty_payload_sends_no_body(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(URL, text="")

    await call(hass, url=URL, method="GET", payload="")

    assert aioclient_mock.mock_calls[0][2] is None


async def test_long_body_is_truncated(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.post(URL, text="x" * (services.MAX_RESPONSE_BODY + 50))

    response = await call(hass, return_response=True, url=URL)

    assert len(response["body"]) == services.MAX_RESPONSE_BODY


async def test_http_error_redacts_query(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.post(f"{URL}?token=secret", status=500, text="boom")

    with pytest.raises(HomeAssistantError) as err:
        await call(hass, url=f"{URL}?token=secret")

    assert "HTTP 500" in str(err.value)
    assert "boom" in str(err.value)
    assert "secret" not in str(err.value)


@pytest.mark.parametrize("exc", [aiohttp.ClientError(), TimeoutError()])
async def test_connection_errors(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, exc: Exception) -> None:
    aioclient_mock.post(URL, exc=exc)

    with pytest.raises(HomeAssistantError, match="failed"):
        await call(hass, url=URL)


@pytest.mark.parametrize(
    "data",
    [
        {"url": "ftp://example.com"},
        {"url": URL, "method": "TRACE"},
        {"url": URL, "timeout": 500},
    ],
)
async def test_invalid_input(hass: HomeAssistant, data: dict) -> None:
    with pytest.raises(vol.Invalid):
        await call(hass, **data)


def test_redact() -> None:
    assert services._redact("https://user@host:8123/path?token=x#frag") == "https://user@host:8123/path"
