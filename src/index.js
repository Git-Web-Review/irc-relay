import Redis from "ioredis";
import irc from "irc-framework";
import {
  ircLines,
  isValidIrcTarget,
  sanitizeIrcText,
} from "./irc-safety.js";
import { renderIrcNotification } from "./notification-template.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisChannel = process.env.REDIS_CHANNEL ?? "notifications:irc";
const frontendUrl = (
  process.env.FRONTEND_URL ?? "http://localhost:5173"
).replace(/\/$/, "");
const templatesDir = process.env.NOTIFICATION_TEMPLATES_DIR;
const dryRun = parseBoolean(process.env.IRC_DRY_RUN ?? "false");
// The password is passed as an option rather than inside the URL: a
// base64-generated password contains `/`, `+` and `=`, which make the URL invalid.
const subscriber = new Redis(redisUrl, {
  password: process.env.REDIS_PASSWORD || undefined,
});
const client = dryRun ? null : new irc.Client();
let ircRegistered = false;

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value));
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

async function sendIrc(event) {
  if (!event.user.ircNotificationsEnabled) {
    return;
  }

  const target = asString(event.user.ircNickname);
  if (!target) {
    return;
  }

  // A target is refused, not repaired: stripping a character from a nickname
  // would give a valid but different nickname, and the notification would go to
  // somebody else.
  if (!isValidIrcTarget(target)) {
    console.error(
      `Refusing to send to an invalid IRC target for user ${sanitizeIrcText(event.user.id)}`,
    );
    return;
  }

  const message = await renderIrcNotification(event, {
    frontendUrl,
    templatesDir,
  });
  const lines = ircLines(message, {
    maxLength: process.env.IRC_MESSAGE_MAX_LENGTH,
    maxLines: process.env.IRC_MESSAGE_MAX_LINES,
  });

  if (lines.length === 0) {
    return;
  }

  if (dryRun) {
    for (const line of lines) {
      console.log(`[dry-run] IRC to ${target}: ${line}`);
    }
    return;
  }

  if (!ircRegistered) {
    console.error(
      `IRC client is not connected; dropping notification for ${target}`,
    );
    return;
  }

  for (const line of lines) {
    client.say(target, line);
  }
  console.log(`IRC notification sent to ${target} (${lines.length} line(s))`);
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

  void sendIrc(event).catch((error) => {
    console.error("Failed to send IRC notification", error);
  });
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
