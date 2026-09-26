/** Loads the localized label of a device card (e.g. "Haldeur sensor geopend") in the app language. */
import { useEffect, useState } from "react";
import { cachedCardLabelParts, cardLabelParts, formatCardLabel, type CardLabelParts, type CardType } from "../api/ha";
import { stableStringify } from "../compiler/compile";
import type { DeviceCard } from "../compiler/types";
import { useHass } from "../context";
import { useLang } from "../i18n";

export function useCardLabel(cardType: CardType, card: DeviceCard | undefined): string | undefined {
  const hass = useHass();
  const { lang } = useLang();
  const [parts, setParts] = useState<CardLabelParts | undefined>(() =>
    card ? cachedCardLabelParts(lang, cardType, card) : undefined);
  const cardKey = card ? stableStringify(card) : "";

  useEffect(() => {
    if (!card) return setParts(undefined);
    const cached = cachedCardLabelParts(lang, cardType, card);
    if (cached) return setParts(cached);
    let cancelled = false;
    cardLabelParts(hass, lang, cardType, card).then(result => !cancelled && setParts(result));
    return () => {
      cancelled = true;
    };
    // hass changes on every state update; the parts only depend on language and card.
  }, [lang, cardType, cardKey]);

  // Formatting uses the current hass, so a renamed device or entity shows up immediately.
  return parts ? formatCardLabel(hass, parts) : undefined;
}
