const { asyncHandler } = require("../../lib/async-handler");
const service = require("./shop.service");

const sendImage = (res, image) => {
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", image.data.length);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.status(200).send(image.data);
};

const getProducts = asyncHandler(async (req, res) => res.status(200).json({ success: true, products: await service.listPublicProducts() }));
const getProduct = asyncHandler(async (req, res) => res.status(200).json({ success: true, product: await service.getPublicProduct(req.params.slug) }));
const getCapabilities = asyncHandler(async (req, res) => res.status(200).json({ success: true, capabilities: service.getCommerceCapabilities() }));
const quoteOrder = asyncHandler(async (req, res) => res.status(200).json({ success: true, quote: await service.getMerchandiseQuote(req.body.items) }));
const streamProductImage = asyncHandler(async (req, res) => sendImage(res, await service.getProductImage(req.params)));
const createOrder = asyncHandler(async (req, res) => res.status(201).json({ success: true, ...(await service.createMerchandiseOrder({ body: req.body, user: req.user })) }));
const getOrder = asyncHandler(async (req, res) => res.status(200).json({ success: true, order: await service.getOrderByToken(req.params.publicToken) }));
const getAdminProducts = asyncHandler(async (req, res) => res.status(200).json({ success: true, products: await service.listAdminProducts() }));
const createProduct = asyncHandler(async (req, res) => res.status(201).json({ success: true, product: await service.saveAdminProduct({ body: req.body }) }));
const updateProduct = asyncHandler(async (req, res) => res.status(200).json({ success: true, product: await service.saveAdminProduct({ productId: req.params.productId, body: req.body }) }));
const deleteProduct = asyncHandler(async (req, res) => { await service.deleteAdminProduct(req.params.productId); res.status(200).json({ success: true }); });
const getAdminOrders = asyncHandler(async (req, res) => {
  const result = await service.listAdminOrders(req.query);
  res.status(200).json({ success: true, orders: result.items, pagination: result.pagination });
});
const updateOrder = asyncHandler(async (req, res) => res.status(200).json({ success: true, order: await service.updateAdminOrderStatus({ orderId: req.params.orderId, status: req.body.status }) }));

module.exports = { getProducts, getProduct, getCapabilities, quoteOrder, streamProductImage, createOrder, getOrder, getAdminProducts, createProduct, updateProduct, deleteProduct, getAdminOrders, updateOrder };
