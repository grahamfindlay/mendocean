// Imported only by staging builds for the reserved fictional practice.
import { ApiError } from "./client";
export async function stagingAttendance<T>(
  path: string,
  body: object,
  token?: string,
): Promise<T> {
  const response = await fetch(
    import.meta.env.VITE_SUPABASE_URL + "/functions/v1/staging-test",
    {
      method: "POST",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        action:
          path === "bhc/attendance-roster" ? "attendance-roster" : "attendance",
      }),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error || "The staging attendance check failed.",
      response.status,
      "",
      result.code,
    );
  return result as T;
}
