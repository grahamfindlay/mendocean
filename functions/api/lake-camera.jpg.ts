import { cameraResponse } from "../../shared/camera-relay";

export function onRequest(context: { request: Request }) {
  return cameraResponse(
    context.request,
    (caches as CacheStorage & { default: Cache }).default,
  );
}
