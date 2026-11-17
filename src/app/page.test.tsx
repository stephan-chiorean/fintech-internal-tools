import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home page", () => {
  it("lists the planned tools", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("Fintech Internal Tools");
    expect(html).toContain("KYC review queue");
    expect(html).toContain("Refunds dashboard");
    expect(html).toContain("Feature-flag admin");
  });
});
