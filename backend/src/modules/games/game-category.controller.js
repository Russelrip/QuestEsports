const { asyncHandler } = require("../../lib/async-handler");
const service = require("./game-category.service");

const getPublicCategories = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, categories: await service.listPublicGameCategories() });
});
const getAdminCategories = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, categories: await service.listAdminGameCategories() });
});
const createCategory = asyncHandler(async (req, res) => {
  const category = await service.saveAdminGameCategory({ body: req.body, files: req.files });
  res.status(201).json({ success: true, message: "Game category created.", category });
});
const updateCategory = asyncHandler(async (req, res) => {
  const category = await service.saveAdminGameCategory({ categoryId: req.params.categoryId, body: req.body, files: req.files });
  res.status(200).json({ success: true, message: "Game category updated.", category });
});
const deleteCategory = asyncHandler(async (req, res) => {
  await service.deleteAdminGameCategory(req.params.categoryId);
  res.status(200).json({ success: true, message: "Game category deleted." });
});

module.exports = { getPublicCategories, getAdminCategories, createCategory, updateCategory, deleteCategory };
