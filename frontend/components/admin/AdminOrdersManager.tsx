"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { adminRequest } from "@/lib/admin";
import type { MerchandiseOrder } from "@/lib/shop";

const nextStatuses = (order: MerchandiseOrder) => {
  if (order.status === "pending_payment") return ["pending_payment", "cancelled"];
  if (order.status === "paid" && order.paymentStatus === "paid") return ["paid", "processing"];
  if (order.status === "processing" && order.paymentStatus === "paid") return ["processing", "fulfilled"];
  return [order.status];
};

export default function AdminOrdersManager() {
  const [orders, setOrders] = useState<MerchandiseOrder[]>([]);
  const [message, setMessage] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const load = async () => setOrders((await adminRequest<{ orders: MerchandiseOrder[] }>("/api/admin/orders")).orders);

  useEffect(() => {
    const initialLoad = async () => {
      try { await load(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load orders."); }
    };
    void initialLoad();
  }, []);

  const updateStatus = async (order: MerchandiseOrder, status: string) => {
    if (status === order.status) return;
    setUpdating(order.id);
    setMessage("");
    try {
      await adminRequest(`/api/admin/orders/${order.id}`, { method: "PATCH", json: { status } });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update order.");
    } finally {
      setUpdating(null);
    }
  };

  return <AdminShell title="Merchandise Orders" description="Review provider-confirmed payments and manage delivery fulfilment separately from payment state.">
    {message ? <p className="mb-4 text-sm text-rose-300">{message}</p> : null}
    <div className="grid gap-4">
      {orders.map((order) => <Card key={order.id} className="p-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-purple-200">{order.paymentStatus} payment · {order.status.replaceAll("_", " ")}</p>
            <h3 className="mt-2 text-xl text-white">{order.currency} {order.total.toFixed(2)} · {order.items.reduce((sum, item) => sum + item.quantity, 0)} items</h3>
            <p className="mt-2 text-sm text-slate-300">{order.firstName} {order.lastName} · {order.email} · {order.phone}</p>
            <p className="mt-1 text-sm text-slate-400">{order.address}, {order.city}, {order.country}</p>
            <p className="mt-2 text-sm text-slate-300">{order.items.map((item) => `${item.productName} (${item.variantName}) × ${item.quantity}`).join(", ")}</p>
            <p className="mt-2 text-xs text-slate-500">Order {order.id} · {new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <div className="flex gap-2">
            <Select aria-label="Order status" value={order.status} disabled={updating === order.id || nextStatuses(order).length === 1} onChange={(event) => void updateStatus(order, event.target.value)}>{nextStatuses(order).map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</Select>
            <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(order.id); setMessage("Order ID copied."); } catch { setMessage("The order ID could not be copied."); } }}>Copy ID</Button>
          </div>
        </div>
      </Card>)}
      {orders.length === 0 ? <Card className="p-6 text-sm text-slate-400">No merchandise orders yet.</Card> : null}
    </div>
  </AdminShell>;
}
