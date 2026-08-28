import { redirect } from "next/navigation";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { getEffectiveTierLimits } from "@/lib/settings";
import { tenantHasAddon } from "@/lib/billing/addons";
import { getUsage, getCreditBalance } from "@/lib/billing/metering";
import { CREDIT_PACKS, PLATFORM_TIER_PRICING } from "@/lib/billing/providers.config";
import { ApiKeysCard } from "@/components/ApiKeysCard";
import { TeamCard } from "@/components/TeamCard";
import { SecurityCard } from "@/components/SecurityCard";
import { CancelPlanButton } from "@/components/CancelPlanButton";
import { RequestRefundButton } from "@/components/RequestRefundButton";
import { Button } from "@/components/motion/Button";
import { TopBar } from "@/components/TopBar";
import { SiteFooter } from "@/components/SiteFooter";

export default async function TenantSettingsPage() {
  const user = await getCurrentTenantUser();
  if (!user) redirect("/dashboard/login");

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: user.tenantId },
    include: { apiKeys: true, users: true, ssoConfig: true },
  });
  const limits = await getEffectiveTierLimits(tenant.id, tenant.tier);
  const addonsAvailable = config.tiers[tenant.tier].addons;
  const canManageSettings = requireTenantRole(user, ["owner", "admin"]);
  const hasBrandingAddon = await tenantHasAddon(tenant.id, "custom_branding");
  const [envelopesUsed, aiMessagesUsed, envelopeCredits, aiMessageCredits, invoices, supportMessages] = await Promise.all([
    getUsage(tenant.id, "envelopes_sent"),
    getUsage(tenant.id, "ai_messages"),
    getCreditBalance(tenant.id, "envelopes"),
    getCreditBalance(tenant.id, "ai_messages"),
    prisma.invoice.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 25, include: { refunds: true } }),
    prisma.supportMessage.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const recentConversion = invoices.find(
    (i) => i.kind === "trial_conversion" && Date.now() - i.createdAt.getTime() < 48 * 60 * 60 * 1000
  );

  return (
    <>
      <TopBar
        logoutHref="/api/dashboard/logout"
        links={[
          { href: "/dashboard", label: "Envelopes" },
          { href: "/dashboard/templates", label: "Templates" },
          { href: "/dashboard/webhook-activity", label: "Integration Alerts" },
          { href: "/dashboard/settings", label: "Settings" },
        ]}
      />
      <div style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
      <h1>Settings</h1>
      <div className="signature-rule" />

      {recentConversion && (
        <div className="card" style={{ marginBottom: 16, background: "var(--success-bg)", borderColor: "var(--success)" }}>
          <h3 style={{ color: "var(--success)" }}>Your membership is active</h3>
          <p style={{ fontSize: 14 }}>
            {recentConversion.description} — ${(recentConversion.amountCents / 100).toFixed(2)}{" "}
            {recentConversion.currency.toUpperCase()} charged to your card on file. A receipt is
            in your invoice history below.
          </p>
        </div>
      )}

      {tenant.suspended && tenant.suspensionReason === "payment_failed_dunning" && (
        <div className="card" style={{ marginBottom: 16, background: "var(--danger-bg)", borderColor: "var(--danger)" }}>
          <h3 style={{ color: "var(--danger)" }}>Your workspace is paused</h3>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            We were unable to charge your payment method after repeated attempts, so sending is
            paused. Nothing has been deleted — update your payment method to resume immediately.
          </p>
          {canManageSettings && (
            <form action="/api/dashboard/billing/checkout?update_payment=1" method="POST">
              <Button type="submit" variant="primary">Update payment method</Button>
            </form>
          )}
        </div>
      )}

      {tenant.suspended && tenant.suspensionReason === "trial_expired_no_card" && (
        <div className="card" style={{ marginBottom: 16, background: "var(--danger-bg)", borderColor: "var(--danger)" }}>
          <h3 style={{ color: "var(--danger)" }}>Your trial has ended</h3>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            Your 60-day free trial ended without a payment method on file, so sending is paused.
            Nothing has been deleted — add a payment method to pick up right where you left off.
          </p>
          {canManageSettings && (
            <>
              <form action="/api/dashboard/billing/checkout?add_card=1" method="POST">
                <Button type="submit" variant="primary">Add payment method</Button>
              </form>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                Adding a card here charges you immediately{" "}
                ${PLATFORM_TIER_PRICING[config.trial.autoConvertToTier]?.monthlyUsd.toFixed(2)} USD for your
                first month on the {config.trial.autoConvertToTier} plan, then the same amount every
                month after that until you cancel from Settings → Plan.
              </p>
            </>
          )}
        </div>
      )}

      {!tenant.suspended && tenant.tier === "free" && tenant.trialEndsAt && (() => {
        const daysLeft = Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
        const cardOnFile = Boolean(tenant.trialExternalCustomerId);
        const daysSinceCardRequired = config.trial.lengthDays - config.trial.cardRequiredAfterDays;
        const cardRequiredSoon = daysLeft <= daysSinceCardRequired;
        const convertPrice = PLATFORM_TIER_PRICING[config.trial.autoConvertToTier]?.monthlyUsd.toFixed(2);
        if (cardOnFile && daysLeft > 3) return null; // nothing worth surfacing once a card's on file and the trial isn't imminent
        return (
          <div className="card" style={{ marginBottom: 16, background: cardRequiredSoon && !cardOnFile ? "var(--warning-bg)" : "var(--bg-subtle)" }}>
            <h3>Free trial — {daysLeft} day{daysLeft === 1 ? "" : "s"} left</h3>
            <p style={{ fontSize: 14, marginBottom: cardOnFile ? 0 : 12 }}>
              {cardOnFile
                ? `A payment method is on file — you'll move to the ${config.trial.autoConvertToTier} plan automatically on ${tenant.trialEndsAt.toLocaleDateString()}, no action needed.`
                : cardRequiredSoon
                ? "Add a payment method now to avoid any interruption when your trial ends."
                : `You can add a payment method any time — it's required starting ${daysSinceCardRequired} days before your trial ends.`}
            </p>
            {!cardOnFile && canManageSettings && (
              <>
                <form action="/api/dashboard/billing/checkout?add_card=1" method="POST">
                  <Button type="submit" variant="primary">Add payment method</Button>
                </form>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                  You won't be charged today. On {tenant.trialEndsAt.toLocaleDateString()} (when your
                  trial ends), we'll automatically charge ${convertPrice} USD/month to this card for
                  the {config.trial.autoConvertToTier} plan, and continue charging that amount every
                  month until you cancel. You can cancel or remove this card any time before then from
                  Settings → Plan to avoid being charged.
                </p>
              </>
            )}
          </div>
        );
      })()}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Plan</h3>
        <p style={{ fontSize: 14 }}>
          {tenant.tier} — {limits.envelopesPerMonth === Infinity ? "unlimited" : limits.envelopesPerMonth}{" "}
          envelopes/month, {limits.retentionYears}-year retention
        </p>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Add-ons available on your plan: {addonsAvailable.length ? addonsAvailable.join(", ") : "none"}
        </p>
        {canManageSettings && requireTenantRole(user, ["owner"]) && (tenant.tier === "free" || tenant.tier === "starter") && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {tenant.tier === "free" && (
              <form action="/api/dashboard/billing/checkout?tier=starter" method="POST">
                <Button type="submit" variant="secondary">
                  Upgrade to Starter
                </Button>
              </form>
            )}
            <form action="/api/dashboard/billing/checkout?tier=business" method="POST">
              <Button type="submit" variant="primary">
                Upgrade to Business
              </Button>
            </form>
          </div>
        )}
        {canManageSettings && requireTenantRole(user, ["owner"]) && tenant.tier !== "free" && <CancelPlanButton />}
      </div>

      {canManageSettings && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Payment collection</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
            Connect a Stripe account to add payment fields to your templates — collected funds go
            directly to your own connected account, never through Upfinity.
          </p>
          {tenant.stripeConnectOnboarded ? (
            <span className="badge badge-success">Stripe connected</span>
          ) : (
            <>
              {tenant.stripeConnectedAccountId && (
                <p style={{ fontSize: 13, color: "var(--warning)", marginBottom: 8 }}>Onboarding started but not finished yet.</p>
              )}
              <form action="/api/dashboard/settings/stripe-connect" method="POST">
                <Button type="submit" variant="primary">
                  {tenant.stripeConnectedAccountId ? "Finish connecting Stripe" : "Connect Stripe"}
                </Button>
              </form>
            </>
          )}
        </div>
      )}

      {canManageSettings && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Usage & credits</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
            This month's usage against your plan — once you hit the monthly allowance, purchased
            credits are used automatically before anything is blocked.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            <UsageRow
              label="Envelopes sent"
              used={envelopesUsed}
              limit={limits.envelopesPerMonth}
              credits={envelopeCredits}
            />
            <UsageRow
              label="AI assistant messages"
              used={aiMessagesUsed}
              limit={limits.aiMessagesPerMonth}
              credits={aiMessageCredits}
            />
          </div>

          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Buy more</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(CREDIT_PACKS).map(([packId, pack]) => (
              <form key={packId} action={`/api/dashboard/billing/checkout?pack=${packId}`} method="POST">
                <Button type="submit" variant="secondary" style={{ fontSize: 13 }}>
                  {pack.label} — ${pack.usdPrice}
                </Button>
              </form>
            ))}
          </div>
        </div>
      )}

      {canManageSettings && (
        <form action="/api/dashboard/settings" method="POST" className="card" style={{ marginBottom: 16 }}>
          <h3>Webhook</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Where envelope status updates get pushed (sent, opened, signed, completed).
          </p>
          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <input
              type="url"
              name="webhookUrl"
              defaultValue={tenant.webhookUrl ?? ""}
              placeholder="https://your-app.com/api/webhooks/signature-status"
            />
          </div>
          <Button type="submit" variant="primary">
            Save webhook
          </Button>
        </form>
      )}

      {canManageSettings && hasBrandingAddon && (
        <form action="/api/dashboard/branding" method="POST" className="card" style={{ marginBottom: 16 }}>
          <h3>Branding</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Your logo shown on the signing page in place of the default Upfinity Sign header.
            "Powered by Upfinity Inc." stays in the footer regardless — see PRD §10.
          </p>
          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <input
              type="url"
              name="customLogoUrl"
              defaultValue={tenant.customLogoUrl ?? ""}
              placeholder="https://your-cdn.com/logo.png"
            />
          </div>
          <Button type="submit" variant="primary">
            Save branding
          </Button>
        </form>
      )}
      {canManageSettings && !hasBrandingAddon && (
        <div className="card" style={{ marginBottom: 16, opacity: 0.7 }}>
          <h3>Branding</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Custom branding (your logo on the signing page) is an add-on not included in your
            current plan. Contact support to add it.
          </p>
        </div>
      )}

      {canManageSettings && tenant.tier === "enterprise" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Single sign-on</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {tenant.ssoConfig?.enabled
              ? `SSO is active for this workspace (IdP: ${tenant.ssoConfig.idpEntityId ?? "configured"}). Team members can sign in via SSO from the login page.`
              : "Paste your identity provider's metadata XML (from Okta, Azure AD, OneLogin, etc.) to enable SSO for this workspace."}
          </p>
          <form action="/api/dashboard/sso" method="POST" style={{ marginTop: 12 }}>
            <textarea
              name="rawMetadata"
              placeholder="<EntityDescriptor ...>...</EntityDescriptor>"
              rows={6}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: 12,
                padding: 8,
                border: "1px solid var(--border)",
                borderRadius: 8,
                marginBottom: 12,
              }}
            />
            <Button type="submit" variant="primary">
              {tenant.ssoConfig?.enabled ? "Update SSO connection" : "Enable SSO"}
            </Button>
          </form>
        </div>
      )}

      {canManageSettings && tenant.tier === "enterprise" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Custom sending domain</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {tenant.customFromEmail && tenant.customFromEmailVerifiedAt
              ? `Envelope emails send from ${tenant.customFromEmail}.`
              : tenant.customFromEmail
              ? `${tenant.customFromEmail} is requested but not yet verified — emails still send from the Upfinity Sign address until a platform admin confirms domain ownership. This usually takes 1–2 business days.`
              : "By default, envelope emails send from the Upfinity Sign address. Request your own domain here — a platform admin verifies ownership before it goes live."}
          </p>
          <form action="/api/dashboard/email-domain" method="POST" style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <input
              type="email"
              name="fromEmail"
              defaultValue={tenant.customFromEmail ?? ""}
              placeholder="notifications@yourcompany.com"
              style={{ flex: 1 }}
            />
            <Button type="submit" variant="primary">
              {tenant.customFromEmail ? "Update request" : "Request domain"}
            </Button>
          </form>
        </div>
      )}

      <ApiKeysCard
        initialKeys={tenant.apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          scopes: k.scopes as string[],
          revokedAt: k.revokedAt?.toISOString() ?? null,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        }))}
      />

      <SecurityCard />

      <TeamCard
        initialMembers={tenant.users.map((u) => ({ id: u.id, email: u.email, role: u.role }))}
        currentUserIsOwner={requireTenantRole(user, ["owner"])}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Invoices &amp; receipts</h3>
        {invoices.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--text-muted)" }}>No invoices yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ fontSize: 13 }}>{inv.createdAt.toLocaleDateString()}</td>
                  <td style={{ fontSize: 13 }}>{inv.description}</td>
                  <td style={{ fontSize: 13 }}>
                    {inv.amountCents < 0 ? "-" : ""}${(Math.abs(inv.amountCents) / 100).toFixed(2)} {inv.currency.toUpperCase()}
                    {inv.taxCents !== 0 && <span style={{ color: "var(--text-muted)", fontSize: 11 }}> (incl. tax)</span>}
                  </td>
                  <td>
                    <span className={`badge ${inv.status === "paid" ? "badge-success" : "badge-danger"}`}>
                      {inv.status === "paid" ? "Paid" : "Failed"}
                    </span>
                  </td>
                  <td>
                    {inv.pdfStorageKey && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <a href={`/api/dashboard/invoices/${inv.id}/pdf`} target="_blank" style={{ fontSize: 12, color: "var(--accent-dark)" }}>
                          Download PDF
                        </a>
                        {!inv.emailedAt && (
                          <form action={`/api/dashboard/invoices/${inv.id}/email`} method="POST">
                            <button type="submit" style={{ fontSize: 12, background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 0 }}>
                              Email me a copy
                            </button>
                          </form>
                        )}
                        {inv.emailedAt && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Emailed</span>}
                        {inv.status === "paid" && inv.kind !== "refund" && inv.refunds.length === 0 && (
                          <RequestRefundButton invoiceId={inv.id} description={inv.description} amountLabel={`$${(inv.amountCents / 100).toFixed(2)} ${inv.currency.toUpperCase()}`} />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Contact Upfinity</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
          Send a message directly to our team — it lands in our support queue right away, and
          we'll get back to you at the email below.
        </p>
        <form action="/api/dashboard/support" method="POST">
          <div style={{ marginBottom: 10 }}>
            <input name="subject" placeholder="Subject" required style={{ width: "100%" }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <textarea name="body" placeholder="How can we help?" required rows={4} style={{ width: "100%" }} />
          </div>
          <Button type="submit" variant="primary">Send message</Button>
        </form>
        {supportMessages.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 8 }}>Your recent messages</p>
            {supportMessages.map((m) => (
              <div key={m.id} style={{ fontSize: 13, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{m.subject}</strong>
                  <span className={`badge ${m.status === "resolved" ? "badge-success" : "badge-pending"}`}>
                    {m.status === "resolved" ? "Resolved" : "Open"}
                  </span>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 12 }}>{m.createdAt.toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {requireTenantRole(user, ["owner"]) && (
        <div className="card" style={{ borderColor: "#f0997b" }}>
          <h3>Danger zone</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Export or request deletion of your workspace data. Deletion has a grace period before
            it's acted on — see PRD §14.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <a href="/api/v1/tenant/export" className="primary" style={{ textDecoration: "none", display: "inline-block" }}>
              Export data
            </a>
            <form action="/api/v1/tenant/delete" method="POST">
              <Button type="submit" variant="danger">
                Request deletion
              </Button>
            </form>
          </div>
        </div>
      )}
      </div>
      <SiteFooter />
    </>
  );
}

function UsageRow({ label, used, limit, credits }: { label: string; used: number; limit: number; credits: number }) {
  const unlimited = limit === Infinity;
  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(limit, 1)) * 100);
  const overAllowance = !unlimited && used >= limit;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: "var(--text-secondary)" }}>
          {used} / {unlimited ? "unlimited" : limit}
          {credits > 0 && ` + ${credits} credit${credits === 1 ? "" : "s"}`}
        </span>
      </div>
      {!unlimited && (
        <div style={{ height: 6, borderRadius: 999, background: "var(--bg-subtle)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: overAllowance ? "var(--danger)" : "var(--accent)", borderRadius: 999 }} />
        </div>
      )}
      {overAllowance && (
        <p style={{ fontSize: 12, color: credits > 0 ? "var(--text-secondary)" : "var(--danger)", marginTop: 4 }}>
          {credits > 0 ? "Over your plan allowance — now drawing from purchased credits." : "Over your plan allowance and out of credits — buy more below or upgrade your plan."}
        </p>
      )}
    </div>
  );
}
