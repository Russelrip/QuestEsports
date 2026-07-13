export type PayHereCheckout = {
  actionUrl: string;
  fields: Record<string, string>;
};

export function submitPayHereCheckout(checkout: PayHereCheckout) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkout.actionUrl;
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
