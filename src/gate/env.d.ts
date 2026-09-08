/**
 * The two build-time values the door reads, declared here because the project
 * does not pull in `vite/client` (that would drag the whole ambient asset-module
 * surface in with it, for two strings).
 *
 * Both are set by the deploy workflow from repository variables, never checked
 * in — see `docs/AUTH.md`. Unset is the normal state everywhere else, and it is
 * what keeps `npm run dev` and the twenty-odd browser suites from ever meeting
 * a login prompt.
 */
interface ImportMetaEnv {
  /** Google OAuth client ID. Empty or absent leaves the door open. */
  readonly VITE_GATE_CLIENT_ID?: string;
  /** URL of the guest-list / log endpoint. Empty or absent leaves the door open. */
  readonly VITE_GATE_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
