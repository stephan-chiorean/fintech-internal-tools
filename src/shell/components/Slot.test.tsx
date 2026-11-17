import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { registerTool, unregisterToolForTests } from "@/shell/extensions";
import { Slot } from "./Slot";

describe("Slot", () => {
  afterEach(() => unregisterToolForTests("demo-tool"));

  it("renders a placeholder when no tool registered into the slot", () => {
    const html = renderToStaticMarkup(<Slot name="dashboard" props={{ viewerId: "jordan" }} />);
    expect(html).toContain("No tools have registered into the dashboard slot yet.");
  });

  it("renders components tools registered, with the slot props", () => {
    registerTool({
      id: "demo-tool",
      name: "Demo tool",
      description: "test",
      slots: {
        customer: ({ viewerId, customerId }) => (
          <p>
            {viewerId} viewing {customerId}
          </p>
        ),
      },
    });
    const html = renderToStaticMarkup(<Slot name="customer" props={{ viewerId: "jordan", customerId: "cust_1001" }} />);
    expect(html).toContain("Demo tool");
    expect(html).toContain("jordan viewing cust_1001");
  });
});
