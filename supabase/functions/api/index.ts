import { createApiHandler } from "./handler.ts";
import { edgeBackground } from "../_shared/bhc-background.ts";
import { liveProviders } from "../_shared/providers.ts";
Deno.serve(createApiHandler(liveProviders, edgeBackground));
