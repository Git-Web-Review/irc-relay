import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";

Mustache.escape = (value) => String(value);

const defaultTemplatesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);
const templateCache = new Map();

const statusLabels = {
  FR: {
    PENDING: "En attente",
    IN_REVIEW: "En review",
    APPROVED: "Approuvee",
    CHANGES_REQUESTED: "Modifications demandees",
    CLOSED: "Done",
  },
  EN: {
    PENDING: "Pending",
    IN_REVIEW: "In review",
    APPROVED: "Approved",
    CHANGES_REQUESTED: "Changes requested",
    CLOSED: "Done",
  },
};

function normalizeLocale(locale) {
  return String(locale ?? "FR").toUpperCase() === "EN" ? "EN" : "FR";
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function reviewTitle(payload) {
  return (
    asString(payload.title) ??
    asString(payload.gitwebTitle) ??
    asString(payload.reviewId) ??
    "Review"
  );
}

function reviewUrl(payload, frontendUrl) {
  const reviewId = asString(payload.reviewId);
  if (reviewId) {
    return `${frontendUrl}/review/${encodeURIComponent(reviewId)}`;
  }

  return asString(payload.gitwebUrl);
}

function statusLabel(locale, status) {
  const key = asString(status);
  return key ? (statusLabels[locale][key] ?? key) : null;
}

function eventView(event, options) {
  const locale = normalizeLocale(event.user?.locale);
  const payload =
    event.payload && typeof event.payload === "object" ? event.payload : {};
  const frontendUrl = options.frontendUrl.replace(/\/$/, "");
  const url = reviewUrl(payload, frontendUrl);
  const gitwebUrl = asString(payload.gitwebUrl);

  return {
    app: "git-web-review",
    locale,
    type: event.type,
    notificationId: event.notificationId,
    createdAt: event.createdAt,
    user: event.user,
    payload,
    title: reviewTitle(payload),
    url,
    gitwebUrl,
    hasUrl: !!url,
    hasGitwebUrl: !!gitwebUrl,
    showGitwebUrl: !!gitwebUrl && gitwebUrl !== url,
    actor: asString(payload.actorNickname) ?? asString(payload.actorEmail),
    ownerEmail: asString(payload.ownerEmail),
    message: asString(payload.message),
    previousStatus: asString(payload.previousStatus),
    nextStatus: asString(payload.nextStatus),
    previousStatusLabel: statusLabel(locale, payload.previousStatus),
    nextStatusLabel: statusLabel(locale, payload.nextStatus),
    sourceProject: asString(payload.sourceProject),
    sourceBranch: asString(payload.sourceBranch),
    sourceCommit: asString(payload.sourceCommit),
    rawPayload: JSON.stringify(payload),
  };
}

async function readTemplate(templatesDir, locale, type) {
  const filePath = path.join(templatesDir, locale, `${type}.mustache`);
  const cacheKey = filePath;
  if (templateCache.has(cacheKey)) {
    return templateCache.get(cacheKey);
  }

  const template = await fs.readFile(filePath, "utf8");
  templateCache.set(cacheKey, template);
  return template;
}

async function loadTemplate(event, templatesDir) {
  const locale = normalizeLocale(event.user?.locale);
  const type = asString(event.type) ?? "DEFAULT";
  const candidates = [
    [locale, type],
    ["FR", type],
    [locale, "DEFAULT"],
    ["FR", "DEFAULT"],
  ];

  for (const [candidateLocale, candidateType] of candidates) {
    try {
      return await readTemplate(templatesDir, candidateLocale, candidateType);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(`No notification template found for ${locale}/${type}`);
}

export async function renderIrcNotification(event, options) {
  const templatesDir = options.templatesDir ?? defaultTemplatesDir;
  const template = await loadTemplate(event, templatesDir);
  return Mustache.render(template, eventView(event, options))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" - ");
}
