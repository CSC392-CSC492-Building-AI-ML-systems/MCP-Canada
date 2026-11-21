"use client";
/** An address input with Mapbox suggestions that keeps the chosen place's coordinates.
 * Unlike LocationSearch it is not a <form>, so it can sit inside another form. */
import { useEffect, useId, useRef, useState } from "react";
import { MAPBOX_TOKEN, newSessionToken, retrievePlace, suggestPlaces, type Suggestion } from "@/lib/mapbox";
import type { GeoPoint } from "@/components/workflow/state";
import styles from "./LocationSearch.module.css";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

type Props = {
  label: string; placeholder: string; text: string; point: GeoPoint | null;
  onChange: (text: string, point: GeoPoint | null) => void;
};

export default function AddressField({ label, placeholder, text, point, onChange }: Props) {
  const id = useId();
  const session = useRef(newSessionToken());
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = text.trim();
  const searching = !point && query.length >= MIN_QUERY_LENGTH && !!MAPBOX_TOKEN;

  useEffect(() => {
    if (!searching) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      suggestPlaces(query, session.current, abort.signal)
        .then(results => { setSuggestions(results); setActive(-1); setError(null); })
        .catch(() => { if (!abort.signal.aborted) setError("Address search is unavailable right now."); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, searching]);

  async function choose(s: Suggestion) {
    setOpen(false);
    try {
      const place = await retrievePlace(s.mapboxId, session.current);
      const [lng, lat] = place.coordinates;
      const label = !place.address ? place.name : place.address.startsWith(place.name) ? place.address : `${place.name}, ${place.address}`;
      onChange(label, { lng, lat });
      setError(null);
    } catch {
      setError("Couldn't load that address. Try another suggestion.");
    } finally {
      session.current = newSessionToken();
    }
  }

  const list = searching && open ? suggestions : [];
  const status = point ? "Location found. Travel times will be calculated."
    : !MAPBOX_TOKEN && query ? "Address search needs a Mapbox token, so travel times can't be calculated."
    : query ? "Choose a suggestion so travel times can be calculated." : "";
  return (
    <div><div className={styles.search}>
      <label htmlFor={`${id}-input`}>{label}
      <input id={`${id}-input`} value={text} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-expanded={list.length > 0} aria-controls={`${id}-list`} aria-describedby={`${id}-status`}
        aria-activedescendant={list.length && active >= 0 ? `${id}-${active}` : undefined}
        onChange={e => { onChange(e.target.value, null); setOpen(true); setError(null); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (!list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => (i + 1) % list.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => (i <= 0 ? list.length - 1 : i - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); choose(list[active >= 0 ? active : 0]); }
          else if (e.key === "Escape") setOpen(false);
        }} /></label>
      {list.length > 0 && <ul id={`${id}-list`} role="listbox" className={styles.list}>
        {list.map((s, i) => <li key={s.mapboxId} id={`${id}-${i}`} role="option" aria-selected={i === active} className={styles.option}
          onMouseDown={e => { e.preventDefault(); choose(s); }} onMouseEnter={() => setActive(i)}>
          <span className={styles.name}>{s.name}</span><span className={styles.detail}>{s.detail}</span>
        </li>)}
      </ul>}
    </div>
    <small id={`${id}-status`} aria-live="polite">{error ?? status}</small></div>
  );
}
