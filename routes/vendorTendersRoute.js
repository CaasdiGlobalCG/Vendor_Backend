import express from 'express';
import axios from 'axios';

const router = express.Router();
const SALES_BACKEND_URL = process.env.SALES_BACKEND_URL || 'http://localhost:5002';

/**
 * GET /api/vendor/tenders?vendorId=<id>
 * Proxies to Sales Backend to fetch tenders for a specific vendor.
 */
router.get('/', async (req, res) => {
  const { vendorId } = req.query;

  if (!vendorId) {
    return res.status(400).json({ success: false, message: 'vendorId query parameter is required' });
  }

  try {
    const response = await axios.get(`${SALES_BACKEND_URL}/api/tenders/vendor`, {
      params: { vendorId },
      timeout: 8000,
    });

    return res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const message = err.response?.data?.message || 'Failed to fetch tenders from Sales service';
    console.error(`[vendorTendersRoute] Error fetching tenders for vendorId=${vendorId}:`, err.message);
    return res.status(status).json({ success: false, message });
  }
});

export default router;
