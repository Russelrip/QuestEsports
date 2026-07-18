import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore, type CartItem } from "../../hooks/useCartStore";

const item = (overrides: Partial<CartItem> = {}): Omit<CartItem, "quantity"> => ({
  variantId: "variant-1",
  productId: "product-1",
  productSlug: "quest-shirt",
  productName: "Quest Shirt",
  variantName: "Small",
  currency: "LKR",
  unitPrice: 3500,
  imageUrl: null,
  ...overrides,
});

describe("cart store", () => {
  beforeEach(() => useCartStore.setState({ items: [] }));

  it("merges variants and caps quantities at the checkout limit", () => {
    useCartStore.getState().addItem(item(), 12);
    useCartStore.getState().addItem(item(), 12);
    expect(useCartStore.getState().items).toEqual([
      expect.objectContaining({ variantId: "variant-1", quantity: 20 }),
    ]);
  });

  it("does not mix currencies and clamps edited quantities", () => {
    useCartStore.getState().addItem(item(), 1);
    useCartStore.getState().addItem(item({ variantId: "variant-2", currency: "USD" }), 1);
    expect(useCartStore.getState().items).toHaveLength(1);

    useCartStore.getState().updateQuantity("variant-1", 0);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
    useCartStore.getState().updateQuantity("variant-1", 99);
    expect(useCartStore.getState().items[0].quantity).toBe(20);
  });

  it("removes individual variants and clears the cart", () => {
    useCartStore.getState().addItem(item(), 1);
    useCartStore.getState().removeItem("variant-1");
    expect(useCartStore.getState().items).toEqual([]);
    useCartStore.getState().addItem(item(), 1);
    useCartStore.getState().clear();
    expect(useCartStore.getState().items).toEqual([]);
  });
});
