"use client";

import { useEffect, useId, useRef, useState } from "react";
import { newSessionToken, retrievePlace, suggestPlaces, type Place, type Suggestion } from "@/lib/mapbox";
import styles from "./LocationSearch.module.css";

type Props = {
  onSelect: (place: Place) => void;
};

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

export default function LocationSearch({ onSelect }: Props) {
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

  async function choose(suggestion: Suggestion) {
    setOpen(false);
    setQuery(suggestion.name);
    try {
      const place = await retrievePlace(suggestion.mapboxId, sessionRef.current);
      onSelect(place);
      setError(null);
    } catch {
      setError("Couldn't load that location.");
    } finally {
      sessionRef.current = newSessionToken();
    }
  }

  // Hide stale results once the query is shortened below the minimum.
  const showList = open && query.trim().length >= MIN_QUERY_LENGTH && suggestions.length > 0;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(suggestions[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={styles.search}>
      <label htmlFor={`${listId}-input`} className={styles.srOnly}>
        Search an address, place or neighbourhood
      </label>
      <input
        id={`${listId}-input`}
        className={styles.input}
        type="search"
        placeholder="Search an address, place or neighbourhood"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" className={styles.list}>
          {suggestions.map((s, i) => (
            <li
              key={s.mapboxId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={styles.option}
              // mousedown fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className={styles.name}>{s.name}</span>
              {s.detail && <span className={styles.detail}>{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
