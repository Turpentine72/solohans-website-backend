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

// Multer setup – store file in memory, image-only, capped at 5MB.
// Previously had no limits at all: any authenticated user could upload an
// arbitrarily large file (risking memory exhaustion) or a non-image file
// of any type that would then be served back through the app via its
// Cloudinary URL (e.g. as a "menu image").
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error(`Only image files are allowed (jpeg, png, webp, gif, avif) — got "${file.mimetype}".`));
    }
    cb(null, true);
  },
});

// POST /api/upload
router.post('/', protect, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File is too large — the maximum allowed size is 5MB.' });
      }
      return res.status(400).json({ message: err.message });
    }
    if (err) return res.status(400).json({ message: err.message });
    next();
  });
}, async (req, res) => {
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