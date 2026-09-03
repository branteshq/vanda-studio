import { describe, expect, it } from "vitest";
import { customerOrNull } from "./customerLookup";

describe("customerOrNull", () => {
  it("treats a missing Autumn customer as a first-time customer", () => {
    expect(
      customerOrNull({
        data: null,
        error: { code: "customer_not_found", message: "Customer user_new not found" },
      }),
    ).toBeNull();
  });

  it("returns an existing customer", () => {
    const customer = { products: [{ id: "basico", status: "active" }] };
    expect(customerOrNull({ data: customer, error: null })).toBe(customer);
  });

  it("does not hide other Autumn failures", () => {
    expect(() =>
      customerOrNull({
        data: null,
        error: { code: "unauthorized", message: "Invalid Autumn key" },
      }),
    ).toThrow("Invalid Autumn key");
  });
});
