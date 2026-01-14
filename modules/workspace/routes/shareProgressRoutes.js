import express from 'express';
import { authenticateUser, requireVendor } from '../../../middleware/authMiddleware.js';
import { shareProgress } from '../controllers/shareProgressController.js';

const router = express.Router();

router.post('/share-progress', authenticateUser, requireVendor, shareProgress);

export default router;
