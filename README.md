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

## Notification templates

Messages are rendered from Mustache templates selected by user locale and notification type:

```text
templates/<locale>/<notification-type>.mustache
```

For example, a French `REVIEW_PENDING` notification uses `templates/FR/REVIEW_PENDING.mustache`. If a localized template is missing, the relay falls back to `FR`, then `DEFAULT.mustache`.

Templates receive the Redis event fields plus derived values such as `title`, `url`, `gitwebUrl`, `actor`, `ownerEmail`, `message`, `previousStatusLabel`, `nextStatusLabel`, `sourceProject`, `sourceBranch`, `sourceCommit`, and `rawPayload`.
