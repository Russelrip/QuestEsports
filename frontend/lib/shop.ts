import { fetchApiJson } from "@/lib/api";

export type ProductVariant = {
  id: string;
  sku: string;
  name: string;
  size: string | null;
  color: string | null;
  price: number;
  stock: number | null;
  isActive: boolean;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  currency: string;
  status: "draft" | "active" | "archived";
  madeToOrder: boolean;
  displayOrder: number;
  variants: ProductVariant[];
  images: Array<{ id: string; imageAssetId?: string; altText: string; displayOrder: number; imageUrl: string }>;
};

export type MerchandiseOrder = {
  id: string;
  publicToken: string;
  status: string;
  currency: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  expiresAt?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  paymentOrderId: string | null;
  paymentStatus: string;
  items: Array<{ id: string; productName: string; variantName: string; sku: string; unitPrice: number; quantity: number; lineTotal: number }>;
};

export type MerchandiseQuote = {
  currency: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: Array<{
    variantId: string;
    productName: string;
    variantName: string;
    unitPrice: number;
    quantity: number;
  }>;
};

export type CommerceCapabilities = {
  paymentsAvailable: boolean;
  provider: "payhere" | null;
  shopCheckoutAvailable: boolean;
};

export async function fetchProducts() {
  const data = await fetchApiJson<{ products: Product[] }>("/api/products", { cache: "no-store" }, "Could not load the shop.");
  return data.products;
}

export async function fetchProduct(slug: string) {
  const data = await fetchApiJson<{ product: Product }>(`/api/products/${encodeURIComponent(slug)}`, { cache: "no-store" }, "Product not found.");
  return data.product;
}

export async function fetchOrder(publicToken: string) {
  const data = await fetchApiJson<{ order: MerchandiseOrder }>(`/api/orders/${encodeURIComponent(publicToken)}`, { cache: "no-store" }, "Order not found.");
  return data.order;
}
