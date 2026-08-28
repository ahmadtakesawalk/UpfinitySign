// DEPLOY TO: components/FaqLibrary.tsx
"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";
import type { FaqCategory } from "@/lib/content/faq-data";

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} style={{ background: "var(--accent-soft)", color: "var(--accent-dark)", padding: "0 2px", borderRadius: 2 }}>{part}</mark>
    ) : (
      part
    )
  );
}

export function FaqLibrary({ categories }: { categories: FaqCategory[] }) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.name ?? "");
  const reduceMotion = useReducedMotion();

  // Searching overrides category browsing — a real doc library shows
  // matches across everything the moment you type, rather than making
  // you first guess which category your question lives in.
  const isSearching = query.trim().length > 0;

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = query.toLowerCase();
    const results: { category: string; q: string; bullets: string[] }[] = [];
    for (const cat of categories) {
      for (const entry of cat.entries) {
        const matches = entry.q.toLowerCase().includes(q) || entry.bullets.some((b) => b.toLowerCase().includes(q));
        if (matches) results.push({ category: cat.name, q: entry.q, bullets: entry.bullets });
      }
    }
    return results;
  }, [categories, query, isSearching]);

  const activeCat = categories.find((c) => c.name === activeCategory);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the FAQ…"
        style={{ width: "100%", marginBottom: 24, fontSize: 15, padding: "12px 16px" }}
        autoFocus
      />

      {isSearching ? (
        <div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for "{query}"
          </p>
          {searchResults.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              No matches — try Contact Upfinity in Settings if you can't find what you're looking for.
            </p>
          )}
          {searchResults.map((r, i) => (
            <details className="faq-item" key={i} open>
              <summary>
                {highlight(r.q, query)}
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginLeft: 8 }}>{r.category}</span>
              </summary>
              <ul style={{ marginTop: 10, fontSize: 14 }}>
                {r.bullets.map((b, j) => <li key={j}>{highlight(b, query)}</li>)}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 32 }}>
          <nav style={{ width: 200, flexShrink: 0, position: "relative" }}>
            {categories.map((cat) => {
              const active = cat.name === activeCategory;
              return (
                <button
                  key={cat.name}
                  onClick={() => setActiveCategory(cat.name)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    marginBottom: 2,
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    position: "relative",
                    background: "transparent",
                    color: active ? "var(--accent-dark)" : "var(--text-secondary)",
                    transition: "color var(--transition-fast) ease",
                  }}
                >
                  {active && (
                    <motion.span
                      layoutId="faq-cat-active"
                      transition={reduceMotion ? { duration: 0 } : springs.standard}
                      style={{ position: "absolute", inset: 0, background: "var(--accent-soft)", borderRadius: "var(--radius-sm)", zIndex: 0 }}
                    />
                  )}
                  <span style={{ position: "relative", zIndex: 1 }}>{cat.name}</span>
                </button>
              );
            })}
          </nav>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeCategory}
                initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={springs.standard}
              >
                <h2 style={{ marginTop: 0 }}>{activeCat?.name}</h2>
                {activeCat?.entries.map((entry, i) => (
                  <details className="faq-item" key={i}>
                    <summary>{entry.q}</summary>
                    <ul style={{ marginTop: 10, fontSize: 14 }}>
                      {entry.bullets.map((b, j) => <li key={j}>{b}</li>)}
                    </ul>
                  </details>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
