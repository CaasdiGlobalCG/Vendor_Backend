import express from 'express';
import { getAllEmployees, getEmployeeById } from '../controllers/employeeController.js';

const router = express.Router();

/**
 * @route   GET /api/employees
 * @desc    Get all employees 
 * @access  Public (temporarily for CAS invitation feature)
 */
router.get('/employees', getAllEmployees);

/**
 * @route   GET /api/employees/:employeeId
 * @desc    Get employee by ID
 * @access  Public (temporarily for CAS invitation feature)
 */
router.get('/employees/:employeeId', getEmployeeById);

export default router;
