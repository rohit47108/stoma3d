import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile release configuration", () => {
  it("pins the same live signing key and origin in test and store builds", () => {
    const template = readFileSync(
      new URL("../.env.production.example", import.meta.url),
      "utf8",
    );
    const values = Object.fromEntries(
      template
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    const configuration = JSON.parse(
      readFileSync(new URL("../eas.json", import.meta.url), "utf8"),
    );
    for (const profile of ["preview", "production"]) {
      expect(configuration.build[profile].env.EXPO_PUBLIC_INFERENCE_URL).toBe(
        values.EXPO_PUBLIC_INFERENCE_URL,
      );
      expect(
        configuration.build[profile].env
          .EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64,
      ).toBe(values.EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64);
    }
    expect(
      Buffer.from(values.EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64, "base64"),
    ).toHaveLength(32);
  });
});
