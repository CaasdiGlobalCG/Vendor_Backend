import express from 'express';
import { getDashboardStats, getDashboardSales, getDashboardRecentPayments, getDashboardTopCustomers, getDashboardRecentActivity, getDashboardUpcomingPayments } from '../modules/dashboard/controllers/dashboardController.js';

const router = express.Router();

router.get('/stats', getDashboardStats);
router.get('/sales', getDashboardSales);
router.get('/recent-payments', getDashboardRecentPayments);
router.get('/top-customers', getDashboardTopCustomers);
router.get('/recent-activity', getDashboardRecentActivity);
router.get('/upcoming-payments', getDashboardUpcomingPayments);

export default router;
