import webpush from "web-push";
import { env } from "./runtime.ts";

// Only composition roots choose adapters. Request data never selects a provider.
export interface Providers {
  fetch: typeof fetch;
  now: () => number;
  push: (
    subscription: any,
    payload: string,
    options: { TTL: number; timeout?: number },
  ) => Promise<unknown>;
}
export const liveProviders: Providers = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  push: (subscription, payload, options) => {
    webpush.setVapidDetails(
      env("VAPID_SUBJECT"),
      env("VAPID_PUBLIC_KEY"),
      env("VAPID_PRIVATE_KEY"),
    );
    return webpush.sendNotification(subscription, payload, options);
  },
};
