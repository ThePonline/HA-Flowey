/** Entry point: the <ha-flow-builder-panel> custom element that Home Assistant mounts. */
import { createRoot, type Root } from "react-dom/client";
import flowStyles from "@xyflow/react/dist/style.css?inline";
import type { Hass } from "./api/ha";
import { App } from "./App";
import { HassContext } from "./context";
import panelStyles from "./styles.css?inline";

class HaFlowBuilderPanel extends HTMLElement {
  private root?: Root;
  private _hass?: Hass;
  private _narrow = false;

  set hass(hass: Hass) {
    this._hass = hass;
    this.update();
  }

  set narrow(narrow: boolean) {
    this._narrow = narrow;
    this.update();
  }

  connectedCallback(): void {
    if (!this.root) {
      // The panel lives inside HA's shadow DOM, so document styles do not reach it.
      const style = document.createElement("style");
      style.textContent = `${flowStyles}\n${panelStyles}`;
      const container = document.createElement("div");
      container.className = "flowey";
      this.replaceChildren(style, container);
      this.root = createRoot(container);
    }
    this.update();
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = undefined;
  }

  private update(): void {
    if (!this.root || !this._hass) return;
    this.root.render(
      <HassContext.Provider value={this._hass}>
        <App narrow={this._narrow} />
      </HassContext.Provider>,
    );
  }
}

if (!customElements.get("ha-flow-builder-panel")) {
  customElements.define("ha-flow-builder-panel", HaFlowBuilderPanel);
}
