// DEPLOY TO: components/assistant/AssistantChatPanel.tsx
"use client";

// Two modes, one panel: editing fields on an existing template (templateId
// set) or drafting a new document from scratch (templateId undefined).
// Every proposal from the assistant renders as its own confirm/dismiss
// card — nothing the assistant says is applied until that's clicked. See
// lib/llm/assistant.ts's system prompt and app/api/dashboard/assistant/apply
// for the two halves of that guarantee (the model is instructed to always
// propose rather than claim done; the apply endpoint is the only place a
// proposal becomes a write, and only reachable after a click here).

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/motion/Button";
import { useToast } from "@/components/motion/Toast";
import { springs } from "@/lib/motion/tokens";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface FieldProposal {
  page: number; type: string; role: string; x: number; y: number; width: number; height: number; required: boolean; options?: string[];
}

type AssistantAction =
  | { kind: "add_field"; field: FieldProposal; description: string }
  | { kind: "edit_field"; fieldId: string; changes: Partial<FieldProposal>; description: string }
  | { kind: "remove_field"; fieldId: string; description: string }
  | { kind: "generate_document"; title: string; bodyHtml: string; suggestedFields: FieldProposal[]; description: string }
  | { kind: "clarify" };

export function AssistantChatPanel({
  templateId,
  onFieldsChanged,
  onDocumentGenerated,
}: {
  templateId?: string;
  onFieldsChanged?: (fieldMap: any[]) => void;
  onDocumentGenerated?: (templateId: string) => void;
}) {
  const { show } = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<"edit" | "ask">("edit");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] = useState<AssistantAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingAction]);

  async function send() {
    const message = input.trim();
    if (!message || loading) return;
    setInput("");
    setPendingAction(null);
    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setLoading(true);

    try {
      const res = await fetch("/api/dashboard/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          templateId,
          mode: tab === "ask" ? "account_question" : "field_edit",
        }),
      });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: json.error ?? "Something went wrong." }]);
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: json.reply }]);
      if (json.action && json.action.kind !== "clarify") {
        setPendingAction(json.action);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Network error — try again." }]);
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setApplying(true);
    try {
      const res = await fetch("/api/dashboard/assistant/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: pendingAction, templateId }),
      });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) {
        show({ message: json.error ?? "Couldn't apply that.", type: "error" });
        return;
      }
      if (pendingAction.kind === "generate_document") {
        show({ message: "Document created — review it before sending.", type: "success" });
        onDocumentGenerated?.(json.template_id);
      } else {
        onFieldsChanged?.(json.field_map);
        setMessages((prev) => [...prev, { role: "assistant", content: "Done — applied." }]);
      }
      setPendingAction(null);
    } catch {
      show({ message: "Network error — try again.", type: "error" });
    } finally {
      setApplying(false);
    }
  }

  const placeholder =
    tab === "ask"
      ? "e.g. how many envelopes have I sent this month?"
      : templateId
      ? "e.g. add a phone number field near the bottom of page 2"
      : "e.g. draft an NDA for a contractor, standard mutual terms";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)" }}>
      <div style={{ display: "flex", gap: 4, padding: "12px 12px 0" }}>
        <TabButton active={tab === "edit"} onClick={() => setTab("edit")}>
          {templateId ? "Edit fields" : "Create document"}
        </TabButton>
        <TabButton active={tab === "ask"} onClick={() => setTab("ask")}>
          Ask about my account
        </TabButton>
      </div>

      <p style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 12px 0", lineHeight: 1.4 }}>
        Your messages here are sent to our AI provider to generate a response. AI-drafted content
        needs your review before it's final. <a href="/ai-policy" target="_blank" style={{ color: "var(--text-secondary)" }}>Learn more</a>
      </p>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {tab === "ask"
              ? "Ask anything about your envelopes, templates, or plan."
              : templateId
              ? "Tell me what field to add, change, or remove — I'll confirm before applying anything."
              : "Describe the document you need and I'll draft it — you'll review it before it can be sent."}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "var(--accent)" : "var(--bg-subtle)",
              color: m.role === "user" ? "#fff" : "var(--text-primary)",
              borderRadius: 12,
              padding: "8px 12px",
              fontSize: 13.5,
              lineHeight: 1.4,
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && <div style={{ alignSelf: "flex-start", fontSize: 13, color: "var(--text-muted)" }}>Thinking…</div>}

        <AnimatePresence>
          {pendingAction && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={springs.standard}
              style={{ border: "1px solid var(--accent)", background: "var(--accent-soft)", borderRadius: 10, padding: 12 }}
            >
              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: "var(--accent-dark)" }}>
                {"description" in pendingAction ? pendingAction.description : "Proposed change"}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="primary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={confirmAction} disabled={applying}>
                  {applying ? "Applying…" : "Confirm"}
                </Button>
                <Button variant="secondary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => setPendingAction(null)} disabled={applying}>
                  Dismiss
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={placeholder}
          style={{ flex: 1, fontSize: 13 }}
          disabled={loading}
        />
        <Button variant="primary" onClick={send} disabled={loading || !input.trim()} style={{ padding: "8px 14px" }}>
          Send
        </Button>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: "6px 12px",
        borderRadius: "8px 8px 0 0",
        border: "none",
        background: active ? "var(--bg-subtle)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
