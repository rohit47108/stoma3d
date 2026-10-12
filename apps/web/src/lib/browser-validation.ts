import { z } from "zod";

// Configure before shared schemas load; keep the page's strict CSP unchanged.
// https://github.com/colinhacks/zod/issues/4461
z.config({ jitless: true });
