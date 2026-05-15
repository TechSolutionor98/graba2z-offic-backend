import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "../..")

export const STATIC_PAGE_TRANSLATION_SOURCES = [
  {
    pageKey: "about",
    routePath: "/about",
    sourceFile: "client/src/pages/About.jsx",
  },
  {
    pageKey: "refund-return",
    routePath: "/refund-return",
    sourceFile: "client/src/pages/RefundAndReturn.jsx",
  },
  {
    pageKey: "cookies-policy",
    routePath: "/cookies-policy",
    sourceFile: "client/src/pages/CookiesAndPolicy.jsx",
  },
  {
    pageKey: "terms-conditions",
    routePath: "/terms-conditions",
    sourceFile: "client/src/pages/TermAndCondition.jsx",
  },
  {
    pageKey: "privacy-policy",
    routePath: "/privacy-policy",
    sourceFile: "client/src/pages/PrivacyAndPolicy.jsx",
  },
  {
    pageKey: "disclaimer-policy",
    routePath: "/disclaimer-policy",
    sourceFile: "client/src/pages/DisclaimerPolicy.jsx",
  },
  {
    pageKey: "track-order",
    routePath: "/track-order",
    sourceFile: "client/src/pages/TrackOrder.jsx",
  },
  {
    pageKey: "voucher-terms",
    routePath: "/voucher-terms",
    sourceFile: "client/src/pages/VoucherTerms.jsx",
  },
  {
    pageKey: "delivery-terms",
    routePath: "/delivery-terms",
    sourceFile: "client/src/pages/DeliveryTerms.jsx",
  },
]

export const resolveSourceFilePath = (sourceFile) => path.resolve(repoRoot, sourceFile)
