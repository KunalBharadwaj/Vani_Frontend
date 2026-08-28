// Shared helpers for the e2e suite.

// The frontend only checks that a token exists to pass the auth gate (the token
// is verified server-side, which these UI tests don't exercise). Seeding it into
// localStorage lets us bypass Google OAuth for deterministic UI tests.
export const FAKE_TOKEN = "e2e.header.payload"; // shape is irrelevant to the gate

/**
 * Seed an auth token before the app boots so AuthWrapper skips the login screen.
 * Call before page.goto().
 */
export async function seedAuth(page) {
  await page.addInitScript((token) => {
    window.localStorage.setItem("vani_auth_token", token);
  }, FAKE_TOKEN);
}
