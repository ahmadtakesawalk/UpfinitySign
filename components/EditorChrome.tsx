// DEPLOY TO: components/EditorChrome.tsx
"use client";

// Replaces the plain dashboard <TopBar> on full-screen editor pages (envelope
// fields editor, template fields editor) with DocuSign's minimal editor
// chrome: close/back + breadcrumb on the left, help/settings + page-specific
// actions on the right. The generic TopBar (nav links, logout) stays exactly
// as-is for every other page — this is a separate, narrower component, not a
// TopBar variant, so nothing else in the app is affected by this change.

import type { ReactNode } from "react";

interface Crumb {
  label: string;
  href?: string; // omit for the current (non-clickable) crumb — normally the last one
}

interface EditorChromeProps {
  backHref: string;
  crumbs: Crumb[];
  actions?: ReactNode; // Preview / Save / Send buttons — page supplies these
}

export function EditorChrome({ backHref, crumbs, actions }: EditorChromeProps) {
  return (
    <div className="topbar" style={{ gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <a href={backHref} title="Close" style={{ display: "flex", color: "var(--text-secondary)", flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </a>
        <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, minWidth: 0, overflow: "hidden" }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              {i > 0 && <span style={{ color: "var(--text-muted)" }}>›</span>}
              {c.href ? (
                <a href={c.href} style={{ color: "var(--text-secondary)", textDecoration: "none", whiteSpace: "nowrap" }}>{c.label}</a>
              ) : (
                <span style={{ color: "var(--text-primary)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <a href="/faq" title="Help" style={{ display: "flex", color: "var(--text-secondary)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M6.2 6.2a1.8 1.8 0 113 1.5c-.5.4-1 .7-1 1.5" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.15" fill="currentColor" />
          </svg>
        </a>
        <a href="/dashboard/settings" title="Settings" style={{ display: "flex", color: "var(--text-secondary)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1M12.2 12.2l-1.1-1.1M4.9 4.9L3.8 3.8" strokeLinecap="round" />
          </svg>
        </a>
        {actions && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{actions}</div>}
      </div>
    </div>
  );
}
