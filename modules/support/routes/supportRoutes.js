import express from 'express';
import multer from 'multer';
import { authenticateCognitoJwt } from '../../../middleware/cognitoJwtMiddleware.js';
import { attachVendorId } from '../../../middleware/attachVendorId.js';
import {
  createTicket,
  listMyTickets,
  listReferenceOptions,
  getTicket,
  getTicketReference,
  addMessage,
  rateTicket,
  reopenTicket,
} from '../controllers/supportController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// All routes require a valid Cognito session and a resolved vendorId
router.use(authenticateCognitoJwt);
router.use(attachVendorId);

router.get('/reference-options',                                       listReferenceOptions);
router.post('/',                          upload.array('files', 10), createTicket);
router.get('/',                                                       listMyTickets);
router.get('/:ticketId',                                              getTicket);
router.get('/:ticketId/reference',                                    getTicketReference);
router.post('/:ticketId/messages',        upload.array('files', 5),  addMessage);
router.put('/:ticketId/rate',                                         rateTicket);
router.put('/:ticketId/reopen',                                       reopenTicket);

export default router;
