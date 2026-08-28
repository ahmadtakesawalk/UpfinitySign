// DEPLOY TO: app/api/dashboard/assistant/chat/route.ts

export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { assertWithinTierLimit, incrementUsage, TierLimitExceededError } from "@/lib/billing/metering";
import { prisma } from "@/lib/db";
import { assistantTurn, answerAccountQuestion, type AssistantContext } from "@/lib/llm/assistant";
import { captureException } from "@/lib/monitoring";

interface ChatBody {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  templateId?: string; // absent when creating a new document from scratch
  mode: "field_edit" | "account_question";
}

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await assertWithinTierLimit(user.tenantId, "ai_messages");
  } catch (err) {
    if (err instanceof TierLimitExceededError) {
      return NextResponse.json({ error: "You've used all your AI assistant messages for this plan — buy more in Settings or upgrade." }, { status: 429 });
    }
    throw err;
  }

  const body = (await req.json()) as ChatBody;
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });
  }

  try {
    if (body.mode === "account_question") {
      const [envelopeCounts, templateCount, tenant] = await Promise.all([
        prisma.envelope.groupBy({ by: ["status"], where: { tenantId: user.tenantId }, _count: true }),
        prisma.template.count({ where: { tenantId: user.tenantId } }),
        prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
      ]);
      const counts = Object.fromEntries(envelopeCounts.map((c) => [c.status, c._count]));
      const reply = await answerAccountQuestion(body.message, { envelopeCounts: counts, templateCount, tier: tenant.tier });
      await incrementUsage(user.tenantId, "ai_messages");
      return NextResponse.json({ reply });
    }

    let ctx: AssistantContext;
    if (body.templateId) {
      const template = await prisma.template.findFirst({ where: { id: body.templateId, tenantId: user.tenantId } });
      if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
      const fieldMap = (template.fieldMap as any[]) ?? [];
      ctx = {
        templateName: template.name,
        pageCount: fieldMap.length ? Math.max(...fieldMap.map((f) => f.page)) + 1 : 1,
        currentFields: fieldMap.map((f) => ({ id: f.id, page: f.page, type: f.type, role: f.role, x: f.x, y: f.y, width: f.width, height: f.height })),
        creatingNewDocument: false,
      };
    } else {
      ctx = { creatingNewDocument: true };
    }

    const turn = await assistantTurn(body.message, body.history ?? [], ctx);
    await incrementUsage(user.tenantId, "ai_messages");
    return NextResponse.json(turn);
  } catch (err) {
    await captureException(err, { context: "assistant_chat", tenantId: user.tenantId });
    return NextResponse.json({ error: "The assistant hit an error — try again." }, { status: 500 });
  }
}
