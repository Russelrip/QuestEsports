import { afterEach, describe, expect, it, vi } from "vitest";
import { submitPayHereCheckout } from "../../lib/payments";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("submitPayHereCheckout", () => {
  it("validates and submits the same trimmed canonical action URL", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
    const actionUrl = " https://sandbox.payhere.lk/pay/checkout ";

    submitPayHereCheckout({ actionUrl, fields: { order_id: "order" } });

    expect(submit).toHaveBeenCalledOnce();
    expect(document.body.querySelector("form")).toHaveAttribute("action", actionUrl.trim());
  });

  it.each([
    "https://sandbox.payhere.lk/pay/checkout",
    "https://www.payhere.lk/pay/checkout",
  ])("submits checkout forms only to approved PayHere hosts: %s", (actionUrl) => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);

    submitPayHereCheckout({ actionUrl, fields: { merchant_id: "merchant", order_id: "order" } });

    expect(submit).toHaveBeenCalledOnce();
    expect(document.body.querySelector("form")).toHaveAttribute("action", actionUrl);
    expect(document.body.querySelectorAll("input")).toHaveLength(2);
  });

  it.each([
    "http://sandbox.payhere.lk/pay/checkout",
    "https://sandbox.payhere.lk.evil.test/pay/checkout",
    "https://user:password@www.payhere.lk/pay/checkout",
    "https://attacker.example/pay/checkout",
  ])("rejects invalid checkout destinations without submitting: %s", (actionUrl) => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);

    expect(() => submitPayHereCheckout({ actionUrl, fields: { order_id: "order" } })).toThrow(
      "Unable to start checkout."
    );
    expect(submit).not.toHaveBeenCalled();
    expect(document.body.querySelector("form")).toBeNull();
  });
});
