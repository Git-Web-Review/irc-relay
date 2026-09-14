import assert from "node:assert/strict";
import test from "node:test";
import irc from "irc-framework";
import {
  ircLines,
  isValidIrcTarget,
  sanitizeIrcText,
} from "./irc-safety.js";

/**
 * Reproduces what really goes out on the socket: `irc-framework` concatenates the
 * arguments and the transport writes `line + "\r\n"`. If a protocol line still
 * carries a CR or LF, the server reads one more command.
 */
const protocolLine = (target, text) =>
  new irc.Client().rawString("PRIVMSG", target, text);

test("a target containing a line ending is refused", () => {
  for (const target of [
    "ali\nce",
    "ali\rce",
    "ali\r\nJOIN #secret",
    "alice\u0000",
    "ali ce",
    "ali,ce",
    ":alice",
    "",
    "   ",
  ]) {
    assert.equal(
      isValidIrcTarget(target),
      false,
      `${JSON.stringify(target)} should have been refused`,
    );
  }
});

test("legitimate nicknames and channels pass", () => {
  for (const target of [
    "leandre",
    "Leandre_42",
    "[away]nick",
    "nick-with-dash",
    "a",
    "#dev",
    "#dev.team",
    "&local",
  ]) {
    assert.equal(
      isValidIrcTarget(target),
      true,
      `${JSON.stringify(target)} should have passed`,
    );
  }
});

test("a nickname is never repaired into another valid nickname", () => {
  // "ali\rce" must not become "alice", who may well exist.
  assert.equal(isValidIrcTarget("ali\rce"), false);
});

test("sanitizeIrcText neutralises every control character", () => {
  assert.equal(sanitizeIrcText("coucou\rJOIN #secret"), "coucou JOIN #secret");
  assert.equal(sanitizeIrcText("a\u0000b"), "a b");
  assert.equal(sanitizeIrcText("\u0001VERSION\u0001"), "VERSION");
  assert.equal(sanitizeIrcText("  espaces   multiples  "), "espaces multiples");
});

test("control characters become a space, not nothing", () => {
  // Removing them would glue the words together and change the meaning.
  assert.equal(sanitizeIrcText("ali\rce"), "ali ce");
});

test("ircLines splits on line endings, whatever the convention", () => {
  assert.deepEqual(ircLines("une\ndeux\r\ntrois\rquatre"), [
    "une",
    "deux",
    "trois",
    "quatre",
  ]);
});

test("no produced line contains CR, LF or NUL", () => {
  const hostile =
    "titre\r\nJOIN #secret\rPRIVMSG #ops :pwned\nQUIT\u0000\u0001ACTION x\u0001";

  for (const line of ircLines(hostile)) {
    assert.doesNotMatch(line, /[\r\n\u0000\u0001]/, `unsafe line: ${JSON.stringify(line)}`);
  }
});

test("the full protocol line can no longer be hijacked", () => {
  const hostile = "coucou\r\nJOIN #secret";

  // The state before the fix, for the record: the raw line really is injectable.
  assert.match(protocolLine("leandre", hostile), /\r\n/);

  for (const line of ircLines(hostile)) {
    assert.doesNotMatch(protocolLine("leandre", line), /[\r\n]/);
  }
});

test("the line count is capped so it cannot trigger an excess flood", () => {
  const lines = ircLines("a\n".repeat(500), { maxLines: 8 });

  assert.equal(lines.length, 9, "8 lines plus the truncation marker");
  assert.equal(lines.at(-1), "[...]");
});

test("an over-long line is split without losing content", () => {
  const original = "mot ".repeat(60).trim(); // 239 characters, fits under the cap
  const lines = ircLines(original, { maxLength: 50 });

  assert.ok(lines.length > 1, "the line should have been split");
  for (const line of lines) {
    assert.ok(line.length <= 50, `line of ${line.length} characters`);
  }
  assert.equal(lines.join(" "), original, "content was lost");
});

test("a single oversized line is capped like the rest", () => {
  // The cap applies to the total volume, not just to line breaks: otherwise one
  // very long message would be enough to flood the channel.
  const lines = ircLines("mot ".repeat(2000), { maxLength: 50, maxLines: 8 });

  assert.equal(lines.length, 9);
  assert.equal(lines.at(-1), "[...]");
});

test("a line without spaces still makes progress", () => {
  const lines = ircLines("x".repeat(200), { maxLength: 50 });

  assert.ok(lines.length >= 4);
  for (const line of lines) {
    assert.ok(line.length <= 50);
  }
  assert.equal(lines.join(""), "x".repeat(200));
});

test("an empty or control-only message produces nothing", () => {
  assert.deepEqual(ircLines(""), []);
  assert.deepEqual(ircLines("\r\n\r\n"), []);
  assert.deepEqual(ircLines("\u0000\u0001"), []);
  assert.deepEqual(ircLines(null), []);
});

test("an absurd environment limit falls back to the default", () => {
  assert.ok(ircLines("a\n".repeat(50), { maxLines: "0" }).length > 1);
  assert.ok(ircLines("mot ".repeat(200), { maxLength: "-1" }).length >= 1);
});
