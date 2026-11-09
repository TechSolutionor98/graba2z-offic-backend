import mongoose from "mongoose"

/**
 * A signup that has been started but not yet proved.
 *
 * Registration used to create the real User straight away with
 * `isEmailVerified: false`. That had one consequence nobody wanted: the email
 * address was occupied from the first click. Somebody who never received the
 * code -- or never got round to entering it -- could not sign up again, because
 * their own half-finished account answered "User already exists". The only way
 * out was for an admin to go and delete the row by hand.
 *
 * So the account now lives here until the code is entered, and only then becomes
 * a User. Nothing in the users collection is created on the way.
 *
 * Two things follow from that and are deliberate:
 *
 *  - The row carries the *hashed* password, never the plaintext. An unverified
 *    signup is still somebody's real password, and it sits in the database for
 *    as long as the attempt lives.
 *  - Rows expire by themselves. A signup nobody finished is rubbish after a
 *    day, and leaving it would re-create the very problem this collection
 *    exists to solve -- an address held by an attempt that is going nowhere.
 */
const pendingRegistrationSchema = mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
    },
    // bcrypt hash, produced the same way userModel's pre-save hook produces it.
    passwordHash: {
      type: String,
      required: true,
    },
    verificationCode: {
      type: String,
      required: true,
    },
    verificationExpires: {
      type: Date,
      required: true,
    },

    // Carried across so the account that is finally created is attributed the
    // same way it would have been had it been created at the first step.
    registrationSource: {
      type: String,
      default: "web",
    },
    registrationPlatform: {
      type: String,
      default: null,
    },
    // The invite this person arrived on, redeemed only once the account is real.
    referralCode: {
      type: String,
      default: "",
    },

    // How many codes have been sent for this attempt. Read by the resend route so
    // one address cannot be used to post mail at somebody else indefinitely.
    sendCount: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true },
)

// Mongo deletes the row 24 hours after it was last written. `expireAfterSeconds`
// works off the field's own value, so touching `updatedAt` on a resend extends
// the attempt rather than letting it die mid-signup.
pendingRegistrationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 })

pendingRegistrationSchema.methods.codeIsValid = function (code) {
  if (!this.verificationCode || !this.verificationExpires) return false
  if (new Date() > this.verificationExpires) return false
  return this.verificationCode === String(code).trim()
}

const PendingRegistration = mongoose.model("PendingRegistration", pendingRegistrationSchema)

export default PendingRegistration
