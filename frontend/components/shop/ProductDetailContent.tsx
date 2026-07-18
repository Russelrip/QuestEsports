"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useCartStore } from "@/hooks/useCartStore";
import { resolveMediaUrl } from "@/lib/media";
import type { Product } from "@/lib/shop";

export default function ProductDetailContent({ product }: { product: Product }) {
  const activeVariants = useMemo(() => product.variants.filter((variant) => variant.isActive && (variant.stock === null || variant.stock > 0)), [product.variants]);
  const [variantId, setVariantId] = useState(activeVariants[0]?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((state) => state.addItem);
  const variant = activeVariants.find((entry) => entry.id === variantId);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="grid gap-4 sm:grid-cols-2">
        {(product.images.length > 0 ? product.images : [{ id: "placeholder", imageUrl: "", altText: product.name, displayOrder: 0 }]).map((image, index) => (
          <Card key={image.id} className={`relative aspect-square overflow-hidden bg-[#09080e] ${index === 0 ? "sm:col-span-2" : ""}`}>
            {image.imageUrl ? <Image src={resolveMediaUrl(image.imageUrl)} alt={image.altText || product.name} fill sizes="(min-width:1024px) 55vw,100vw" className="object-contain p-4" priority={index === 0} /> : <div className="flex h-full items-center justify-center text-8xl text-white">Q</div>}
          </Card>
        ))}
      </div>
      <div>
        <Link href="/shop" className="text-sm text-slate-400 transition hover:text-white">Back to shop</Link>
        <p className="mt-8 text-xs uppercase tracking-[0.28em] text-purple-200/80">Official Quest Merchandise</p>
        <h1 className="mt-4 text-5xl text-white">{product.name}</h1>
        <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-300">{product.description}</p>
        <div className="mt-8 grid gap-5 rounded-[28px] border border-white/10 bg-[#0d0c13] p-6">
          <label className="grid gap-2 text-sm font-medium text-slate-300">Size / variant<Select value={variantId} onChange={(event) => setVariantId(event.target.value)}>{activeVariants.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.size ? ` · ${entry.size}` : ""}{entry.color ? ` · ${entry.color}` : ""} — {product.currency} {entry.price.toFixed(2)}</option>)}</Select></label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">Quantity<input type="number" min="1" max="20" value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value))))} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" /></label>
          <p className="text-2xl font-semibold text-white">{variant ? `${product.currency} ${(variant.price * quantity).toFixed(2)}` : "Unavailable"}</p>
          <Button type="button" disabled={!variant} onClick={() => { if (!variant) return; addItem({ variantId: variant.id, productId: product.id, productSlug: product.slug, productName: product.name, variantName: variant.name, currency: product.currency, unitPrice: variant.price, imageUrl: product.images[0]?.imageUrl || null }, quantity); setAdded(true); }}>Add to cart</Button>
          {added ? <Link href="/shop/cart" className={buttonClassName({ variant: "secondary", className: "justify-center" })}>Added — open cart</Link> : null}
        </div>
        <p className="mt-5 text-xs leading-6 text-slate-500">Customized items are non-returnable for change of mind, incorrect size selection, or personalization. Wrong, damaged, or defective deliveries remain covered by our support policy.</p>
      </div>
    </div>
  );
}
