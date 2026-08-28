import PaymentMethodCharge from "../models/paymentMethodChargeModel.js"

const TARGET_INDEX_NAME = "uniq_payment_charge_per_method_country"

/**
 * Payment method charges used to be one row per payment method for the whole
 * store, enforced by a unique index on `paymentMethod` alone. Charges are now
 * configurable per country, so that index has to go or a second country can
 * never be saved.
 *
 * Also backfills `countryCode: ""` on existing rows, which marks them as the
 * default rule every country inherits until it gets its own.
 */
export const ensurePaymentChargeIndexes = async () => {
  try {
    const backfilled = await PaymentMethodCharge.updateMany(
      { countryCode: { $in: [null, undefined] } },
      { $set: { countryCode: "" } },
    )

    if (backfilled.modifiedCount > 0) {
      console.log(`Marked ${backfilled.modifiedCount} payment charge row(s) as the default (all countries) rule`)
    }

    const indexes = await PaymentMethodCharge.collection.indexes()

    const legacyMethodUnique = indexes.find((index) => {
      const keys = Object.keys(index.key || {})
      return index.unique && keys.length === 1 && keys[0] === "paymentMethod"
    })

    if (legacyMethodUnique) {
      console.log(`Dropping legacy global payment charge index: ${legacyMethodUnique.name}`)
      await PaymentMethodCharge.collection.dropIndex(legacyMethodUnique.name)
    }

    // Match on key shape, not name. Mongoose autoIndex creates this index itself
    // as "paymentMethod_1_countryCode_1"; creating it again under our own name
    // would be rejected as a duplicate.
    const alreadyScoped = indexes.some((index) => {
      const keys = Object.keys(index.key || {})
      return keys.length === 2 && keys.includes("paymentMethod") && keys.includes("countryCode")
    })

    if (!alreadyScoped) {
      await PaymentMethodCharge.collection.createIndex(
        { paymentMethod: 1, countryCode: 1 },
        { unique: true, name: TARGET_INDEX_NAME },
      )
      console.log(`Ensured payment charge index: ${TARGET_INDEX_NAME}`)
    }
  } catch (error) {
    // Never block server boot over an index.
    if (error?.code === 11000) {
      console.error(
        "Failed to ensure payment charge indexes: duplicate payment method / country rows exist. Remove the duplicates and restart.",
      )
      return
    }
    console.error("Failed to ensure payment charge indexes:", error.message)
  }
}

export default ensurePaymentChargeIndexes
