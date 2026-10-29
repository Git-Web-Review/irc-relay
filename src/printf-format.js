/**
 * printf-style notification formats a user sets in the frontend. The frontend
 * holds a copy of this table for its live preview
 * (frontend/src/components/user-settings/notification-format.ts): the two must
 * agree on every specifier.
 */
const SPECIFIERS = {
  A: (view) => view.app,
  t: (view) => view.title,
  u: (view) => view.url,
  g: (view) => view.gitwebUrl,
  a: (view) => view.actor,
  o: (view) => view.ownerEmail,
  m: (view) => view.message,
  c: (view) => view.commentExcerpt,
  f: (view) => view.payload.filePath,
  l: (view) => view.payload.lineNumber,
  s: (view) => view.previousStatusLabel,
  S: (view) => view.nextStatusLabel,
  p: (view) => view.sourceProject,
  b: (view) => view.sourceBranch,
  h: (view) => view.sourceCommit,
  v: (view) => view.payload.version,
  k: (view) => view.payload.commitCount,
  K: (view) =>
    Array.isArray(view.payload.commitTitles)
      ? view.payload.commitTitles.join(", ")
      : view.payload.commitTitles,
};

/** A missing value prints nothing; an unknown specifier stays as typed. */
export function formatNotification(format, view) {
  return format.replace(/%([%A-Za-z])/g, (match, key) => {
    if (key === "%") {
      return "%";
    }
    if (!Object.hasOwn(SPECIFIERS, key)) {
      return match;
    }
    const value = SPECIFIERS[key](view);
    return value === null || value === undefined ? "" : String(value);
  });
}
