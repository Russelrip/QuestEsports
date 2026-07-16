"use client";

import { FormEvent, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adminRequest } from "@/lib/admin";
import type { Product } from "@/lib/shop";

const initialVariants = JSON.stringify([{ sku: "QUEST-TEE-S", name: "Small", size: "S", color: "Black", price: 3500, stock: null, isActive: true }], null, 2);
const empty = { name: "", slug: "", description: "", currency: "LKR", status: "draft", displayOrder: "100", madeToOrder: true, variants: initialVariants };

export default function AdminProductsManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<Product | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [retainedImages, setRetainedImages] = useState<Product["images"]>([]);
  const [message, setMessage] = useState("");
  const load = async () => setProducts((await adminRequest<{ products: Product[] }>("/api/admin/products")).products);
  useEffect(() => { const initialLoad = async () => { try { setProducts((await adminRequest<{ products: Product[] }>("/api/admin/products")).products); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load products."); } }; void initialLoad(); }, []);
  const reset = () => { setForm(empty); setEditing(null); setFiles([]); setRetainedImages([]); };
  const edit = (product: Product) => { setEditing(product); setRetainedImages(product.images); setForm({ name: product.name, slug: product.slug, description: product.description, currency: product.currency, status: product.status, displayOrder: String(product.displayOrder), madeToOrder: product.madeToOrder, variants: JSON.stringify(product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, name: variant.name, size: variant.size, color: variant.color, price: variant.price, stock: variant.stock, isActive: variant.isActive })), null, 2) }); setFiles([]); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    const newlyUploadedImageIds: string[] = [];
    try {
      const variants = JSON.parse(form.variants);
      const images: Array<{ id?: string; imageAssetId: string; altText: string; displayOrder: number }> = retainedImages.filter((image) => image.imageAssetId).map((image) => ({ id: image.id, imageAssetId: image.imageAssetId as string, altText: image.altText, displayOrder: image.displayOrder }));
      if (files.length) {
        const uploadBody = new FormData(); files.forEach((file) => uploadBody.append("images", file)); uploadBody.append("title", form.name);
        const uploaded = await adminRequest<{ images: Array<{ id: string; title: string }> }>("/api/images", { method: "POST", body: uploadBody });
        newlyUploadedImageIds.push(...uploaded.images.map((image) => image.id));
        uploaded.images.forEach((image, index) => images.push({ imageAssetId: image.id, altText: form.name, displayOrder: images.length + index }));
      }
      await adminRequest(editing ? `/api/admin/products/${editing.id}` : "/api/admin/products", { method: editing ? "PATCH" : "POST", json: { ...form, variants, images } });
      reset(); setMessage("Product saved."); await load();
    } catch (error) {
      await Promise.allSettled(newlyUploadedImageIds.map((imageId) => adminRequest(`/api/images/${imageId}`, { method: "DELETE" })));
      setMessage(error instanceof Error ? error.message : "Unable to save product. Check the variant JSON.");
    }
  };
  return <AdminShell title="Products" description="Publish merchandise, variants, prices, images, made-to-order rules, and stock.">
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="p-6"><h3 className="text-2xl text-white">{editing ? "Edit product" : "New product"}</h3><form onSubmit={submit} className="mt-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2"><Input required placeholder="Quest Team Shirt" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><Input required placeholder="quest-team-shirt" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
        <Textarea required placeholder="Product description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-3"><Input required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></Select><Input type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} /></div>
        <label className="flex items-center gap-3 text-sm text-slate-300"><input type="checkbox" checked={form.madeToOrder} onChange={(e) => setForm({ ...form, madeToOrder: e.target.checked })} /> Made to order</label>
        <label className="text-sm text-slate-300">Product images<Input className="mt-2" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []))} /><span className="mt-2 block text-xs text-slate-400">PNG, JPG, or WebP · Max 10 MB each · Recommended 1200 × 1200 px (1:1) · Up to 10 images.</span></label>
        {retainedImages.length ? <div className="grid gap-2">{retainedImages.map((image) => <div key={image.id} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300"><span>{image.altText || "Product image"}</span><button type="button" className="text-rose-300" onClick={() => setRetainedImages((current) => current.filter((entry) => entry.id !== image.id))}>Remove</button></div>)}</div> : null}
        <label className="text-sm text-slate-300">Variants JSON<Textarea className="mt-2 min-h-64 font-mono text-xs" required value={form.variants} onChange={(e) => setForm({ ...form, variants: e.target.value })} /></label>
        {message ? <p className="text-sm text-slate-300">{message}</p> : null}<div className="flex gap-2"><Button type="submit">Save product</Button>{editing ? <Button type="button" variant="ghost" onClick={reset}>Cancel</Button> : null}</div>
      </form></Card>
      <div className="grid gap-4">{products.map((product) => <Card key={product.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-cyan-200">{product.status} · {product.currency}</p><h3 className="mt-2 text-xl text-white">{product.name}</h3><p className="mt-2 text-sm text-slate-400">{product.variants.length} variants · {product.images.length} images</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => edit(product)}>Edit</Button>{product.status !== "archived" ? <Button variant="danger" onClick={async () => { if (!confirm(`Archive ${product.name}?`)) return; try { await adminRequest(`/api/admin/products/${product.id}`, { method: "DELETE" }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to archive product."); } }}>Archive</Button> : null}</div></div></Card>)}</div>
    </div>
  </AdminShell>;
}
