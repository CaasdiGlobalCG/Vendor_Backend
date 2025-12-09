import express from 'express';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers
} from '../controllers/customersController.js';

const router = express.Router();

// GET /api/customers - Get all customers
router.get('/', getCustomers);

// GET /api/customers/search - Search customers
router.get('/search', searchCustomers);

// GET /api/customers/:customerId - Get customer by ID
router.get('/:customerId', getCustomerById);

// POST /api/customers - Create new customer
router.post('/', createCustomer);

// PUT /api/customers/:customerId - Update customer
router.put('/:customerId', updateCustomer);

// DELETE /api/customers/:customerId - Delete customer
router.delete('/:customerId', deleteCustomer);

export default router;

