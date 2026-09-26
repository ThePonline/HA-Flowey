import { createContext, useContext } from "react";
import type { Hass } from "./api/ha";
import type { CompileIssue } from "./compiler/types";

export const HassContext = createContext<Hass | null>(null);

export function useHass(): Hass {
  const hass = useContext(HassContext);
  if (!hass) throw new Error("hass not available");
  return hass;
}

/** Compile errors per node id, used to highlight cards on the canvas. */
export const IssuesContext = createContext<Map<string, CompileIssue[]>>(new Map());

/** Shows a Home Assistant toast. `origin` must be an element inside the panel. */
export function toast(origin: Element | null, message: string): void {
  origin?.dispatchEvent(new CustomEvent("hass-notification", { bubbles: true, composed: true, detail: { message } }));
}
