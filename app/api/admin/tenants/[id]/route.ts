import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireRole(["super_admin", "billing_ops"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const formData = await req.formData();
  const action = formData.get("action");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;

  if (action === "update_tier") {
    const tier = formData.get("tier") as string;
    await prisma.tenant.update({ where: { id }, data: { tier: tier as any } });
    await logAdminAction(admin, "tenant.tier_changed", id, { tier }, ip);
  } else if (action === "suspend") {
    await prisma.tenant.update({ where: { id }, data: { suspended: true, suspensionReason: "admin_action" } });
    await logAdminAction(admin, "tenant.suspended", id, undefined, ip);
  } else if (action === "reinstate") {
    const target = await prisma.tenant.findUniqueOrThrow({ where: { id } });
    await prisma.tenant.update({
      where: { id },
      data: {
        suspended: false,
        suspensionReason: null,
        // Reinstating a tenant that was suspended for trial expiry has to
        // clear trialEndsAt too — otherwise they're still tier "free"
        // with a past trialEndsAt, and the very next daily cron run would
        // just re-suspend them immediately (processTrialExpirations
        // matches on exactly that combination). Clearing it treats this
        // as the admin granting indefinite free access going forward, a
        // deliberate manual override — a real trial re-extension (same
        // 60-day clock again) is a different, more particular action an
        // admin can still do by hand if that's what's actually wanted.
        ...(target.suspensionReason === "trial_expired_no_card" ? { trialEndsAt: null } : {}),
      },
    });
    await logAdminAction(admin, "tenant.reinstated", id, undefined, ip);
  } else if (action === "verify_email_domain") {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id } });
    if (!tenant.customFromEmail) {
      return NextResponse.json({ error: "This tenant hasn't requested a custom sending domain." }, { status: 400 });
    }
    await prisma.tenant.update({ where: { id }, data: { customFromEmailVerifiedAt: new Date() } });
    await logAdminAction(admin, "tenant.email_domain_verified", id, { email: tenant.customFromEmail }, ip);
  } else if (action === "revoke_email_domain") {
    await prisma.tenant.update({ where: { id }, data: { customFromEmail: null, customFromEmailVerifiedAt: null } });
    await logAdminAction(admin, "tenant.email_domain_revoked", id, undefined, ip);
  } else if (action === "set_tax_rate") {
    const rateRaw = formData.get("tax_rate") as string;
    const rate = rateRaw?.trim() === "" ? null : Number(rateRaw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      return NextResponse.json({ error: "Tax rate must be a number between 0 and 100, or blank to clear it." }, { status: 400 });
    }
    await prisma.tenant.update({ where: { id }, data: { taxRatePercent: rate } });
    await logAdminAction(admin, "tenant.tax_rate_set", id, { taxRatePercent: rate }, ip);
  } else if (action === "extend_trial") {
    // Deliberately not a blanket toggle — a specific number of days,
    // bounded, with a required reason, always audited. Extends
    // trialEndsAt forward rather than resetting it, so it composes
    // correctly with everything else that already reads that field
    // (the card-required gate, the daily conversion cron) instead of
    // needing its own special case anywhere.
    const days = Number(formData.get("days"));
    const reason = (formData.get("reason") as string)?.trim();
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return NextResponse.json({ error: "Enter a whole number of days between 1 and 90." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required for a trial extension." }, { status: 400 });
    }
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id } });
    if (tenant.tier !== "free" || !tenant.trialEndsAt) {
      return NextResponse.json({ error: "This tenant isn't currently on a trial." }, { status: 400 });
    }
    const newTrialEndsAt = new Date(Math.max(tenant.trialEndsAt.getTime(), Date.now()));
    newTrialEndsAt.setDate(newTrialEndsAt.getDate() + days);
    await prisma.tenant.update({
      where: { id },
      data: {
        trialEndsAt: newTrialEndsAt,
        // A tenant already suspended for a missed trial deadline needs
        // reinstating too, or the extension is meaningless — they'd stay
        // locked out despite having more time now.
        ...(tenant.suspended && tenant.suspensionReason === "trial_expired_no_card" ? { suspended: false, suspensionReason: null } : {}),
      },
    });
    await logAdminAction(admin, "tenant.trial_extended", id, { days, reason, new_trial_ends_at: newTrialEndsAt.toISOString() }, ip);
  }

  return NextResponse.redirect(new URL(`/admin/tenants/${id}`, req.url), 303);
}
