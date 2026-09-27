"""Actions provided by Flowey for use in compiled flows."""

from __future__ import annotations

from urllib.parse import urlsplit

import aiohttp
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import homeassistant.helpers.config_validation as cv
import voluptuous as vol

from .const import DOMAIN

SERVICE_CALL_WEBHOOK = "call_webhook"
METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
MAX_RESPONSE_BODY = 10_000

CALL_WEBHOOK_SCHEMA = vol.Schema(
    {
        vol.Required("url"): vol.All(
            cv.string, vol.Match(r"^https?://", msg="URL must start with http:// or https://")
        ),
        vol.Optional("method", default="POST"): vol.All(vol.Upper, vol.In(METHODS)),
        vol.Optional("headers", default={}): {cv.string: cv.string},
        # A string is sent as-is; a mapping or list is sent as JSON.
        vol.Optional("payload"): vol.Any(cv.string, dict, list),
        vol.Optional("timeout", default=10): vol.All(vol.Coerce(float), vol.Range(min=1, max=120)),
        vol.Optional("verify_ssl", default=True): cv.boolean,
    }
)


def async_register(hass: HomeAssistant) -> None:
    async def call_webhook(call: ServiceCall) -> ServiceResponse:
        data = call.data
        method = data["method"]
        session = async_get_clientsession(hass, verify_ssl=data["verify_ssl"])
        kwargs: dict = {"headers": data["headers"], "timeout": aiohttp.ClientTimeout(total=data["timeout"])}
        payload = data.get("payload")
        if isinstance(payload, (dict, list)):
            kwargs["json"] = payload
        elif payload is not None and payload != "":
            kwargs["data"] = payload.encode()

        try:
            async with session.request(method, data["url"], **kwargs) as response:
                body = await response.text(errors="replace")
        except (aiohttp.ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                f"Webhook {method} {_redact(data['url'])} failed: {err or type(err).__name__}"
            ) from err

        if response.status >= 400:
            raise HomeAssistantError(
                f"Webhook {method} {_redact(data['url'])} returned HTTP {response.status}: {body[:200]}"
            )
        if call.return_response:
            return {"status": response.status, "body": body[:MAX_RESPONSE_BODY]}
        return None

    hass.services.async_register(
        DOMAIN,
        SERVICE_CALL_WEBHOOK,
        call_webhook,
        schema=CALL_WEBHOOK_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )


def _redact(url: str) -> str:
    """Drop the query string from logged URLs; it may contain tokens."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"
