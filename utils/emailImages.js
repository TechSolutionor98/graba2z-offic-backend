/**
 * Repair image addresses in outgoing email.
 *
 * An email is the one thing a developer's machine can send that a stranger then
 * opens. Anything in it pointing at http://localhost:5000, a LAN address or a
 * .local hostname is a picture that will never load for the recipient, and
 * there is nothing in the delivered message able to fix it afterwards.
 *
 * The admin screens already write public addresses, but a template saved before
 * that was true -- or imported, or edited by hand -- can still carry one. This
 * runs on every message on its way out, so those are repaired at the last
 * possible moment rather than being discovered by a customer.
 */

const PUBLIC_MEDIA = (process.env.PUBLIC_MEDIA_URL || "https://api.grabatoz.ae").replace(/\/+$/, "");

// Matches an absolute http(s) URL whose host only exists on the sending
// machine or its network: localhost, loopback, .local, and the private IPv4
// ranges. The path is kept; only the host is replaced.
const MACHINE_ONLY = new RegExp(
  "https?://" +
    "(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|[a-z0-9-]+\\.local" +
    "|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}" +
    "|192\\.168\\.\\d{1,3}\\.\\d{1,3}" +
    "|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})" +
    "(?::\\d+)?" +
    // The host must end here. Without this, "localhost" also matches inside
    // "localhost.example.com" -- a real public domain -- and the rewrite would
    // break a perfectly good image URL.
    "(?=[/?#\"'\\s]|$)",
  "gi"
);

/**
 * @param {string} html
 * @returns {string} the same markup with machine-only hosts pointed at the
 *   public media host. Everything else is left exactly as it was.
 */
export const publicizeEmailImages = (html) => {
  if (!html || typeof html !== "string") return html;
  if (!MACHINE_ONLY.test(html)) {
    MACHINE_ONLY.lastIndex = 0;
    return html;
  }
  MACHINE_ONLY.lastIndex = 0;
  return html.replace(MACHINE_ONLY, PUBLIC_MEDIA);
};

export default publicizeEmailImages;
