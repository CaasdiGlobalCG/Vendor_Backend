import express from 'express';
import {
  getItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem
} from '../controllers/itemsController.js';

const router = express.Router();

// Get all items
router.get('/', getItems);

// Get item by ID
router.get('/:itemId', getItemById);

// Create new item
router.post('/', createItem);

// Update item
router.put('/:itemId', updateItem);

// Delete item
router.delete('/:itemId', deleteItem);

export default router;
