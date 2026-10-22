import express from "express";
import asyncHandler from "express-async-handler";

import EmailCampaign from "../models/emailCampaignModel.js";
import CampaignRecipient from "../models/campaignRecipientModel.js";
import EmailSuppression from "../models/emailSuppressionModel.js";
import EmailTemplate from "../models/emailTemplateModel.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  audienceSummary,
  listAudience,
  prepareRecipients,
  runCampaign,
  personalize,
  ensureUnsubscribe,
  verifyUnsubscribeToken,
  normalizeEmail,
  isValidEmail,
  isRunning,
  listsContaining,
  SOURCE_LABELS,
} from "../services/campaignService.js";
import { sendEmail, availableMailboxes } from "../utils/emailService.js";

const router = express.Router();

const adminOnly = [protect, admin];

// ---------------------------------------------------------------------------
// Unsubscribing -- deliberately before the admin routes and deliberately open.
// ---------------------------------------------------------------------------

/**
 * A page, not JSON: this address is opened by a customer in whatever mail
 * client they use, and they need to see that it worked.
 */
const unsubscribePage = (message, detail) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${message}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:12vh auto;background:#fff;border-radius:12px;padding:40px 32px;text-align:center;">
    <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">${message}</h1>
    <p style="margin:0;font-size:14px;line-height:22px;color:#6b7280;">${detail}</p>
  </div>
</body></html>`;

const doUnsubscribe = async (token) => {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return null;

  await EmailSuppression.updateOne(
    { email: parsed.email },
    { $setOnInsert: { email: parsed.email, reason: "unsubscribed", campaign: parsed.campaignId || null } },
    { upsert: true }
  );

  // Anything still queued for this person on any campaign stops now rather
  // than at the next audience rebuild.
  await CampaignRecipient.updateMany(
    { email: parsed.email, status: "pending" },
    { $set: { status: "skipped", error: "Unsubscribed" } }
  );

  return parsed.email;
};

router.get(
  "/unsubscribe/:token",
  asyncHandler(async (req, res) => {
    const email = await doUnsubscribe(req.params.token);
    res.status(email ? 200 : 400).send(
      email
        ? unsubscribePage("You have been unsubscribed", `We will not send marketing email to ${email} again.`)
        : unsubscribePage("That link is not valid", "It may have been broken by your mail app. Reply to any of our emails and we will remove you.")
    );
  })
);

/**
 * The one-click form of the same thing. Gmail and Outlook POST here without
 * the person ever seeing a page, and they treat a sender that does not offer
 * it as more likely to be spam.
 */
router.post(
  "/unsubscribe/:token",
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const email = await doUnsubscribe(req.params.token);
    res.status(email ? 200 : 400).json({ ok: Boolean(email) });
  })
);

// ---------------------------------------------------------------------------
// The signed-in customer's own preference
// ---------------------------------------------------------------------------

/**
 * A customer managing their own marketing email.
 *
 * `protect` only, not `adminOnly`: this is for the person themselves. The
 * address is taken from the session rather than the request body, so being
 * signed in lets somebody change their own preference and nobody else's -- a
 * body-supplied address would be an open unsubscribe form for the whole
 * customer list.
 */
router.get("/me/subscription", protect, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.user?.email);
  const row = await EmailSuppression.findOne({ email }).select("createdAt reason").lean();
  res.json({
    email,
    subscribed: !row,
    since: row?.createdAt || null,
    reason: row?.reason || null,
  });
}));

router.post("/me/unsubscribe", protect, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.user?.email);
  if (!isValidEmail(email)) {
    res.status(400);
    throw new Error("Your account has no usable email address.");
  }

  await EmailSuppression.updateOne(
    { email },
    { $setOnInsert: { email, reason: "unsubscribed", note: "Asked through the account page" } },
    { upsert: true }
  );
  // Anything already queued for this person stops now, not at the next rebuild.
  await CampaignRecipient.updateMany(
    { email, status: "pending" },
    { $set: { status: "skipped", error: "Unsubscribed" } }
  );

  res.json({ email, subscribed: false, message: "You will not receive marketing email from us again." });
}));

/** Opting back in -- the same person, undoing their own decision. */
router.post("/me/resubscribe", protect, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.user?.email);
  await EmailSuppression.deleteOne({ email });
  res.json({ email, subscribed: true, message: "You will receive our offers again." });
}));

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

router.get("/sources", ...adminOnly, asyncHandler(async (req, res) => {
  res.json(Object.entries(SOURCE_LABELS).map(([key, label]) => ({ key, label })));
}));

/**
 * The mailboxes this server can actually send from.
 *
 * Read from the environment rather than hard-coded in the screen, so a mailbox
 * whose password has not been set does not appear as a choice that silently
 * fails when somebody picks it.
 */
router.get("/senders", ...adminOnly, asyncHandler(async (req, res) => {
  res.json(availableMailboxes());
}));

/** Live counts for the audience step, including what the overlap costs. */
router.post(
  "/audience",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const { sources = [], onlyVerifiedUsers = false, excludeAdmins = true, mode, picked } = req.body || {};
    const summary = await audienceSummary(sources, { onlyVerifiedUsers, excludeAdmins, mode, picked });
    res.json(summary);
  })
);

/** The addresses themselves, for picking them one at a time. */
router.post(
  "/audience/list",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const {
      sources = [],
      onlyVerifiedUsers = false,
      excludeAdmins = true,
      search = "",
      page = 1,
      limit = 100,
    } = req.body || {};
    const result = await listAudience(sources, { onlyVerifiedUsers, excludeAdmins }, { search, page, limit });
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

router.get("/", ...adminOnly, asyncHandler(async (req, res) => {
  const campaigns = await EmailCampaign.find()
    .populate("template", "name")
    .sort({ createdAt: -1 })
    .lean();
  res.json(campaigns.map((c) => ({ ...c, isRunning: isRunning(c._id) })));
}));

router.get("/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id).populate("template", "name subject").lean();
  if (!campaign) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }
  res.json({ ...campaign, isRunning: isRunning(campaign._id) });
}));

/** Who it went to and what happened, one row per person. */
router.get("/:id/recipients", ...adminOnly, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const query = { campaign: req.params.id };
  if (status && status !== "all") query.status = status;

  const perPage = Math.min(200, Math.max(1, Number(limit) || 50));
  const skip = (Math.max(1, Number(page) || 1) - 1) * perPage;

  const [rows, total] = await Promise.all([
    CampaignRecipient.find(query).sort({ createdAt: 1 }).skip(skip).limit(perPage).lean(),
    CampaignRecipient.countDocuments(query),
  ]);

  res.json({ rows, total, page: Number(page) || 1, pages: Math.ceil(total / perPage) || 1 });
}));

const readBody = (body = {}) => ({
  name: String(body.name || "").trim(),
  subject: String(body.subject || "").trim(),
  preheader: String(body.preheader || "").trim(),
  template: body.template || null,
  audience: {
    sources: Array.isArray(body.audience?.sources) ? body.audience.sources : [],
    onlyVerifiedUsers: Boolean(body.audience?.onlyVerifiedUsers),
    excludeAdmins: body.audience?.excludeAdmins !== false,
    mode: body.audience?.mode === "pick" ? "pick" : "all",
    // Normalised on the way in, so a ticked address matches the list it came
    // from however it was typed or stored.
    picked: Array.isArray(body.audience?.picked)
      ? [...new Set(body.audience.picked.map(normalizeEmail).filter(isValidEmail))]
      : [],
  },
  throttlePerMinute: Math.min(600, Math.max(1, Number(body.throttlePerMinute) || 30)),
  // Checked against what is actually configured, so a campaign cannot be saved
  // pointing at a mailbox the server has no credentials for.
  sender: availableMailboxes().some((m) => m.key === body.sender) ? body.sender : "support",
});

router.post("/", ...adminOnly, asyncHandler(async (req, res) => {
  const data = readBody(req.body);
  if (!data.name) {
    res.status(400);
    throw new Error("Give the campaign a name before saving it.");
  }
  const campaign = await EmailCampaign.create({ ...data, createdBy: req.user?._id || null });
  res.status(201).json(campaign);
}));

router.put("/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }
  // A campaign that has gone out is a record of what was sent. Editing it would
  // make that record describe an email nobody received.
  if (["sending", "sent"].includes(campaign.status)) {
    res.status(400);
    throw new Error("This campaign has already gone out and can no longer be edited. Duplicate it instead.");
  }

  const data = readBody(req.body);
  if (!data.name) {
    res.status(400);
    throw new Error("Give the campaign a name before saving it.");
  }
  Object.assign(campaign, data);
  await campaign.save();
  res.json(campaign);
}));

/** Start again from a finished campaign, audience and all, as a fresh draft. */
router.post("/:id/duplicate", ...adminOnly, asyncHandler(async (req, res) => {
  const original = await EmailCampaign.findById(req.params.id).lean();
  if (!original) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }
  const copy = await EmailCampaign.create({
    name: `${original.name} (copy)`,
    subject: original.subject,
    preheader: original.preheader,
    template: original.template,
    audience: original.audience,
    throttlePerMinute: original.throttlePerMinute,
    sender: original.sender,
    createdBy: req.user?._id || null,
  });
  res.status(201).json(copy);
}));

router.delete("/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }
  if (campaign.status === "sending") {
    res.status(400);
    throw new Error("Pause this campaign before deleting it.");
  }
  await CampaignRecipient.deleteMany({ campaign: campaign._id });
  await campaign.deleteOne();
  res.json({ message: "Campaign deleted" });
}));

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** One copy to one address, so the thing can be read before thousands get it. */
router.post("/:id/test", ...adminOnly, asyncHandler(async (req, res) => {
  const to = normalizeEmail(req.body?.to);
  if (!isValidEmail(to)) {
    res.status(400);
    throw new Error("Enter a valid email address to send the test to.");
  }

  const campaign = await EmailCampaign.findById(req.params.id).populate("template", "html subject");
  if (!campaign) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }

  const html = campaign.html || campaign.template?.html || "";
  if (!html.trim()) {
    res.status(400);
    throw new Error("Pick a template before sending a test.");
  }

  const recipient = { email: to, name: "Test" };
  let body = personalize(html, recipient, campaign);
  body = ensureUnsubscribe(body, recipient, campaign);

  const subject = `[TEST] ${personalize(campaign.subject || campaign.template?.subject || "", recipient, campaign)}`;
  const result = await sendEmail(to, subject, body, campaign.sender || "support", {
    log: { source: "Campaign test", templateName: campaign.name, campaign: campaign._id },
  });

  const accepted = Array.isArray(result?.accepted) && result.accepted.some((a) => normalizeEmail(a) === to);
  if (!accepted) {
    res.status(502);
    throw new Error("The mail server did not accept that address, so nothing was sent.");
  }
  res.json({ message: `Test sent to ${to}.`, messageId: result?.messageId || "" });
}));

/**
 * Gathers the audience, freezes the HTML, and starts the worker.
 *
 * The response does not wait for the send: a campaign of a few thousand paced
 * messages takes much longer than any browser will hold a request open for.
 */
router.post("/:id/send", ...adminOnly, asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id).populate("template", "html subject");
  if (!campaign) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }
  if (campaign.status === "sending") {
    res.status(400);
    throw new Error("This campaign is already going out.");
  }
  if (campaign.status === "sent") {
    res.status(400);
    throw new Error("This campaign has already been sent. Duplicate it to send it again.");
  }

  // Said separately so the person is told which piece is missing, rather than
  // being handed one message covering three different mistakes.
  if (!campaign.subject.trim() && !campaign.template?.subject) {
    res.status(400);
    throw new Error("Add a subject line before sending.");
  }
  if (!campaign.template) {
    res.status(400);
    throw new Error("Pick the template this campaign should send.");
  }
  if (!campaign.audience?.sources?.length) {
    res.status(400);
    throw new Error("Choose at least one audience before sending.");
  }
  if (campaign.audience.mode === "pick" && !campaign.audience.picked?.length) {
    res.status(400);
    throw new Error("You chose to pick addresses but ticked none. Tick the people this should go to.");
  }

  const html = campaign.template?.html || "";
  if (!html.trim()) {
    res.status(400);
    throw new Error("That template has no content in it.");
  }

  const total = await prepareRecipients(campaign);
  if (!total) {
    res.status(400);
    throw new Error("Nobody in the chosen lists can be emailed. They may all have unsubscribed.");
  }

  campaign.html = html;
  if (!campaign.subject.trim()) campaign.subject = campaign.template.subject || "";
  campaign.status = "sending";
  campaign.startedAt = campaign.startedAt || new Date();
  campaign.stats.total = total;
  campaign.lastError = "";
  await campaign.save();

  // Not awaited on purpose -- see above.
  runCampaign(campaign._id);

  res.json({ message: `Sending to ${total} ${total === 1 ? "person" : "people"}.`, total });
}));

router.post("/:id/pause", ...adminOnly, asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }
  if (campaign.status !== "sending") {
    res.status(400);
    throw new Error("This campaign is not sending.");
  }
  campaign.status = "paused";
  await campaign.save();
  // The worker checks the status each time round, so it stops after the
  // message already in flight rather than abandoning it halfway.
  res.json({ message: "Pausing. The message already going out will finish first." });
}));

router.post("/:id/resume", ...adminOnly, asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("That campaign no longer exists.");
  }
  if (!["paused", "failed"].includes(campaign.status)) {
    res.status(400);
    throw new Error("This campaign is not paused.");
  }
  campaign.status = "sending";
  campaign.lastError = "";
  await campaign.save();
  runCampaign(campaign._id);

  const left = await CampaignRecipient.countDocuments({ campaign: campaign._id, status: "pending" });
  res.json({ message: `Resuming. ${left} left to go.`, left });
}));

// ---------------------------------------------------------------------------
// Unsubscribe list
// ---------------------------------------------------------------------------

router.get("/suppression/list", ...adminOnly, asyncHandler(async (req, res) => {
  const { search = "", page = 1, limit = 50 } = req.query;

  const query = {};
  if (String(search).trim()) {
    // Escaped: an address is a search term, not a pattern.
    const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.email = new RegExp(safe, "i");
  }

  const perPage = Math.min(200, Math.max(1, Number(limit) || 50));
  const skip = (Math.max(1, Number(page) || 1) - 1) * perPage;

  const [rows, total] = await Promise.all([
    EmailSuppression.find(query).sort({ createdAt: -1 }).skip(skip).limit(perPage).lean(),
    EmailSuppression.countDocuments(query),
  ]);

  // Which of the four lists each person is on, so the report says where they
  // came from rather than only that they left. Looked up for the addresses on
  // this page only -- doing it for the whole suppression list would mean
  // reading four collections in full to render fifty rows.
  const addresses = rows.map((r) => r.email);
  const sources = await listsContaining(addresses);

  res.json({
    rows: rows.map((r) => ({ ...r, sources: sources[r.email] || [] })),
    total,
    page: Number(page) || 1,
    pages: Math.ceil(total / perPage) || 1,
  });
}));

/** Adding by hand, for somebody who asked to be removed by phone or in person. */
router.post("/suppression", ...adminOnly, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    res.status(400);
    throw new Error("Enter a valid email address.");
  }
  await EmailSuppression.updateOne(
    { email },
    { $setOnInsert: { email, reason: "manual", note: String(req.body?.note || "").slice(0, 300) } },
    { upsert: true }
  );
  await CampaignRecipient.updateMany(
    { email, status: "pending" },
    { $set: { status: "skipped", error: "Unsubscribed" } }
  );
  res.status(201).json({ message: `${email} will not receive marketing email.` });
}));

export default router;
