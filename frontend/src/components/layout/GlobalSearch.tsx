import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { search } from "../../api/client";
import type { SearchResult } from "../../types/contract";
import { useLatestRequest } from "../../lib/useLatestRequest";
import styles from "./GlobalSearch.module.css";

const KIND_LABEL: Record<SearchResult["kind"], string> = { tenant: "Resident", room: "Room", lead: "Enquiry" };

/** Topbar search across residents (name, phone, room), rooms and open enquiries.
 * Keyboard: ↑ ↓ to move, Enter to open, Esc to close. Press "/" anywhere to focus. */
export function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const begin = useLatestRequest();

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const isLatest = begin();
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      search(term)
        .then((r) => {
          if (!isLatest()) return;
          setResults(r);
          setActive(0);
        })
        .catch(() => isLatest() && setResults([]))
        .finally(() => isLatest() && setIsSearching(false));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, begin]);

  useEffect(() => {
    function onSlash(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  function go(result: SearchResult) {
    navigate(result.link);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      go(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showPanel = open && query.trim().length > 0;

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        className={styles.input}
        type="search"
        placeholder="Search residents, rooms, phone…  ( / )"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-label="Search residents, rooms and enquiries"
      />
      {showPanel && (
        <ul id="global-search-results" className={styles.panel} role="listbox">
          {results.length === 0 ? (
            <li className={styles.empty}>{isSearching ? "Searching…" : "No matches"}</li>
          ) : (
            results.map((r, i) => (
              <li
                key={`${r.kind}-${r.id}`}
                role="option"
                aria-selected={i === active}
                className={`${styles.result} ${i === active ? styles.active : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(r)}
                onMouseEnter={() => setActive(i)}
              >
                <span className={styles.kind}>{KIND_LABEL[r.kind]}</span>
                <span className={styles.text}>
                  <span className={styles.title}>{r.title}</span>
                  <span className={styles.subtitle}>{r.subtitle}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
