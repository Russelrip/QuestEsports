import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { buttonClassName } from "@/components/ui/button";
import { resolveMediaUrl } from "@/lib/media";
import type { Product } from "@/lib/shop";

export default function ShopContent({ products }: { products: Product[] }) {
  return (
    <Section className="pt-4 sm:pt-6">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Official Merchandise</p><h2 className="mt-3 text-4xl text-white">Made for the Quest community.</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">Browse official customized products. Online ordering becomes available when secure payment setup is active.</p></div>
        <Link href="/shop/cart" className={buttonClassName({ variant: "secondary" })}>View cart</Link>
      </div>
      {products.length === 0 ? <EmptyState title="Merchandise is being prepared" description="Products will appear here as soon as official variants, prices, and artwork are published." /> : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const startingPrice = Math.min(...product.variants.filter((variant) => variant.isActive).map((variant) => variant.price));
            return <Card key={product.id} className="group overflow-hidden">
              <Link href={`/shop/${product.slug}`} prefetch={false} className="block">
                <div className="relative aspect-square overflow-hidden bg-[#09080e]">
                  {product.images[0] ? <Image src={resolveMediaUrl(product.images[0].imageUrl)} alt={product.images[0].altText || product.name} fill sizes="(min-width:1280px) 33vw,(min-width:640px) 50vw,100vw" className="object-contain p-4 transition duration-500 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-7xl text-white/80">Q</div>}
                  {product.madeToOrder ? <Badge className="absolute left-4 top-4">Made to order</Badge> : null}
                </div>
                <div className="p-5"><h3 className="text-2xl text-white">{product.name}</h3><p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-400">{product.description}</p><p className="mt-5 font-semibold text-purple-100">From {product.currency} {Number.isFinite(startingPrice) ? startingPrice.toFixed(2) : "—"}</p></div>
              </Link>
            </Card>;
          })}
        </div>
      )}
    </Section>
  );
}
