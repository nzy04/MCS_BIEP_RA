import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const { Miniflare, Response } = require(
  require.resolve("miniflare", { paths: [require.resolve("wrangler")] }),
);
export function runtimeOptions(
  name,
  persist,
  bindings,
  outboundService,
  members = false,
) {
  return {
    resourcePersistencePath: persist,
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name,
          compatibilityDate: "2026-10-18",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: readFileSync(
                  "test-results/review-bundle/index.js",
                  "utf8",
                ),
              },
            },
          },
          env: {
            ...Object.fromEntries(
              Object.entries(bindings).map(([key, value]) => [
                key,
                { type: "text", value },
              ]),
            ),
            REVIEW_QUEUE: {
              type: "durable-object",
              worker: name,
              exportName: "ReviewQueue",
            },
            ...(members
              ? {
                  MEMBERS: {
                    type: "durable-object",
                    worker: name,
                    exportName: "MemberRegistry",
                  },
                }
              : {}),
          },
          exports: {
            ReviewQueue: { type: "durable-object", storage: "sqlite" },
            ...(members
              ? {
                  MemberRegistry: { type: "durable-object", storage: "sqlite" },
                }
              : {}),
          },
        },
        dev: { outboundService: { type: "fetcher", handler: outboundService } },
      },
    ],
  };
}
