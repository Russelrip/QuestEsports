import { notFound } from "next/navigation";
import PaymentStatusCard from "@/components/payments/PaymentStatusCard";
import PageLayout from "@/components/PageLayout";
import { Container } from "@/components/ui/container";
import { fetchOrder } from "@/lib/shop";
import { ApiRequestError } from "@/lib/api";

export default async function ShopOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let order;
  try { order = await fetchOrder(token); }
  catch (error) { if (error instanceof ApiRequestError && error.status === 404) notFound(); throw error; }
  return <PageLayout title="Order Status" description="View your Quest merchandise order."><section className="py-10"><Container>{order.paymentOrderId ? <PaymentStatusCard orderId={order.paymentOrderId} publicToken={token} returnHref="/shop" clearCartOnPaid /> : <p className="text-white">Payment record is not available.</p>}<div className="mx-auto mt-6 max-w-2xl rounded-[24px] border border-white/10 bg-[#0d0c13] p-6"><h3 className="text-xl text-white">Order summary</h3>{order.items.map((item) => <div key={item.id} className="mt-3 flex justify-between text-sm text-slate-300"><span>{item.productName} · {item.variantName} × {item.quantity}</span><span>{order.currency} {item.lineTotal.toFixed(2)}</span></div>)}<div className="mt-4 border-t border-white/10 pt-4 text-right font-semibold text-white">Total {order.currency} {order.total.toFixed(2)}</div></div></Container></section></PageLayout>;
}
