// DEPLOY TO: lib/llm/assistant.ts
//
// The chat-driven template assistant. Same "prompt the model to return
// strict JSON, parse it" pattern as field-placement.ts uses — not native
// function-calling — because lib/llm/client.ts's complete() wraps a
// provider-agnostic text completion, and adding real tool-calling would
// mean building and maintaining two different tool-call protocols (Gateway
// vs. the OpenRouter direct-call fallback) for one feature. JSON-mode is
// simpler, already proven in this codebase, and sufficient here.
//
// Every action this returns is a PROPOSAL — nothing is written to the
// database from this file. The caller (the chat API route) shows it to
// the person and only applies it after they explicitly confirm. That is
// not a suggestion, it's the whole safety model for this feature — see
// the assistant's own system prompt below, which insists on it too.

import { complete } from "./client";
import type { FieldType } from "../signing/field-types";

export interface AssistantFieldProposal {
  page: number;
  type: FieldType;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options?: string[];
}

export type AssistantAction =
  | { kind: "add_field"; field: AssistantFieldProposal; description: string }
  | { kind: "edit_field"; fieldId: string; changes: Partial<AssistantFieldProposal>; description: string }
  | { kind: "remove_field"; fieldId: string; description: string }
  | { kind: "generate_document"; title: string; bodyHtml: string; suggestedFields: AssistantFieldProposal[]; description: string }
  | { kind: "clarify" }; // model needs more information before it can propose anything — reply carries the question

export interface AssistantTurn {
  reply: string; // always shown in the chat
  action?: AssistantAction; // present only when there's something concrete to confirm
}

export interface AssistantContext {
  templateName?: string;
  pageCount?: number;
  currentFields?: { id: string; page: number; type: string; role: string; x: number; y: number; width: number; height: number }[];
  // When true, the assistant is in "create a new document" mode (no
  // template exists yet) — generate_document becomes available; when
  // false, it's editing an existing template and generate_document is not
  // offered (there's already a document; the assistant edits fields on it).
  creatingNewDocument: boolean;
}

function buildSystemPrompt(ctx: AssistantContext): string {
  const fieldTypesList =
    "signature, initial, date, full_name, email, company, title, text, number, checkbox, radio_group, dropdown, attachment, note, custom, formula";

  const modeInstructions = ctx.creatingNewDocument
    ? `You are helping create a brand-new document from scratch (an NDA, offer letter, policy acknowledgment, etc.) — no document exists yet. If the person describes what they need clearly enough to draft, propose a "generate_document" action with:
- "title": a short template name
- "bodyHtml": the FULL document body as semantic HTML (headings, paragraphs, lists — no inline styles, no <html>/<body> wrapper, just the content). Write real, complete document language appropriate to the request — not a placeholder or outline.
- "suggestedFields": signature/date/name fields placed at reasonable page positions for where they'd naturally belong (typically near the bottom)
IMPORTANT: you are drafting language a real person may sign. Do not invent specific legal terms, monetary amounts, dates, or jurisdiction-specific clauses the person hasn't given you — ask for anything essential and material (amount, term length, governing jurisdiction) rather than guessing. Generic structural boilerplate (standard NDA sections, standard "I acknowledge" framing) is fine to draft directly.`
    : `You are helping edit fields on an EXISTING document (already uploaded, has ${ctx.pageCount ?? "?"} page(s)). Only propose add_field / edit_field / remove_field — never generate_document, the document itself already exists and isn't yours to replace.
Coordinates are in PDF points, origin at the BOTTOM-LEFT of the page (not top-left) — "bottom of the page" means a LOW y value, "top of the page" means a high y value close to the page height. A typical Letter page is 612x792 points. If you don't know the exact page height, use y values under 100 for "near the bottom" and over 700 for "near the top," and note in your reply that placement may need fine-tuning.
Current fields on this document: ${JSON.stringify(ctx.currentFields ?? [])}`;

  return `You are the template assistant inside Upfinity Sign, an e-signature product. You help the sender build or edit a document's fillable fields through conversation.

${modeInstructions}

Field types available: ${fieldTypesList}.

CRITICAL RULES:
1. If the request is ambiguous or missing information you need (which page, what the field is for, an amount/date/jurisdiction for generated legal content), respond with kind "clarify" and ask ONE focused question in "reply" -- do not guess at material details.
2. When you DO have enough information, propose exactly ONE action per turn. Never bundle multiple field changes into one action -- if the person asks for two things, propose the first and mention in "reply" that you'll do the second once this one's confirmed.
3. Every action needs a short, plain-English "description" of exactly what will change -- this is shown to the person as a confirmation prompt, e.g. "Add a required phone number field near the bottom of page 2."
4. You are proposing, never applying. Nothing you say takes effect until the person clicks confirm -- so end every reply that includes an action with something like "Want me to add this?" not a claim that you already did it.
5. Respond with ONLY a single JSON object matching this shape, no prose outside it:
{"reply": string, "action": <one of the action shapes above, or omit this key entirely for a plain conversational reply with nothing to confirm>}`;
}

export async function assistantTurn(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  ctx: AssistantContext
): Promise<AssistantTurn> {
  const system = buildSystemPrompt(ctx);
  const transcript = [
    ...history.map((m) => `${m.role === "user" ? "Sender" : "Assistant"}: ${m.content}`),
    `Sender: ${userMessage}`,
  ].join("\n\n");

  const result = await complete({
    feature: "templateAssistant",
    system,
    prompt: transcript,
    maxTokens: 2048,
    temperature: 0.4,
  });

  return parseAssistantResponse(result.text);
}

function parseAssistantResponse(raw: string): AssistantTurn {
  // Models occasionally wrap JSON in a markdown fence despite instructions
  // -- strip it rather than fail the whole turn over formatting.
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.reply !== "string") throw new Error("missing reply");
    return { reply: parsed.reply, action: parsed.action };
  } catch {
    // If the model didn't return valid JSON, surface its raw text as a
    // plain reply rather than showing the person an error -- a garbled
    // action is worse than no action; a garbled sentence is still useful.
    return { reply: raw.trim() || "Sorry, I didn't quite catch that -- could you rephrase?" };
  }
}

export interface AssistantAnswerContext {
  envelopeCounts: Record<string, number>; // by status
  templateCount: number;
  tier: string;
}

/** Read-only Q&A about the tenant's own account -- no action, ever. Kept separate from assistantTurn so it can never accidentally return a field/document action. */
export async function answerAccountQuestion(question: string, ctx: AssistantAnswerContext): Promise<string> {
  const system = `You answer factual questions about the sender's own Upfinity Sign account using ONLY the data provided below. Be brief and direct. If the question isn't answerable from this data, say so plainly rather than guessing -- do not invent numbers or product facts not given here.

Account data:
- Plan tier: ${ctx.tier}
- Templates: ${ctx.templateCount}
- Envelopes by status: ${JSON.stringify(ctx.envelopeCounts)}`;

  const result = await complete({
    feature: "templateAssistant",
    system,
    prompt: question,
    maxTokens: 300,
    temperature: 0.2,
  });
  return result.text.trim();
}
