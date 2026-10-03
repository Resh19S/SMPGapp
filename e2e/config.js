// Where the scratch app runs and which Chromium to drive. Override with env vars.
const path = require("path");

module.exports = {
  APP: process.env.E2E_APP ?? "http://localhost:5174",
  API: process.env.E2E_API ?? "http://localhost:8765",
  CHROME: process.env.E2E_CHROME ?? undefined, // undefined = Playwright's own download
  OUT: process.env.E2E_OUT ?? path.join(__dirname, "output"),
  OWNER: { username: "owner", password: "owner123" },
  STAFF: { username: "staff", password: "staff123" },
};
