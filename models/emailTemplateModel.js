import mongoose from "mongoose";

const emailTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true, enum: ["order", "verification", "newsletter", "custom"] },
  // Not required at this level: a draft is saved precisely because it is not
  // finished, and a half-written template with no subject line yet must still
  // be keepable. The route enforces it for anything saved as finished.
  subject: { type: String, default: "" },
  // The rendered email. Kept because the sending path reads this and knows
  // nothing about blocks -- a template built in the drag-and-drop editor and one
  // written as raw HTML are the same thing by the time they are sent.
  // Same reasoning as the subject: required for a finished template, enforced in
  // the route, so an empty draft is still keepable.
  html: { type: String, default: "" },
  // The builder's own structure, so a template can be reopened and edited rather
  // than only overwritten. Absent on templates written before the builder
  // existed; those open in the HTML editor instead.
  blocks: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  settings: { type: mongoose.Schema.Types.Mixed, default: undefined },
  isDefault: { type: Boolean, default: false },
  // Saved from the "you have unsaved changes" prompt rather than finished. The
  // only difference is that it is labelled as one, so half-written work is not
  // mistaken for something ready to send.
  isDraft: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const EmailTemplate = mongoose.model("EmailTemplate", emailTemplateSchema);

export default EmailTemplate; 