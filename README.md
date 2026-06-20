# irc-relay

IRC relay that consumes redis events to send notifications to clients on irc

## Configuration

The relay subscribes to `notifications:irc` by default and sends one private IRC message per Redis notification event when `user.ircNotificationsEnabled` is true and `user.ircNickname` is set.

Useful environment variables:

- `REDIS_URL`, default `redis://localhost:6379`
- `REDIS_CHANNEL`, default `notifications:irc`
- `FRONTEND_URL`, used to build review links
- `IRC_DRY_RUN`, log IRC messages instead of sending them
- `IRC_HOST`, `IRC_PORT`, `IRC_TLS`, `IRC_NICK`, `IRC_USERNAME`, `IRC_REALNAME`, `IRC_PASSWORD`
