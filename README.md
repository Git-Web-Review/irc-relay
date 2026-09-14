# irc-relay

IRC relay that consumes redis events to send notifications to clients on irc

## Configuration

The relay subscribes to `notifications:irc` by default and sends one private IRC message per Redis notification event when `user.ircNotificationsEnabled` is true and `user.ircNickname` is set.

Useful environment variables:

- `REDIS_URL`, default `redis://localhost:6379`
- `REDIS_CHANNEL`, default `notifications:irc`
- `FRONTEND_URL`, used to build review links
- `NOTIFICATION_TEMPLATES_DIR`, optional override for the templates directory
- `IRC_DRY_RUN`, log IRC messages instead of sending them
- `IRC_HOST`, `IRC_PORT`, `IRC_TLS`, `IRC_NICK`, `IRC_USERNAME`, `IRC_REALNAME`, `IRC_PASSWORD`
- `IRC_MESSAGE_MAX_LENGTH`, default `390`, characters per PRIVMSG line
- `IRC_MESSAGE_MAX_LINES`, default `8`, lines per notification before truncation

## Protocol safety

Everything the relay sends is attacker-controlled text: review titles, comment
excerpts and nicknames all come from the application's users. `irc-framework`
builds a line by joining its arguments and the transport writes `line + "\r\n"`,
so nothing in that path removes the characters that end a protocol line. A
title containing `\r\n` would otherwise make the bot run whatever command
follows it.

[`src/irc-safety.js`](src/irc-safety.js) is therefore the last gate before the
socket, and it is the one that matters: it also covers rows already in the
database and text that came from git, neither of which passes through the
backend's validation.

- **Targets are validated, never repaired.** A nickname must match RFC 2812, a
  channel must start with `#` or `&`. An invalid target is dropped and logged,
  because stripping a character from `ali\rce` yields `alice` — a valid
  nickname belonging to someone else.
- **Message text is split, then sanitised.** Line breaks become separate
  PRIVMSG lines, and every remaining C0 control character — `NUL`, `\r`, and
  `\x01`, the CTCP delimiter — becomes a space, so words are not glued
  together.
- **Line count is capped.** `IRC_MESSAGE_MAX_LINES` bounds how many lines one
  notification can produce, so a comment made of newlines cannot use the bot to
  flood a channel and earn it an excess-flood kick.

The backend refuses these characters at the DTO level too, so a user gets an
error instead of silently losing part of their text. That check is for
ergonomics; the authority stays here.

Run the tests with `npm test`.

## Notification templates

Messages are rendered from Mustache templates selected by user locale and notification type:

```text
templates/<locale>/<notification-type>.mustache
```

For example, a French `REVIEW_PENDING` notification uses `templates/FR/REVIEW_PENDING.mustache`. If a localized template is missing, the relay falls back to `FR`, then `DEFAULT.mustache`.

Templates receive the Redis event fields plus derived values such as `title`, `url`, `gitwebUrl`, `actor`, `ownerEmail`, `message`, `previousStatusLabel`, `nextStatusLabel`, `sourceProject`, `sourceBranch`, `sourceCommit`, and `rawPayload`.
