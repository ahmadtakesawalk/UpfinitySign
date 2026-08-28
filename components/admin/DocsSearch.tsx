// DEPLOY TO: components/admin/DocsSearch.tsx
"use client";

import { useMemo, useState } from "react";

export interface DocSection {
  doc: string; // which source file this came from — "Admin Guide", "Wiki", "Integrations"
  heading: string;
  body: string;
}

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} style={{ background: "var(--accent)", color: "white", padding: "0 2px", borderRadius: 2 }}>{part}</mark>
    ) : (
      part
    )
  );
}

export function DocsSearch({ sections }: { sections: DocSection[] }) {
  const [query, setQuery] = useState("");
  const [activeDoc, setActiveDoc] = useState<string | "all">("all");

  const filtered = useMemo(() => {
    return sections.filter((s) => {
      if (activeDoc !== "all" && s.doc !== activeDoc) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return s.heading.toLowerCase().includes(q) || s.body.toLowerCase().includes(q);
    });
  }, [sections, query, activeDoc]);

  const docNames = Array.from(new Set(sections.map((s) => s.doc)));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all docs…"
          style={{ flex: 1, minWidth: 240 }}
          autoFocus
        />
        <select value={activeDoc} onChange={(e) => setActiveDoc(e.target.value)} style={{ width: 160 }}>
          <option value="all">All docs</option>
          {docNames.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
        {filtered.length} of {sections.length} sections
      </p>

      {filtered.length === 0 && (
        <div className="card"><p style={{ fontSize: 14, color: "var(--text-muted)" }}>No sections match "{query}".</p></div>
      )}

      {filtered.map((s, i) => (
        <details key={i} className="card" style={{ marginBottom: 8 }} open={Boolean(query.trim())}>
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            {highlight(s.heading, query)}
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginLeft: 8 }}>{s.doc}</span>
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 12, fontFamily: "inherit", lineHeight: 1.6 }}>
            {highlight(s.body, query)}
          </pre>
        </details>
      ))}
    </div>
  );
}
