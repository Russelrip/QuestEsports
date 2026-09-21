import { isAllowedPayHereActionUrl } from "./safe-url";

export type PayHereCheckout = {
  actionUrl: string;
  fields: Record<string, string>;
};

export function submitPayHereCheckout(checkout: PayHereCheckout) {
  const actionUrl = typeof checkout.actionUrl === "string" ? checkout.actionUrl.trim() : "";
  if (!isAllowedPayHereActionUrl(actionUrl)) {
    throw new Error("Unable to start checkout.");
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = actionUrl;
  form.style.display = "none";
  Object.entries(checkout.fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}
