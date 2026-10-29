import assert from "node:assert/strict";
import test from "node:test";
import { formatNotification } from "./printf-format.js";

const view = {
  app: "git-web-review",
  title: "Fix login",
  url: "https://r/review/1",
  actor: "alice",
  payload: { commitTitles: ["a", "b"], commitCount: 2 },
};

test("replaces specifiers, keeps unknown ones and %%", () => {
  assert.equal(
    formatNotification("[%A] %t by %a (%k: %K) %u 100%% %z", view),
    "[git-web-review] Fix login by alice (2: a, b) https://r/review/1 100% %z",
  );
});

test("a missing value prints nothing", () => {
  assert.equal(formatNotification("%t|%m|%S", view), "Fix login||");
});
