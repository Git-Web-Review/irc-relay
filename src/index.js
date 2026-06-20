import Redis from "ioredis";
import irc from "irc-framework";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisChannel = process.env.REDIS_CHANNEL ?? "notifications:irc";
const frontendUrl = (
  process.env.FRONTEND_URL ?? "http://localhost:5173"
).replace(/\/$/, "");
const dryRun = parseBoolean(process.env.IRC_DRY_RUN ?? "false");
const subscriber = new Redis(redisUrl);
const client = dryRun ? null : new irc.Client();
let ircRegistered = false;

const translations = {
  FR: {
    app: "git-web-review",
    notification: "Notification",
    textNotification: "Notification",
    reviewPending: "Review a faire",
    reviewStatusChanged: "Statut de review modifie",
    commentReceived: "Commentaire recu",
    openedBy: "par",
    updatedBy: "par",
    statuses: {
      PENDING: "En attente",
      IN_REVIEW: "En review",
      APPROVED: "Approuvee",
      CHANGES_REQUESTED: "Modifications demandees",
      CLOSED: "Done",
    },
  },
  EN: {
    app: "git-web-review",
    notification: "Notification",
    textNotification: "Notification",
    reviewPending: "Review requested",
    reviewStatusChanged: "Review status changed",
    commentReceived: "Comment received",
    openedBy: "by",
    updatedBy: "by",
    statuses: {
      PENDING: "Pending",
      IN_REVIEW: "In review",
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
      CLOSED: "Done",
    },
  },
};

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value));
}

function normalizeLocale(locale) {
  return String(locale ?? "FR").toUpperCase() === "EN" ? "EN" : "FR";
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseEvent(message) {
  try {
    const event = JSON.parse(message);
    if (!event || typeof event !== "object") {
      return null;
    }

    const user = event.user;
    if (!user || typeof user !== "object") {
      return null;
    }

    return event;
  } catch (error) {
    console.error("Invalid Redis notification event", error);
    return null;
  }
}

function reviewTitle(payload) {
  return (
    asString(payload.title) ??
    asString(payload.gitwebTitle) ??
    asString(payload.reviewId) ??
    "Review"
  );
}

function reviewUrl(payload) {
  const reviewId = asString(payload.reviewId);
  if (reviewId) {
    return `${frontendUrl}/review/${encodeURIComponent(reviewId)}`;
  }

  return asString(payload.gitwebUrl);
}

function statusLabel(labels, status) {
  const key = asString(status);
  return key ? (labels.statuses[key] ?? key) : null;
}

function formatEvent(event) {
  const payload =
    event.payload && typeof event.payload === "object" ? event.payload : {};
  const labels = translations[normalizeLocale(event.user.locale)];
  const title = reviewTitle(payload);
  const url = reviewUrl(payload);

  switch (event.type) {
    case "REVIEW_PENDING": {
      const ownerEmail = asString(payload.ownerEmail);
      return compact([
        `[${labels.app}] ${labels.reviewPending}: ${title}`,
        ownerEmail ? `${labels.openedBy} ${ownerEmail}` : null,
        url,
      ]).join(" - ");
    }
    case "REVIEW_STATUS_CHANGED": {
      const previousStatus = statusLabel(labels, payload.previousStatus) ?? "-";
      const nextStatus = statusLabel(labels, payload.nextStatus) ?? "-";
      const actor =
        asString(payload.actorNickname) ?? asString(payload.actorEmail);
      return compact([
        `[${labels.app}] ${labels.reviewStatusChanged}: ${title}`,
        `${previousStatus} -> ${nextStatus}`,
        actor ? `${labels.updatedBy} ${actor}` : null,
        url,
      ]).join(" - ");
    }
    case "TEXT": {
      return compact([
        `[${labels.app}] ${asString(payload.title) ?? labels.textNotification}`,
        asString(payload.message),
      ]).join(" - ");
    }
    case "COMMENT_RECEIVED": {
      return compact([
        `[${labels.app}] ${labels.commentReceived}: ${title}`,
        asString(payload.message),
        url,
      ]).join(" - ");
    }
    default:
      return `[${labels.app}] ${labels.notification}: ${JSON.stringify(payload)}`;
  }
}

function compact(values) {
  return values.filter((value) => typeof value === "string" && value.trim());
}

function splitIrcMessage(message) {
  const maxLength = Number(process.env.IRC_MESSAGE_MAX_LENGTH ?? 390);
  if (message.length <= maxLength) {
    return [message];
  }

  const chunks = [];
  let remaining = message;
  while (remaining.length > maxLength) {
    const splitAt = Math.max(
      remaining.lastIndexOf(" ", maxLength),
      Math.floor(maxLength * 0.75),
    );
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function sendIrc(event) {
  if (
    !event.user.ircNotificationsEnabled ||
    !asString(event.user.ircNickname)
  ) {
    return;
  }

  const target = asString(event.user.ircNickname);
  const message = formatEvent(event);
  if (dryRun) {
    console.log(`[dry-run] IRC to ${target}: ${message}`);
    return;
  }

  if (!ircRegistered) {
    console.error(
      `IRC client is not connected; dropping notification for ${target}`,
    );
    return;
  }

  for (const chunk of splitIrcMessage(message)) {
    client.say(target, chunk);
  }
  console.log(`IRC notification sent to ${target}`);
}

if (client) {
  client.on("registered", () => {
    ircRegistered = true;
    console.log("IRC client registered");
  });
  client.on("close", () => {
    ircRegistered = false;
  });
  client.on("socket close", () => {
    ircRegistered = false;
  });
  client.on("error", (error) => {
    console.error("IRC client error", error);
  });

  client.connect({
    host: process.env.IRC_HOST ?? "localhost",
    port: Number(process.env.IRC_PORT ?? 6697),
    nick: process.env.IRC_NICK ?? "git-web-review",
    username: process.env.IRC_USERNAME ?? "git-web-review",
    gecos: process.env.IRC_REALNAME ?? "git-web-review notification relay",
    password: process.env.IRC_PASSWORD || undefined,
    tls: parseBoolean(process.env.IRC_TLS ?? "true"),
    auto_reconnect: true,
    auto_reconnect_max_retries: 0,
  });
}

subscriber.on("message", (_channel, message) => {
  const event = parseEvent(message);
  if (!event) {
    return;
  }

  sendIrc(event);
});

subscriber.on("error", (error) => {
  console.error("Redis subscriber error", error);
});

await subscriber.subscribe(redisChannel);
console.log(
  `irc-relay listening on Redis channel ${redisChannel}${dryRun ? " in dry-run mode" : ""}`,
);

const shutdown = async () => {
  subscriber.disconnect();
  if (client) {
    client.quit("git-web-review relay shutdown");
  }
};

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
