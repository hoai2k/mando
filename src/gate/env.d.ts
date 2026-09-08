/**
 * The one build-time value the door reads, declared here because the project
 * does not pull in `vite/client` (that would drag the whole ambient asset-module
 * surface in with it, for one string).
 *
 * It is set by the deploy workflow from a repository variable, never checked in
 * — see `docs/AUTH.md`. Unset is the normal state everywhere else, and it is
 * what keeps `npm run dev` and the twenty-odd browser suites from ever meeting
 * a door.
 *
 * There used to be a `VITE_GATE_CLIENT_ID` beside it, for the Google sign-in
 * this door was first built as. Invite codes need no OAuth client, so it is
 * gone; a stale one left in the repository's variables is simply ignored.
 */
interface ImportMetaEnv {
  /** URL of the guest-list / log endpoint. Empty or absent leaves the door open. */
  readonly VITE_GATE_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
