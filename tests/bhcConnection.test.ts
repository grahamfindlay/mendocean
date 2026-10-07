import { expect, test } from "vitest";
import { bhcStatus, mendotaClub, tokenMetadata } from "../shared/bhcConnection";
const now = Date.parse("2026-10-07T12:00:00Z");
test("Mendota discovery tolerates spelling/case, rejects ambiguous matches, then uses the pinned ID", () => {
  expect(
    mendotaClub(
      [
        { whitelabel_id: 2, whitelabel_name: "Other club" },
        { whitelabel_id: 1, whitelabel_name: "mEnDoTa" },
      ],
      null,
    ),
  ).toBe(1);
  expect(
    mendotaClub([{ whitelabel_id: 1, whitelabel_name: "Renamed club" }], 1),
  ).toBe(1);
  expect(
    mendotaClub([{ whitelabel_id: 2, whitelabel_name: "Mendota" }], 1),
  ).toBeNull();
  expect(() =>
    mendotaClub(
      [
        { whitelabel_id: 1, whitelabel_name: "Mendota" },
        { whitelabel_id: 2, whitelabel_name: "Mendota Juniors" },
      ],
      null,
    ),
  ).toThrow("Ambiguous");
  expect(
    mendotaClub(
      [{ whitelabel_id: "invalid", whitelabel_name: "Mendota" }],
      null,
    ),
  ).toBeNull();
});
test("provider expiry uses seconds, distinguishes invalid access from malformed responses and never invents expiry", () => {
  expect(tokenMetadata([], now)).toBeNull();
  expect(() => tokenMetadata({ error: "outage" }, now)).toThrow();
  expect(
    tokenMetadata({ custid: "123", expires: now / 1000 - 1 }, now)?.expired,
  ).toBe(true);
  expect(
    tokenMetadata({ custid: 123, expires: now / 1000 + 3600 }, now)?.expires_at,
  ).toBe("2026-10-07T13:00:00.000Z");
  expect(tokenMetadata({ custid: 123 }, now)?.expires_at).toBeNull();
  expect(
    tokenMetadata({ custid: 123, expires: 0 }, now)?.expires_at,
  ).toBeNull();
});
test("connection state separates expiry, transient outages, initial import and successful updates", () => {
  const connection = {
    user_id: "fixture",
    method: "password_exchange",
    access_state: "active",
    import_status: "complete",
    expires_at: new Date(now + 2 * 86400000).toISOString(),
    last_successful_sync_at: "2026-10-06T12:00:00Z",
  };
  expect(bhcStatus(connection, now, true)).toMatchObject({
    state: "healthy",
    connected: true,
    renewal_due: true,
    password_enabled: true,
  });
  expect(
    bhcStatus({ ...connection, last_error: "Temporary outage" }, now),
  ).toMatchObject({
    state: "temporary_error",
    connected: true,
    last_sync: connection.last_successful_sync_at,
  });
  expect(
    bhcStatus({ ...connection, expires_at: new Date(now).toISOString() }, now),
  ).toMatchObject({
    state: "reconnect_required",
    connected: false,
    renewal_due: false,
  });
  expect(
    bhcStatus({ ...connection, access_state: "membership_missing" }, now),
  ).toMatchObject({ state: "membership_missing", connected: false });
  expect(
    bhcStatus({ user_id: "fixture", import_status: "pending" }, now),
  ).toMatchObject({ state: "importing", last_sync: null });
  expect(bhcStatus({}, now)).toMatchObject({
    state: "not_connected",
    connected: false,
  });
});
