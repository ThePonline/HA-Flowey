/** Card palette: drag onto the canvas, or tap to add after the selected card. */
import { useT } from "../i18n";
import { CATALOG, type CatalogItem } from "../nodes/catalog";

export const DRAG_MIME = "application/x-flowey-card";

export function Palette({ onAdd, open }: { onAdd: (item: CatalogItem) => void; open: boolean }) {
  const t = useT();
  return (
    <aside className={`palette ${open ? "open" : ""}`}>
      {CATALOG.map(group => (
        <section key={group.title} className={`palette-group type-${group.type}`}>
          <h3>{t(group.title)}</h3>
          {group.items.map(item => (
            <button
              type="button"
              key={item.key}
              className="palette-item"
              draggable
              onDragStart={event => {
                event.dataTransfer.setData(DRAG_MIME, item.key);
                event.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onAdd(item)}
              title={t(item.hint)}
            >
              <span className="palette-icon">{item.icon}</span>
              <span className="palette-text">
                <span>{t(item.title)}</span>
                <small>{t(item.hint)}</small>
              </span>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}
