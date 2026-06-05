import { describe, expect, it } from "vitest";
import { t } from ".";
import en from "./locales/en.json";
import { localeMessages } from "./locales";
import { validateLocaleMessages } from "./locale-validation";

describe("locale validation", () => {
  it("resolves English messages with key and default fallbacks", () => {
    expect(t("app.noSquads.title")).toBe(en.app.noSquads.title);
    expect(t("app.missing", { defaultValue: "Fallback" })).toBe("Fallback");
    expect(t("app.missing")).toBe("app.missing");
  });

  it("accepts registered locale files", () => {
    expect(Object.keys(localeMessages)).toContain("en");
    for (const [locale, messages] of Object.entries(localeMessages)) {
      expect(validateLocaleMessages(messages), locale).toEqual([]);
    }
  });

  it("rejects missing and extra nested keys", () => {
    expect(
      validateLocaleMessages({
        app: {
          noSquads: {
            title: en.app.noSquads.title,
            description: en.app.noSquads.description,
            unexpected: "Unexpected",
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "app.noSquads.newSquad is missing",
        "app.noSquads.unexpected is not defined in English",
      ]),
    );
  });

  it("rejects non-string leaves", () => {
    expect(
      validateLocaleMessages({
        app: {
          noSquads: {
            ...en.app.noSquads,
            title: ["Create your first squad"],
          },
        },
      }),
    ).toEqual(expect.arrayContaining(["app.noSquads.title must be a string"]));
  });

  it("requires interpolation placeholders to match English", () => {
    const reference = {
      message: "Invite {{name}} to {{squad}}",
    };

    expect(validateLocaleMessages({ message: "Invite {{name}}" }, reference)).toEqual([
      'message interpolation placeholders must match English exactly: expected ["name","squad"], received ["name"]',
    ]);
  });

  it("rejects executable, raw HTML, and unexpected link payloads not present in English", () => {
    const reference = {
      script: "Create squad",
      handler: "Create squad",
      js: "Create squad",
      data: "Create squad",
      url: "Create squad",
      html: "Create squad",
    };

    expect(
      validateLocaleMessages(
        {
          script: "<script>alert(1)</script>",
          handler: '<span ONCLICK="alert(1)">Create</span>',
          js: "javascript:alert(1)",
          data: "data:text/html,hello",
          url: "https://example.test",
          html: "<strong>Create squad</strong>",
        },
        reference,
      ),
    ).toEqual(
      expect.arrayContaining([
        "script contains disallowed <script",
        "handler contains disallowed event-handler attribute",
        "js contains disallowed javascript:",
        "data contains disallowed data:",
        "url contains disallowed unexpected URL",
        "html contains disallowed raw HTML tag",
      ]),
    );
  });

  it("caps localized string length relative to English", () => {
    expect(validateLocaleMessages({ message: "x".repeat(200) }, { message: "Short" })).toEqual([
      "message is too long: 200 characters exceeds 133",
    ]);
  });
});
