/**
 * The pages the admin can theme individually.
 *
 * Patterns are matched against the pathname with the country/language prefix
 * (/ae-en, /sa-ar, ...) already stripped, so one rule covers every locale.
 * A rule may carry several comma-separated patterns. Wildcards: `*` matches
 * within one path segment, `**` matches across segments.
 *
 * This list is the seed only -- it is written into the Theme document and
 * served from there, so the client never hardcodes it. Adding an entry here
 * makes it appear in the admin panel on the next read; removing one leaves any
 * already-saved row untouched.
 */
export const BUILT_IN_THEME_PAGES = [
  { key: "home", label: "Home", pattern: "/" },
  {
    key: "shop",
    label: "Shop / Category listing",
    pattern: "/shop, /shop/**, /product-category, /product-category/**",
  },
  { key: "product", label: "Product details", pattern: "/product/**" },
  { key: "cart", label: "Cart", pattern: "/cart" },
  { key: "checkout", label: "Checkout", pattern: "/checkout" },
  {
    key: "auth",
    label: "Login / Register",
    pattern: "/login, /register, /forgot-password, /reset-password, /verify-email",
  },
  { key: "account", label: "Profile / Orders / Wishlist", pattern: "/profile, /orders, /wishlist" },
  { key: "blog", label: "Blog", pattern: "/blogs, /blogs/**" },
  { key: "offers", label: "Offer pages", pattern: "/offers/**" },
  { key: "gaming-zone", label: "Gaming Zone", pattern: "/gaming-zone/**" },
  { key: "about", label: "About Us", pattern: "/about" },
  { key: "contact", label: "Contact Us", pattern: "/contact" },
  { key: "track-order", label: "Track Order", pattern: "/track-order, /guest-order, /guest" },
  { key: "bulk-purchase", label: "Bulk Purchase Request", pattern: "/bulk-purchase" },
  {
    key: "policies",
    label: "Policy pages",
    pattern:
      "/privacy-policy, /privacy-policy-arabic, /disclaimer-policy, /terms-conditions, /refund-return, /cookies-policy, /voucher-terms, /delivery-terms",
  },
  {
    key: "promotions",
    label: "Promotional landing pages",
    pattern: "/green-friday-promotional, /backtoschool-acer-professional",
  },
  { key: "payment", label: "Payment result pages", pattern: "/payment/success, /payment/cancel" },
  { key: "country-selector", label: "Country selector", pattern: "/select-country" },
]

export default BUILT_IN_THEME_PAGES
