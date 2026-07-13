const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { isValidEmail, normalizeInteger, normalizeSlug, normalizeText } = require("../../lib/validation");
const { getImageAssetById } = require("../media/media.service");
const { deleteUnusedImageAsset } = require("../media/media.service");
const {
  assertPayHereConfigured,
  createPayHereCheckout,
  isPayHereConfigured,
  releaseOrderStock,
  expireStaleCommerceReservations,
} = require("../payments/payment.service");

const PRODUCT_STATUSES = new Set(["draft", "active", "archived"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const runSerializable = async (work) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error?.code !== "P2034" || attempt === 3) throw error;
    }
  }
};
const productInclude = {
  variants: { orderBy: [{ isActive: "desc" }, { name: "asc" }] },
  images: { orderBy: { displayOrder: "asc" }, include: { imageAsset: true } },
};

const mapProduct = (product) => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  description: product.description,
  currency: product.currency,
  status: product.status,
  madeToOrder: product.madeToOrder,
  displayOrder: product.displayOrder,
  variants: (product.variants || []).map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    size: variant.size,
    color: variant.color,
    price: Number(variant.price),
    stock: variant.stock,
    isActive: variant.isActive,
  })),
  images: (product.images || []).map((image) => ({
    id: image.id,
    imageAssetId: image.imageAssetId,
    altText: image.altText,
    displayOrder: image.displayOrder,
    imageUrl: `/api/products/${product.id}/images/${image.id}`,
  })),
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
});

const listPublicProducts = async () => {
  const products = await prisma.product.findMany({
    where: { status: "active" },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: productInclude,
  });
  return products.map(mapProduct);
};

const getPublicProduct = async (slug) => {
  const product = await prisma.product.findFirst({
    where: { slug: normalizeSlug(slug), status: "active" },
    include: productInclude,
  });
  if (!product) throw new HttpError(404, "Product not found.");
  return mapProduct(product);
};

const getProductImage = async ({ productId, imageId }) => {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId, product: { status: "active" } },
    select: { imageAssetId: true },
  });
  if (!image) throw new HttpError(404, "Product image not found.");
  return getImageAssetById(image.imageAssetId);
};

const listAdminProducts = async () => {
  const products = await prisma.product.findMany({
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: productInclude,
  });
  return products.map(mapProduct);
};

const parseArray = (value, label) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  throw new HttpError(400, `${label} must be a valid list.`);
};

const parseProduct = (body, existing) => {
  const name = normalizeText(body.name || existing?.name);
  const slug = normalizeSlug(body.slug || name || existing?.slug);
  const description = normalizeText(body.description || existing?.description);
  const currency = normalizeText(body.currency || existing?.currency || "LKR").toUpperCase();
  const status = normalizeText(body.status || existing?.status || "draft").toLowerCase();
  const displayOrder = normalizeInteger(body.displayOrder) ?? existing?.displayOrder ?? 100;
  const madeToOrder = Object.prototype.hasOwnProperty.call(body, "madeToOrder")
    ? [true, "true", "1", "on"].includes(body.madeToOrder)
    : existing?.madeToOrder ?? true;
  const variants = Object.prototype.hasOwnProperty.call(body, "variants")
    ? parseArray(body.variants, "Variants")
    : existing?.variants || [];
  const images = Object.prototype.hasOwnProperty.call(body, "images")
    ? parseArray(body.images, "Images")
    : existing?.images || [];

  if (!name || !slug || !description || !/^[A-Z]{3}$/.test(currency)) {
    throw new HttpError(400, "Product name, description, slug, and currency are required.");
  }
  if (!PRODUCT_STATUSES.has(status)) throw new HttpError(400, "Product status is invalid.");
  if (variants.length === 0 || variants.length > 100) {
    throw new HttpError(400, "Add between 1 and 100 product variants.");
  }

  const normalizedVariants = variants.map((variant, index) => {
    const sku = normalizeText(variant?.sku).toUpperCase();
    const variantName = normalizeText(variant?.name);
    const price = Number.parseFloat(String(variant?.price));
    const stock = variant?.stock === null || variant?.stock === "" || variant?.stock === undefined
      ? null
      : normalizeInteger(variant.stock);
    if (!sku || !variantName || !Number.isFinite(price) || price < 0 || (stock !== null && stock < 0)) {
      throw new HttpError(400, `Product variant ${index + 1} is invalid.`);
    }
    return {
      id: UUID_PATTERN.test(String(variant?.id || ""))
        ? String(variant.id)
        : crypto.randomUUID(),
      sku,
      name: variantName,
      size: normalizeText(variant?.size) || null,
      color: normalizeText(variant?.color) || null,
      price,
      stock,
      isActive: variant?.isActive !== false,
    };
  });

  const normalizedImages = images.slice(0, 12).map((image, index) => ({
    id: UUID_PATTERN.test(String(image?.id || ""))
      ? String(image.id)
      : crypto.randomUUID(),
    imageAssetId: normalizeText(image?.imageAssetId || image),
    altText: normalizeText(image?.altText) || name,
    displayOrder: normalizeInteger(image?.displayOrder) ?? index,
  }));
  if (normalizedImages.some((image) => !image.imageAssetId)) {
    throw new HttpError(400, "Every product image must reference an uploaded image.");
  }

  return { name, slug, description, currency, status, displayOrder, madeToOrder, variants: normalizedVariants, images: normalizedImages };
};

const saveAdminProduct = async ({ productId, body }) => {
  const existing = productId
    ? await prisma.product.findUnique({ where: { id: productId }, include: productInclude })
    : null;
  if (productId && !existing) throw new HttpError(404, "Product not found.");
  const parsed = parseProduct(body, existing);
  const duplicate = await prisma.product.findFirst({
    where: { slug: parsed.slug, ...(productId ? { id: { not: productId } } : {}) },
    select: { id: true },
  });
  if (duplicate) throw new HttpError(400, "A product already uses this slug.");

  const imageCount = await prisma.imageAsset.count({
    where: { id: { in: parsed.images.map((image) => image.imageAssetId) } },
  });
  if (imageCount !== new Set(parsed.images.map((image) => image.imageAssetId)).size) {
    throw new HttpError(400, "One or more product images were not found.");
  }

  const baseData = {
    name: parsed.name,
    slug: parsed.slug,
    description: parsed.description,
    currency: parsed.currency,
    status: parsed.status,
    displayOrder: parsed.displayOrder,
    madeToOrder: parsed.madeToOrder,
  };

  const id = productId || crypto.randomUUID();
  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.product.update({ where: { id }, data: baseData });
    } else {
      await tx.product.create({ data: { id, ...baseData } });
    }

    const existingVariantIds = new Set((existing?.variants || []).map((variant) => variant.id));
    for (const variant of parsed.variants) {
      if (existing && !existingVariantIds.has(variant.id)) {
        const conflicting = await tx.productVariant.findUnique({ where: { id: variant.id } });
        if (conflicting) throw new HttpError(400, "A product variant ID belongs to another product.");
      }
      const { id: variantId, ...variantData } = variant;
      await tx.productVariant.upsert({
        where: { id: variantId },
        update: variantData,
        create: { id: variantId, productId: id, ...variantData },
      });
    }
    const retainedVariantIds = parsed.variants.map((variant) => variant.id);
    await tx.productVariant.updateMany({
      where: { productId: id, id: { notIn: retainedVariantIds } },
      data: { isActive: false },
    });

    const existingImageIds = new Set((existing?.images || []).map((image) => image.id));
    for (const image of parsed.images) {
      if (existing && !existingImageIds.has(image.id)) {
        const conflicting = await tx.productImage.findUnique({ where: { id: image.id } });
        if (conflicting) throw new HttpError(400, "A product image ID belongs to another product.");
      }
      const { id: imageId, ...imageData } = image;
      await tx.productImage.upsert({
        where: { id: imageId },
        update: imageData,
        create: { id: imageId, productId: id, ...imageData },
      });
    }
    await tx.productImage.deleteMany({
      where: { productId: id, id: { notIn: parsed.images.map((image) => image.id) } },
    });
  });

  const retainedAssetIds = new Set(parsed.images.map((image) => image.imageAssetId));
  await Promise.allSettled(
    (existing?.images || [])
      .filter((image) => !retainedAssetIds.has(image.imageAssetId))
      .map((image) => deleteUnusedImageAsset(image.imageAssetId))
  );

  return mapProduct(await prisma.product.findUnique({ where: { id }, include: productInclude }));
};

const deleteAdminProduct = async (productId) => {
  const existing = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!existing) throw new HttpError(404, "Product not found.");
  await prisma.$transaction([
    prisma.product.update({ where: { id: productId }, data: { status: "archived" } }),
    prisma.productVariant.updateMany({ where: { productId }, data: { isActive: false } }),
  ]);
};

const resolveMerchandiseQuote = async (rawItems) => {
  const items = parseArray(rawItems, "Cart items").map((item) => ({
    variantId: normalizeText(item?.variantId),
    quantity: normalizeInteger(item?.quantity),
  }));
  if (
    items.length === 0 ||
    items.length > 20 ||
    items.some((item) => !item.variantId || !item.quantity || item.quantity > 20)
  ) {
    throw new HttpError(400, "Cart items are invalid.");
  }
  const variantIds = [...new Set(items.map((item) => item.variantId))];
  if (variantIds.length !== items.length) {
    throw new HttpError(400, "Combine duplicate cart items before checkout.");
  }
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true, product: { status: "active" } },
    include: { product: true },
  });
  if (variants.length !== items.length) {
    throw new HttpError(400, "One or more cart items are unavailable.");
  }
  const currencies = new Set(variants.map((variant) => variant.product.currency));
  if (currencies.size !== 1) throw new HttpError(400, "A cart cannot mix currencies.");
  const currency = variants[0].product.currency;
  if (currency !== "LKR") {
    throw new HttpError(400, "Merchandise checkout currently accepts LKR products only.");
  }
  const quantityById = new Map(items.map((item) => [item.variantId, item.quantity]));
  const subtotal = variants.reduce(
    (sum, variant) => sum + Number(variant.price) * quantityById.get(variant.id),
    0
  );
  const deliveryFee = env.SHOP_DELIVERY_FEE_LKR;
  return {
    items,
    variants,
    quantityById,
    currency,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
  };
};

const getMerchandiseQuote = async (rawItems) => {
  const quote = await resolveMerchandiseQuote(rawItems);
  return {
    currency: quote.currency,
    subtotal: quote.subtotal,
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    items: quote.variants.map((variant) => ({
      variantId: variant.id,
      productName: variant.product.name,
      variantName: variant.name,
      unitPrice: Number(variant.price),
      quantity: quote.quantityById.get(variant.id),
    })),
  };
};

const getCommerceCapabilities = () => ({
  paymentsAvailable: isPayHereConfigured(),
  provider: isPayHereConfigured() ? "payhere" : null,
  shopCheckoutAvailable: isPayHereConfigured(),
});

const createMerchandiseOrder = async ({ body, user }) => {
  assertPayHereConfigured();
  const email = normalizeText(body.email || user?.email).toLowerCase();
  const firstName = normalizeText(body.firstName || user?.firstName);
  const lastName = normalizeText(body.lastName || user?.lastName);
  const phone = normalizeText(body.phone || user?.phone);
  const address = normalizeText(body.address);
  const city = normalizeText(body.city);
  if (!isValidEmail(email) || !firstName || !lastName || !phone || !address || !city) {
    throw new HttpError(400, "Complete all customer and delivery fields.");
  }
  const { variants, quantityById, currency, subtotal, deliveryFee, total } =
    await resolveMerchandiseQuote(body.items);
  if (
    Number(body.expectedTotal) !== total ||
    normalizeText(body.expectedCurrency).toUpperCase() !== currency
  ) {
    throw new HttpError(
      409,
      "Your cart price changed. Review the updated total before continuing."
    );
  }
  const orderId = crypto.randomUUID();
  const publicToken = crypto.randomBytes(24).toString("hex");
  const providerOrderId = `MERCH-${crypto.randomUUID()}`;

  const created = await runSerializable(async (tx) => {
    for (const variant of variants) {
      const quantity = quantityById.get(variant.id);
      if (variant.stock !== null) {
        const reserved = await tx.productVariant.updateMany({
          where: { id: variant.id, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });
        if (!reserved.count) throw new HttpError(409, `${variant.name} no longer has enough stock.`);
      }
    }

    const order = await tx.merchandiseOrder.create({
      data: {
        id: orderId,
        publicToken,
        userId: user?.id || null,
        email,
        firstName,
        lastName,
        phone,
        address,
        city,
        country: "Sri Lanka",
        currency,
        subtotal,
        deliveryFee,
        total,
        expiresAt: new Date(
          Date.now() + env.SHOP_ORDER_RESERVATION_MINUTES * 60 * 1000
        ),
      },
    });
    await tx.merchandiseOrderItem.createMany({
      data: variants.map((variant) => {
        const quantity = quantityById.get(variant.id);
        return {
          id: crypto.randomUUID(),
          orderId,
          variantId: variant.id,
          productName: variant.product.name,
          variantName: variant.name,
          sku: variant.sku,
          unitPrice: variant.price,
          quantity,
          lineTotal: new Prisma.Decimal(variant.price).mul(quantity),
        };
      }),
    });
    const payment = await tx.paymentTransaction.create({
      data: {
        id: crypto.randomUUID(),
        purpose: "merchandise_order",
        status: "created",
        providerOrderId,
        merchandiseOrderId: orderId,
        amount: total,
        currency,
      },
    });
    return { order, payment };
  });

  const checkout = createPayHereCheckout({
    transaction: created.payment,
    customer: { firstName, lastName, email, phone, address, city, country: "Sri Lanka" },
    items: `Quest E-sports merchandise order ${orderId.slice(0, 8)}`,
    returnPath: `/shop/order/${publicToken}`,
    cancelPath: `/shop/order/${publicToken}?cancelled=1`,
  });
  return {
    order: { id: orderId, publicToken, subtotal, deliveryFee, total, currency, status: "pending_payment" },
    paymentOrderId: providerOrderId,
    checkout,
  };
};

const getOrderByToken = async (publicToken) => {
  await expireStaleCommerceReservations({ batchSize: 25 });
  const order = await prisma.merchandiseOrder.findUnique({
    where: { publicToken },
    include: { items: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) throw new HttpError(404, "Order not found.");
  return {
    id: order.id,
    publicToken: order.publicToken,
    status: order.status,
    currency: order.currency,
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.deliveryFee),
    total: Number(order.total),
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    paymentOrderId: order.payments[0]?.providerOrderId || null,
    paymentStatus: order.payments[0]?.status || "created",
    items: order.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice), lineTotal: Number(item.lineTotal) })),
  };
};

const mapAdminOrder = (order) => ({
  id: order.id,
  publicToken: order.publicToken,
  status: order.status,
  email: order.email,
  firstName: order.firstName,
  lastName: order.lastName,
  phone: order.phone,
  address: order.address,
  city: order.city,
  country: order.country,
  currency: order.currency,
  subtotal: Number(order.subtotal),
  deliveryFee: Number(order.deliveryFee),
  total: Number(order.total),
  createdAt: order.createdAt,
  expiresAt: order.expiresAt,
  paymentOrderId: order.payments[0]?.providerOrderId || null,
  paymentStatus: order.payments[0]?.status || "created",
  items: order.items.map((item) => ({
    ...item,
    unitPrice: Number(item.unitPrice),
    lineTotal: Number(item.lineTotal),
  })),
});

const listAdminOrders = async (query = {}) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 25, 1), 100);
  const [total, orders] = await prisma.$transaction([
    prisma.merchandiseOrder.count(),
    prisma.merchandiseOrder.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { items: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);
  return {
    items: orders.map(mapAdminOrder),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  };
};

const updateAdminOrderStatus = async ({ orderId, status }) => {
  const allowed = new Set(["processing", "fulfilled", "cancelled"]);
  const normalized = normalizeText(status).toLowerCase();
  if (!allowed.has(normalized)) throw new HttpError(400, "Order status is invalid.");
  return prisma.$transaction(async (tx) => {
    const order = await tx.merchandiseOrder.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!order) throw new HttpError(404, "Order not found.");

    if (["processing", "fulfilled"].includes(normalized)) {
      if (order.payments[0]?.status !== "paid") {
        throw new HttpError(409, "Only a provider-confirmed paid order can be fulfilled.");
      }
      if (normalized === "fulfilled" && !["paid", "processing"].includes(order.status)) {
        throw new HttpError(409, "Move the paid order through processing before fulfilment.");
      }
      return tx.merchandiseOrder.update({
        where: { id: orderId },
        data: { status: normalized },
      });
    }

    if (order.status !== "pending_payment") {
      throw new HttpError(409, "Paid orders require a verified refund workflow before cancellation.");
    }
    await releaseOrderStock(tx, orderId, "cancelled");
    await tx.paymentTransaction.updateMany({
      where: { merchandiseOrderId: orderId, status: { in: ["created", "pending"] } },
      data: { status: "expired" },
    });
    return tx.merchandiseOrder.findUnique({ where: { id: orderId } });
  });
};

module.exports = {
  listPublicProducts,
  getPublicProduct,
  getProductImage,
  listAdminProducts,
  saveAdminProduct,
  deleteAdminProduct,
  createMerchandiseOrder,
  getOrderByToken,
  listAdminOrders,
  updateAdminOrderStatus,
  getMerchandiseQuote,
  getCommerceCapabilities,
};
