export function TopBar({
  brand = "Upfinity Sign",
  links,
  logoutHref,
}: {
  brand?: string;
  links: { href: string; label: string }[];
  logoutHref?: string; // e.g. "/api/dashboard/logout" or "/api/admin/logout" — omit to hide the button (public/marketing pages)
}) {
  return (
    <div className="topbar">
      <a href="/" className="topbar-brand">
        {brand}
      </a>
      <nav className="topbar-nav" style={{ alignItems: "center", gap: 16 }}>
        {links.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
        {logoutHref && (
          <form action={logoutHref} method="POST" style={{ margin: 0 }}>
            <button type="submit" style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 14, cursor: "pointer", padding: 0, font: "inherit" }}>
              Log out
            </button>
          </form>
        )}
      </nav>
    </div>
  );
}
