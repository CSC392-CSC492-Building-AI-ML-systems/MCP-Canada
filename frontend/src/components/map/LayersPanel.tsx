"use client";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./HousingMap.module.css";

export type LayerItem = {
  id: string; label: string; checked: boolean; onChange: () => void;
  /** Short help shown under the label. */
  hint?: string; swatch?: string; disabled?: boolean;
};
/** `counted`: whether the button's count includes this group (data layers, not basemap settings). */
export type LayerGroup = { title: string; items: LayerItem[]; counted?: boolean };

/** One "Layers" button that opens grouped checkboxes, instead of a row of chips over the map.
 * Closes on Escape (returning focus to the button) or a click outside. */
export function LayersPanel({ groups }: { groups: LayerGroup[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const on = groups.filter((g) => g.counted).flatMap((g) => g.items).filter((i) => i.checked && !i.disabled).length;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className={styles.layers} ref={root}>
    <button type="button" ref={button} className={styles.layersButton} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M8 1.5 1.5 5 8 8.5 14.5 5 8 1.5Zm-5.2 6.1L1.5 8.3 8 11.8l6.5-3.5-1.3-.7L8 10.4 2.8 7.6Zm0 3.3-1.3.7L8 15.1l6.5-3.5-1.3-.7L8 13.7l-5.2-2.8Z" fill="currentColor" /></svg>
      Layers{on > 0 && <span className={styles.layersCount} aria-label={`${on} data ${on === 1 ? "layer" : "layers"} on`}>{on}</span>}
    </button>
    <div id={panelId} className={styles.layersPanel} hidden={!open} role="group" aria-label="Map layers">
      {groups.map((group) => <fieldset key={group.title}>
        <legend>{group.title}</legend>
        {group.items.map((item) => <label key={item.id} className={item.disabled ? styles.layerDisabled : undefined}>
          <input type="checkbox" checked={item.checked && !item.disabled} disabled={item.disabled} onChange={item.onChange} />
          {item.swatch && <span className={styles.layerSwatch} style={{ background: item.swatch }} aria-hidden="true" />}
          <span><span className={styles.layerLabel}>{item.label}</span>{item.hint && <span className={styles.layerHint}>{item.hint}</span>}</span>
        </label>)}
      </fieldset>)}
      <p className={styles.layersNote}>The basemap and nearby places show the present day. Census data follows the timeline.</p>
    </div>
  </div>;
}
