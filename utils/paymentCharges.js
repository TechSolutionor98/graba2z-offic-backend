import PaymentMethodCharge from "../models/paymentMethodChargeModel.js"

const normalizeCountryCode = (code) => String(code || "").trim().toUpperCase()

/**
 * Work out the payment-method charges that apply to an order.
 *
 * Read from the database rather than taken from the request, for the same
 * reason item prices and delivery bands are: a browser could otherwise drop the
 * COD handling fee simply by posting an empty list.
 *
 * Percentage charges are turned into money here, against the goods subtotal.
 * The order schema stores a charge as a plain { name, amount } pair, so a rate
 * that survived to the database would later be summed as if it were dirhams --
 * a 2% fee becoming AED 2. Resolving up front keeps every total downstream
 * correct without any of them needing to know about rates.
 *
 * @param {string} paymentMethod  cod | card | tabby | tamara | ...
 * @param {string} countryCode    ISO-2; a country rule replaces the default
 * @param {number} goodsAmount    Goods subtotal, before discounts, for the rates
 * @returns {{ charges: Array<{name: string, amount: number}>, total: number }}
 */
export const resolvePaymentCharges = async ({ paymentMethod, countryCode, goodsAmount } = {}) => {
  const method = String(paymentMethod || "").trim().toLowerCase()
  if (!method) return { charges: [], total: 0 }

  const country = normalizeCountryCode(countryCode)
  const scopes = country ? ["", country] : [""]

  const configs = await PaymentMethodCharge.find({
    paymentMethod: method,
    isActive: true,
    countryCode: { $in: scopes },
  }).lean()

  if (configs.length === 0) return { charges: [], total: 0 }

  // A country rule replaces the default rather than stacking on top of it,
  // matching how the storefront resolves them for display.
  const countryRule = country
    ? configs.find((config) => normalizeCountryCode(config.countryCode) === country)
    : null
  const applicable = countryRule || configs.find((config) => !normalizeCountryCode(config.countryCode))

  if (!applicable) return { charges: [], total: 0 }

  const goods = Number(goodsAmount) || 0

  const charges = (applicable.charges || [])
    .map((charge) => {
      const value = Number(charge.amount) || 0
      const isPercentage = charge.type === "percentage"
      const amount = isPercentage ? (goods * value) / 100 : value

      return {
        // The rate goes in the name so an invoice can still show "2%" even
        // though what is stored is now a settled money amount.
        name: isPercentage ? `${charge.name} (${value}%)` : charge.name,
        amount: Number(amount.toFixed(2)),
      }
    })
    .filter((charge) => charge.amount > 0)

  const total = charges.reduce((sum, charge) => sum + charge.amount, 0)

  return { charges, total: Number(total.toFixed(2)) }
}
