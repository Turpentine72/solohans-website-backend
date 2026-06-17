import express from 'express';
import cloudinary from 'cloudinary';
import multer from 'multer';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Configure Cloudinary
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer setup – store file in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /api/upload
router.post('/', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Convert buffer to base64 data URI
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const result = await cloudinary.v2.uploader.upload(b64, {
      folder: req.body.folder || 'uploads',
    });

    res.json({ url: result.secure_url });
  } catch (error) {
    console.error('Upload error details:', error);
    const message = error?.message || 'Upload failed';
    res.status(500).json({
      message,
      cloudinaryError: typeof message === 'string' && message.includes('Cloudinary') ? message : undefined,
    });
  }
});

export default router;