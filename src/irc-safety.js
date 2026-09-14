/**
 * Dernier rempart avant le socket.
 *
 * `irc-framework` builds the line by plain concatenation and then writes
 * `line + "\r\n"`: nothing along that path strips the characters that end a
 * protocol line. So everything leaving here is assumed hostile — review titles,
 * comments, nicknames — and has to be neutralised here rather than upstream,
 * because rows already in the database and text that came from git will never
 * go through the backend's validation again.
 */

/** C0 and DEL. Covers CR, LF, NUL and \x01, the CTCP delimiter. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

/** Ends a protocol line, whatever convention the server uses. */
const LINE_SEPARATORS = /\r\n|\r|\n/;

/**
 * An RFC 2812 nickname, widened to the lengths networks use today. The special
 * characters allowed are `[ ] \ ` _ ^ { | }`.
 */
const NICKNAME = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,63}$/;

/** Channel name: anything but space, comma, colon, BEL and line endings. */
const CHANNEL = /^[#&][^\u0000\u0007\r\n ,:]{1,63}$/;

export const DEFAULT_MAX_LENGTH = 390;
export const DEFAULT_MAX_LINES = 8;

/**
 * Makes a fragment harmless inside a PRIVMSG line.
 *
 * Control characters become a space rather than being removed: "ali\rce" has to
 * read as "ali ce", not "alice", which would name somebody else.
 */
export function sanitizeIrcText(value) {
  return String(value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A target is validated, never sanitised: stripping a character from a nickname
 * would yield a valid but different nickname, and the notification would go to
 * somebody else. Better to send nothing.
 */
export function isValidIrcTarget(value) {
  const target = typeof value === "string" ? value.trim() : "";

  if (!target) {
    return false;
  }

  return target.startsWith("#") || target.startsWith("&")
    ? CHANNEL.test(target)
    : NICKNAME.test(target);
}

/**
 * Splits a rendered message into safe PRIVMSG lines: one per line break, then by
 * length.
 *
 * The line count is capped: the backend only bounds a comment in characters, and
 * without this cap a message made of nothing but line breaks would have the bot
 * emit hundreds of PRIVMSG in a row, which IRC servers answer with an excess
 * flood kick.
 */
export function ircLines(message, options = {}) {
  const maxLength = positiveInteger(options.maxLength, DEFAULT_MAX_LENGTH);
  const maxLines = positiveInteger(options.maxLines, DEFAULT_MAX_LINES);

  const lines = String(message ?? "")
    .split(LINE_SEPARATORS)
    .map(sanitizeIrcText)
    .filter(Boolean)
    .flatMap((line) => splitOnLength(line, maxLength));

  if (lines.length <= maxLines) {
    return lines;
  }

  return [...lines.slice(0, maxLines), "[...]"];
}

function splitOnLength(line, maxLength) {
  if (line.length <= maxLength) {
    return [line];
  }

  const chunks = [];
  let remaining = line;

  while (remaining.length > maxLength) {
    // Break at the last space, never further back than 75% of the limit: a line
    // without spaces still has to make progress.
    const splitAt = Math.max(
      remaining.lastIndexOf(" ", maxLength),
      Math.floor(maxLength * 0.75),
    );
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
