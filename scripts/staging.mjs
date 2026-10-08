import { initialize, status } from "./staging/lib.mjs";
import {
  migrate,
  configure,
  deployBackend,
  deployFrontend,
  setupFixtures,
  deployTestFunction,
  trigger,
  schedule,
} from "./staging/deploy.mjs";
import { assets, smoke, emailCheck } from "./staging/smoke.mjs";
import { browserSmoke } from "./staging/browser.mjs";
import { smtpCheck } from "./staging/smtp.mjs";
import {
  attendanceSmoke,
  prepareAttendanceFixture,
} from "./staging/attendance.mjs";
const actions = {
  "attendance-fixture": prepareAttendanceFixture,
  "attendance-smoke": attendanceSmoke,
  "smtp-check": smtpCheck,
  "browser-smoke": browserSmoke,
  assets,
  smoke,
  "email-check": emailCheck,
  init: initialize,
  status,
  migrate,
  configure,
  "deploy-backend": deployBackend,
  "deploy-frontend": deployFrontend,
  fixtures: setupFixtures,
  "deploy-tests": deployTestFunction,
  schedule,
  scenario: () => trigger(process.argv[3] || "reset"),
};
try {
  const action = actions[process.argv[2]];
  if (!action)
    throw new Error(
      "Usage: node scripts/staging.mjs " + Object.keys(actions).join("|"),
    );
  await action();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
