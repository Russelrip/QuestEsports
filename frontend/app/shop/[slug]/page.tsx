import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import StructuredData from "@/components/StructuredData";
import ProductDetailContent from "@/components/shop/ProductDetailContent";
import { Container } from "@/components/ui/container";
import { PageTransition } from "@/components/ui/page-transition";
import { fetchProduct } from "@/lib/shop";
import { ApiRequestError } from "@/lib/api";
import {
  buildBreadcrumbStructuredData,
  buildNoIndexMetadata,
  buildPageMetadata,
  buildProductStructuredData,
} from "@/lib/site";

const getProduct = cache(fetchProduct);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug).catch(() => null);
  return product
    ? buildPageMetadata({
        title: product.name,
        description: product.description,
        path: `/shop/${slug}`,
        image: product.images[0]?.imageUrl,
        keywords: [
          product.name,
          "Quest E-sports merchandise",
          "gaming apparel Sri Lanka",
        ],
      })
    : buildNoIndexMetadata(
        "Product Not Found",
        "This product could not be found.",
        `/shop/${slug}`
      );
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let product;
  try { product = await getProduct(slug); }
  catch (error) { if (error instanceof ApiRequestError && error.status === 404) notFound(); throw error; }
  return (
    <PageTransition>
      <StructuredData data={buildProductStructuredData(product)} />
      <StructuredData
        data={buildBreadcrumbStructuredData([
          { name: "Home", path: "/" },
          { name: "Shop", path: "/shop" },
          { name: product.name, path: `/shop/${product.slug}` },
        ])}
      />
      <section className="py-10 sm:py-14"><Container><ProductDetailContent product={product} /></Container></section>
    </PageTransition>
  );
}
