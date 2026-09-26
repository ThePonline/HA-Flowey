/** Loads the localized label of a device card (e.g. "Haldeur sensor geopend") in the app language. */
import { useEffect, useState } from "react";
import { cachedCardLabel, cardLabel, type CardType } from "../api/ha";
import { stableStringify } from "../compiler/compile";
import type { DeviceCard } from "../compiler/types";
import { useHass } from "../context";
import { useLang } from "../i18n";

export function useCardLabel(cardType: CardType, card: DeviceCard | undefined): string | undefined {
  const hass = useHass();
  const { lang } = useLang();
  const [label, setLabel] = useState(() => (card ? cachedCardLabel(lang, cardType, card) : undefined));
  const cardKey = card ? stableStringify(card) : "";

  useEffect(() => {
    if (!card) return setLabel(undefined);
    const cached = cachedCardLabel(lang, cardType, card);
    if (cached) return setLabel(cached);
    let cancelled = false;
    cardLabel(hass, lang, cardType, card).then(result => !cancelled && setLabel(result));
    return () => {
      cancelled = true;
    };
    // hass changes on every state update; the label only depends on language and card.
  }, [lang, cardType, cardKey]);

  return label;
}
