/**
 * Which social providers are actually usable in this deployment.
 *
 * `.env.example` ships the OAuth keys as empty placeholders, so an
 * unconfigured install used to register Google and Facebook anyway and send
 * `client_id=` to the provider — the button rendered fine and then dropped the
 * user on Google's "Error 400: invalid_request" page. Auth.js does not
 * validate provider credentials itself (see assertConfig in @auth/core), so
 * the check has to live here.
 *
 * Both the provider list in `src/auth.ts` and the buttons on the login page
 * read this, so a provider is either fully wired or completely absent.
 */
function configured(...values: (string | undefined)[]): boolean {
  return values.every((v) => typeof v === "string" && v.trim() !== "");
}

export const googleEnabled = (): boolean =>
  configured(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);

export const facebookEnabled = (): boolean =>
  configured(process.env.FACEBOOK_CLIENT_ID, process.env.FACEBOOK_CLIENT_SECRET);

export const anyOAuthEnabled = (): boolean => googleEnabled() || facebookEnabled();
