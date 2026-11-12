"use client";

import { useEffect, useId, useRef, useState } from "react";
import { newSessionToken, retrievePlace, suggestPlaces, type Place, type Suggestion } from "@/lib/mapbox";
import styles from "./LocationSearch.module.css";

export type LocalOption = { id: string; name: string; detail: string };

type Props = {
  onSelect: (place: Place) => void;
  // Loaded neighbourhoods, matched by name before Mapbox results.
  localOptions?: LocalOption[];
  onLocalSelect?: (id: string) => void;
};

type Option = { kind: "local"; option: LocalOption } | { kind: "mapbox"; suggestion: Suggestion };

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;
const MAX_LOCAL = 4;

export default function LocationSearch({ onSelect, localOptions = [], onLocalSelect }: Props) {
  const listId = useId();
  const sessionRef = useRef(newSessionToken());
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggestPlaces(query.trim(), sessionRef.current, controller.signal)
        .then((results) => {
          setSuggestions(results);
          setActiveIndex(-1);
          setError(null);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("Search is unavailable right now.");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const needle = query.trim().toLowerCase();
  const local: Option[] = needle.length >= 2 && onLocalSelect
    ? localOptions.filter((o) => o.name.toLowerCase().includes(needle)).slice(0, MAX_LOCAL).map((option) => ({ kind: "local", option }))
    : [];
  // Hide stale Mapbox results once the query is shortened below the minimum.
  const remote: Option[] = needle.length >= MIN_QUERY_LENGTH ? suggestions.map((suggestion) => ({ kind: "mapbox", suggestion })) : [];
  const options = [...local, ...remote];
  const showList = open && options.length > 0;

  async function choose(option: Option) {
    setOpen(false);
    if (option.kind === "local") {
      setQuery(option.option.name);
      onLocalSelect?.(option.option.id);
      setError(null);
      return;
    }
    setQuery(option.suggestion.name);
    try {
      const place = await retrievePlace(option.suggestion.mapboxId, sessionRef.current);
      onSelect(place);
      setError(null);
    } catch {
      setError("Couldn't load that location.");
    } finally {
      sessionRef.current = newSessionToken();
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (options.length) choose(options[activeIndex >= 0 ? activeIndex : 0]);
    else if (needle) setError("No matching place. Try a neighbourhood name or a Toronto address.");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <form role="search" className={styles.search} onSubmit={submit}>
      <div className={styles.field}>
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size local SVG icon */}
        <img src="/icons/search.svg" width={20} height={20} alt="" className={styles.icon} />
        <label htmlFor={`${listId}-input`} className={styles.srOnly}>
          Search a neighbourhood, address or building
        </label>
        <input
          id={`${listId}-input`}
          className={styles.input}
          type="search"
          placeholder="Search a neighbourhood, address or building"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
            setError(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className={styles.submit}>Search</button>
      </div>
      {showList && (
        <ul id={listId} role="listbox" className={styles.list}>
          {options.map((o, i) => (
            <li
              key={o.kind === "local" ? `local-${o.option.id}` : o.suggestion.mapboxId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={styles.option}
              // mousedown fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className={styles.name}>{o.kind === "local" ? o.option.name : o.suggestion.name}</span>
              <span className={styles.detail}>{o.kind === "local" ? o.option.detail : o.suggestion.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  );
}
