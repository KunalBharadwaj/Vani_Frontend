import { test, expect } from "@playwright/test";
import { seedAuth } from "./helpers.js";

test.describe("Vani smoke", () => {
  test("shows the login screen when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });

  test("bypasses login and loads the app when authenticated", async ({ page }) => {
    await seedAuth(page);
    await page.goto("/");
    // Login CTA should be gone, and the always-present assistant button should render.
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toHaveCount(0);
    await expect(page.getByTitle(/Open Chanakya AI/i)).toBeVisible();
  });

  test("opens the Chanakya assistant panel", async ({ page }) => {
    await seedAuth(page);
    await page.goto("/");
    await page.getByTitle(/Open Chanakya AI/i).click();
    await expect(page.getByText(/Hello! I am Chanakya/i)).toBeVisible();
  });

  test("navigates to the PDF editor", async ({ page }) => {
    await seedAuth(page);
    await page.goto("/pdf");
    await expect(page.getByText(/Drop or click to upload a PDF/i)).toBeVisible();
  });
});
