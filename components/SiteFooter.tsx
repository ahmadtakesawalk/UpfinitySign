// DEPLOY TO: components/SiteFooter.tsx
//
// One shared footer so the legal links (and the "Powered by Upfinity
// Inc." attribution) are consistent everywhere they're required, rather
// than several slightly-different ad-hoc versions across different pages.

export function SiteFooter() {
  return (
    <div className="footer-note">
      Powered by <a href="https://upfinity.ca">Upfinity Inc.</a>
      {" · "}
      <a href="/faq">FAQ</a>
      {" · "}
      <a href="/privacy">Privacy Policy</a>
      {" · "}
      <a href="/terms">Terms of Service</a>
    </div>
  );
}
