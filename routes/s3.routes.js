// vendor-backend/routes/s3.routes.js
import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const router = express.Router();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Generate pre-signed URL for upload
router.get('/generate-upload-url', async (req, res) => {
  try {
    const { filename, contentType = 'application/pdf' } = req.query;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const bucketName = process.env.QUOTES_S3_BUCKET_NAME || 'workspace-quotes-and-invoices'; // ✅ use hyphen

    const key = `quotes/${filename}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    // Generate presigned URL (valid for 1 minute)
    const url = await getSignedUrl(s3Client, command, { expiresIn: 60 });

    // Publicly accessible URL (if public-read)
    const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

    res.json({ url, fileUrl });
  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

export default router;
