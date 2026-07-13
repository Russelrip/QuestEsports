"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  currency: string;
  unitPrice: number;
  imageUrl: string | null;
  quantity: number;
};

type CartState = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">, quantity: number) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item, quantity) => set((state) => {
        if (state.items.length > 0 && state.items[0].currency !== item.currency) return state;
        const existing = state.items.find((entry) => entry.variantId === item.variantId);
        return {
          items: existing
            ? state.items.map((entry) => entry.variantId === item.variantId ? { ...entry, quantity: Math.min(20, entry.quantity + quantity) } : entry)
            : [...state.items, { ...item, quantity }],
        };
      }),
      updateQuantity: (variantId, quantity) => set((state) => ({ items: state.items.map((item) => item.variantId === variantId ? { ...item, quantity: Math.max(1, Math.min(20, quantity)) } : item) })),
      removeItem: (variantId) => set((state) => ({ items: state.items.filter((item) => item.variantId !== variantId) })),
      clear: () => set({ items: [] }),
    }),
    { name: "quest-merch-cart" }
  )
);
