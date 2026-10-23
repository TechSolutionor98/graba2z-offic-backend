import express from "express";
import mongoose from "mongoose";
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
 * Pages, not JSON: these are opened by a customer in whatever mail client they
 * use, so they have to stand on their own with no stylesheet to load.
 */
const SHELL = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:540px;margin:10vh auto;background:#fff;border-radius:12px;padding:36px 32px;">
    <div style="text-align:center;margin-bottom:22px;">
      <img src="https://www.grabatoz.ae/email-logo.png" alt="GrabAtoZ" width="150"
           style="width:150px;max-width:60%;height:auto;border:0;"/>
    </div>
    ${body}
  </div>
</body></html>`;

const noticePage = (heading, detail, extra = "") =>
  SHELL(
    heading,
    `<h1 style="margin:0 0 12px;font-size:20px;color:#111827;text-align:center;">${heading}</h1>
     <p style="margin:0;font-size:14px;line-height:22px;color:#6b7280;text-align:center;">${detail}</p>${extra}`
  );

/** A plain-text value going into HTML we are building by hand. */
const esc = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const button = (label, colour = "#84cc16") =>
  `<button type="submit" style="display:block;width:100%;margin-top:18px;padding:13px 20px;border:0;` +
  `border-radius:8px;background:${colour};color:#fff;font-size:15px;font-weight:bold;cursor:pointer;">${label}</button>`;

/**
 * The form a person sees when they follow the link in an email.
 *
 * Deliberately does not unsubscribe anybody. A link is followed by mail
 * scanners, link checkers and accidental taps, and acting on a GET means any
 * of those can quietly opt a customer out of email they wanted. Nothing
 * changes until the person presses the button on this page.
 */
const unsubscribeForm = (token, email) =>
  SHELL(
    "Unsubscribe",
    `<h1 style="margin:0 0 10px;font-size:20px;color:#111827;text-align:center;">Unsubscribe from our emails?</h1>
     <p style="margin:0 0 4px;font-size:14px;line-height:22px;color:#6b7280;text-align:center;">
       This will stop offers and news going to</p>
     <p style="margin:0 0 20px;font-size:15px;font-weight:bold;color:#111827;text-align:center;">${esc(email)}</p>
     <p style="margin:0 0 20px;font-size:13px;line-height:20px;color:#6b7280;background:#f9fafb;border-radius:8px;padding:12px 14px;">
       You will still get order confirmations and delivery updates. Those are part of buying from us
       and are not marketing.
     </p>
     <form method="POST" action="/api/campaigns/unsubscribe/${encodeURIComponent(token)}">
       <label style="display:block;font-size:13px;font-weight:bold;color:#374151;margin-bottom:6px;">
         Why are you leaving? <span style="font-weight:normal;color:#9ca3af;">Optional</span>
       </label>
       <select name="reasonText" style="width:100%;padding:11px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;color:#374151;background:#fff;">
         <option value="">Prefer not to say</option>
         <option value="Too many emails">Too many emails</option>
         <option value="Not relevant to me">Not relevant to me</option>
         <option value="I never signed up">I never signed up</option>
         <option value="No longer shopping here">No longer shopping here</option>
       </select>
       ${button("Yes, unsubscribe me", "#dc2626")}
     </form>
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280;text-align:center;">
       Changed your mind? <a href="https://www.grabatoz.ae" style="color:#65a30d;">Keep receiving them</a>
     </p>`
  );

const doUnsubscribe = async (token, reasonText = "") => {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return null;

  // Only stored when it really is an id. The campaign in a token is just text
  // that was signed; writing it straight into an ObjectId field means any token
  // carrying something else makes this endpoint throw -- and the one endpoint
  // that must never fail is the one that stops us emailing somebody.
  const campaign = mongoose.isValidObjectId(parsed.campaignId) ? parsed.campaignId : null;

  await EmailSuppression.updateOne(
    { email: parsed.email },
    {
      $setOnInsert: {
        email: parsed.email,
        reason: "unsubscribed",
        campaign,
        note: String(reasonText || "").slice(0, 200),
      },
    },
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

/** True for a person in a browser, false for a mail client's one-click POST. */
const wantsHtml = (req) => String(req.get("accept") || "").includes("text/html");

const badLink = (res) =>
  res
    .status(400)
    .send(
      noticePage(
        "That link is not valid",
        "It may have been broken by your mail app. Reply to any of our emails and we will remove you."
      )
    );

// The link in an email: shows the form, changes nothing.
router.get(
  "/unsubscribe/:token",
  asyncHandler(async (req, res) => {
    const parsed = verifyUnsubscribeToken(req.params.token);
    if (!parsed) return badLink(res);
    res.send(unsubscribeForm(req.params.token, parsed.email));
  })
);

/**
 * Pressing the button on that form -- and also the one-click unsubscribe Gmail
 * and Outlook send.
 *
 * Those two have to share this route: RFC 8058 requires the POST named in
 * List-Unsubscribe to opt the person out immediately, with no confirmation
 * step, and mail clients treat a sender that does not offer it as more likely
 * to be spam. A browser gets a page back; a mail client gets JSON.
 */
router.post(
  "/unsubscribe/:token",
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const email = await doUnsubscribe(req.params.token, req.body?.reasonText);
    if (!email) return wantsHtml(req) ? badLink(res) : res.status(400).json({ ok: false });
    if (!wantsHtml(req)) return res.json({ ok: true });

    res.send(
      noticePage(
        "You have been unsubscribed",
        `We will not send marketing email to ${esc(email)} again.`,
        `<form method="POST" action="/api/campaigns/resubscribe/${encodeURIComponent(req.params.token)}"
               style="margin-top:22px;border-top:1px solid #f3f4f6;padding-top:18px;">
           <p style="margin:0;font-size:13px;color:#6b7280;text-align:center;">Unsubscribed by mistake?</p>
           ${button("Subscribe me again")}
         </form>`
      )
    );
  })
);

/**
 * Back on. Reached from the page above, or from the link in the footer of this
 * page, so somebody who clicked by accident is one press from undoing it
 * rather than having to write in.
 */
router.get(
  "/resubscribe/:token",
  asyncHandler(async (req, res) => {
    const parsed = verifyUnsubscribeToken(req.params.token);
    if (!parsed) return badLink(res);

    res.send(
      SHELL(
        "Subscribe again",
        `<h1 style="margin:0 0 10px;font-size:20px;color:#111827;text-align:center;">Start receiving our emails again?</h1>
         <p style="margin:0 0 4px;font-size:14px;line-height:22px;color:#6b7280;text-align:center;">Offers and news will go to</p>
         <p style="margin:0 0 20px;font-size:15px;font-weight:bold;color:#111827;text-align:center;">${esc(parsed.email)}</p>
         <form method="POST" action="/api/campaigns/resubscribe/${encodeURIComponent(req.params.token)}">
           ${button("Yes, subscribe me again")}
         </form>`
      )
    );
  })
);

router.post(
  "/resubscribe/:token",
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const parsed = verifyUnsubscribeToken(req.params.token);
    if (!parsed) return wantsHtml(req) ? badLink(res) : res.status(400).json({ ok: false });

    await EmailSuppression.deleteOne({ email: parsed.email });
    if (!wantsHtml(req)) return res.json({ ok: true });

    res.send(
      noticePage(
        "You are subscribed again",
        `We will send our offers and news to ${esc(parsed.email)}.`
      )
    );
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
// The unsubscribe list
//
// Declared before the campaign routes below: those end in "/:id", and Express
// matches in order, so "/suppression" would otherwise be read as a campaign id
// and every call here would fail trying to cast it.
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

/**
 * Taking somebody off the unsubscribe list by hand.
 *
 * For a customer who asks to be put back -- by phone, in the shop, by reply.
 * It is deliberately an admin action on one named address, not something a
 * campaign can do in bulk: an opt-out is only ever undone because the person
 * asked.
 */
router.delete("/suppression", ...adminOnly, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.query?.email || req.body?.email);
  if (!isValidEmail(email)) {
    res.status(400);
    throw new Error("Enter a valid email address.");
  }

  const { deletedCount } = await EmailSuppression.deleteOne({ email });
  if (!deletedCount) {
    res.status(404);
    throw new Error(`${email} is not on the unsubscribe list.`);
  }

  res.json({ message: `${email} will receive marketing email again.` });
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

  // No "[TEST]" prefix: the point of a test is to see precisely what the
  // customer will see, subject line included. The Report tab records it as a
  // test, so the two are still told apart where it matters.
  const subject = personalize(campaign.subject || campaign.template?.subject || "", recipient, campaign);
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

export default router;
