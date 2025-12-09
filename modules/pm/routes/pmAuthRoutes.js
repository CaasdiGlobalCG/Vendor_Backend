import express from 'express';
import * as pmAuthController from '../controllers/pmAuthController.js';

const router = express.Router();

// PM Authentication Routes
router.post('/login', pmAuthController.loginPM);
router.post('/register', pmAuthController.registerPM);

// PM Profile Routes (Protected)
router.get('/profile/:pmId', pmAuthController.verifyPMToken, pmAuthController.getPMProfile);
router.put('/profile/:pmId', pmAuthController.verifyPMToken, pmAuthController.updatePMProfile);

// Token verification endpoint
router.get('/verify-token', pmAuthController.verifyPMToken, (req, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    user: req.pmUser
  });
});

export default router;
