import mongoose from "mongoose"

/**
 * Site theme (appearance) settings.
 *
 * One singleton document drives every colour on the public storefront. The
 * admin panel deliberately does NOT read this document -- a low-contrast brand
 * colour picked by mistake must never be able to make the admin UI unreadable.
 *
 * Colours are stored as `#rrggbb` strings. The client converts them to the
 * "r g b" channel triplets that the CSS custom properties expect, so Tailwind
 * opacity modifiers (bg-lime-500/40) keep working.
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const hex = (fallback) => ({
  type: String,
  default: fallback,
  trim: true,
  validate: {
    validator: (v) => v === "" || v == null || HEX.test(v),
    message: (props) => `"${props.value}" is not a valid hex colour (expected #rrggbb).`,
  },
})

// Tailwind's stock `lime` ramp -- the palette the site shipped with. Keeping the
// exact values as defaults means an untouched install renders pixel-identical
// to before this feature existed.
const DEFAULT_BRAND_SCALE = {
  50: "#f7fee7",
  100: "#ecfccb",
  200: "#d9f99d",
  300: "#bef264",
  400: "#a3e635",
  500: "#84cc16",
  600: "#65a30d",
  700: "#4d7c0f",
  800: "#3f6212",
  900: "#365314",
  950: "#1a2e05",
}

const brandScaleSchema = new mongoose.Schema(
  {
    50: hex(DEFAULT_BRAND_SCALE[50]),
    100: hex(DEFAULT_BRAND_SCALE[100]),
    200: hex(DEFAULT_BRAND_SCALE[200]),
    300: hex(DEFAULT_BRAND_SCALE[300]),
    400: hex(DEFAULT_BRAND_SCALE[400]),
    500: hex(DEFAULT_BRAND_SCALE[500]),
    600: hex(DEFAULT_BRAND_SCALE[600]),
    700: hex(DEFAULT_BRAND_SCALE[700]),
    800: hex(DEFAULT_BRAND_SCALE[800]),
    900: hex(DEFAULT_BRAND_SCALE[900]),
    950: hex(DEFAULT_BRAND_SCALE[950]),
  },
  { _id: false },
)

const headerSchema = new mongoose.Schema(
  {
    background: hex("#ffffff"),
    text: hex("#374151"),
    icon: hex("#374151"),
    border: hex("#000000"),
    searchButtonBackground: hex("#84cc16"),
    searchButtonHoverBackground: hex("#65a30d"),
    searchButtonText: hex("#ffffff"),
    // The cart/wishlist count bubbles, which ship red rather than brand-coloured.
    badgeBackground: hex("#ef4444"),
    badgeText: hex("#ffffff"),
  },
  { _id: false },
)

const navbarSchema = new mongoose.Schema(
  {
    background: hex("#84cc16"),
    text: hex("#ffffff"),
    hoverBackground: hex("#65a30d"),
    hoverText: hex("#ffffff"),
    activeIndicator: hex("#ffffff"),
    buttonBackground: hex("#ffffff"),
    buttonText: hex("#84cc16"),
    dropdownBackground: hex("#ffffff"),
    dropdownText: hex("#374151"),
    dropdownHoverBackground: hex("#f3f4f6"),
    dropdownHoverText: hex("#111827"),
  },
  { _id: false },
)

// The site has two footers: a dark panel on desktop and a white accordion on
// mobile. Both are themeable, separately, so turning one dark or light cannot
// silently wreck the other.
const footerSchema = new mongoose.Schema(
  {
    background: hex("#1f1f39"),
    text: hex("#ffffff"),
    heading: hex("#ffffff"),
    link: hex("#ffffff"),
    linkHover: hex("#a3e635"),
    border: hex("#e5e7eb"),
    bottomBarBackground: hex("#1f1f39"),
    bottomBarText: hex("#ffffff"),
    mobileBackground: hex("#ffffff"),
    mobileText: hex("#374151"),
    mobileHeading: hex("#111827"),
    mobileLinkHover: hex("#f97316"),
  },
  { _id: false },
)

const buttonsSchema = new mongoose.Schema(
  {
    primaryBackground: hex("#84cc16"),
    primaryHoverBackground: hex("#65a30d"),
    primaryText: hex("#ffffff"),
    // "Buy Now" -- the orange CTA that sits beside Add to Cart.
    secondaryBackground: hex("#ea580c"),
    secondaryHoverBackground: hex("#c2410c"),
    secondaryText: hex("#ffffff"),
    secondaryBorder: hex("#ea580c"),
  },
  { _id: false },
)

const pageColorsSchema = new mongoose.Schema(
  {
    background: hex("#ffffff"),
    surface: hex("#f9fafb"),
    text: hex("#374151"),
    heading: hex("#111827"),
    muted: hex("#6b7280"),
    link: hex("#65a30d"),
    linkHover: hex("#4d7c0f"),
    border: hex("#e5e7eb"),
    // The live selling price is the red one on a product card; the struck-through
    // former price is the muted grey beside it.
    price: hex("#dc2626"),
    oldPrice: hex("#9ca3af"),
  },
  { _id: false },
)

const logosSchema = new mongoose.Schema(
  {
    headerDesktop: { type: String, default: "/admin-logo.svg", trim: true },
    headerMobile: { type: String, default: "/admin-logo.svg", trim: true },
    footer: { type: String, default: "/logo.png", trim: true },
    favicon: { type: String, default: "/favicon.png", trim: true },
    altText: { type: String, default: "GrabAtoZ", trim: true },
    // Rendered width in px for the desktop header logo; height stays auto.
    headerDesktopWidth: { type: Number, default: 176, min: 40, max: 480 },
    headerMobileWidth: { type: Number, default: 132, min: 40, max: 320 },
    footerWidth: { type: Number, default: 128, min: 40, max: 480 },
  },
  { _id: false },
)

/**
 * A per-page override. `pattern` is matched against the pathname with the
 * country/language prefix (/ae-en, /sa-ar, ...) already stripped, so one rule
 * covers every locale. `*` matches within a segment, `**` across segments.
 *
 * Only the sections whose `override*` flag is on are applied; everything else
 * falls through to the global theme.
 */
const pageOverrideSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, default: "", trim: true },
    pattern: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: false },
    // Built-in rows (Home, Shop, ...) cannot be deleted, only disabled.
    builtIn: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },

    overrideBrand: { type: Boolean, default: false },
    brandPrimary: hex("#84cc16"),
    brandScale: { type: brandScaleSchema, default: () => ({}) },

    overrideHeader: { type: Boolean, default: false },
    header: { type: headerSchema, default: () => ({}) },

    overrideNavbar: { type: Boolean, default: false },
    navbar: { type: navbarSchema, default: () => ({}) },

    overrideFooter: { type: Boolean, default: false },
    footer: { type: footerSchema, default: () => ({}) },

    overrideButtons: { type: Boolean, default: false },
    buttons: { type: buttonsSchema, default: () => ({}) },

    overridePage: { type: Boolean, default: false },
    page: { type: pageColorsSchema, default: () => ({}) },

    overrideLogos: { type: Boolean, default: false },
    logos: { type: logosSchema, default: () => ({}) },
  },
  { _id: false },
)

const themeSchema = new mongoose.Schema(
  {
    // Master switch. Off = the site renders with its built-in defaults, which
    // is the escape hatch if a saved palette turns out to be unusable.
    enabled: { type: Boolean, default: true },

    brandPrimary: hex(DEFAULT_BRAND_SCALE[500]),
    brandScale: { type: brandScaleSchema, default: () => ({}) },

    logos: { type: logosSchema, default: () => ({}) },
    header: { type: headerSchema, default: () => ({}) },
    navbar: { type: navbarSchema, default: () => ({}) },
    footer: { type: footerSchema, default: () => ({}) },
    buttons: { type: buttonsSchema, default: () => ({}) },
    page: { type: pageColorsSchema, default: () => ({}) },

    pages: { type: [pageOverrideSchema], default: [] },

    // Free-form CSS appended last, for the odd tweak no field covers.
    customCss: { type: String, default: "", maxlength: 20000 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
)

const Theme = mongoose.model("Theme", themeSchema)

export { DEFAULT_BRAND_SCALE }
export default Theme
