// Response headers for every Vanda route (SSR and static assets alike).
// Applied in vite.config.ts: as a `continue` route in the Vercel Build Output
// (.vercel/output/config.json) on the vercel preset, as routeRules elsewhere.
//
// Phase 1 headers are enforced. The CSP is Report-Only: violations show up in
// DevTools and nothing is blocked yet. Phase 3 replaces 'unsafe-inline' in
// script-src with a per-request nonce, then the CSP header can be enforced.

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://clerk.vandastudio.app https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.convex.cloud https://img.clerk.com",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://clerk.vandastudio.app https://clerk-telemetry.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy-Report-Only": csp,
} satisfies Record<string, string>;
