import path from 'path';
import fs from 'fs';
import express from 'express';
import multer from 'multer';

// Ensure uploads directory exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const router = express.Router();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename(req, file, cb) {
    cb(
      null,
      `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`
    );
  },
});

function checkFileType(file, cb) {
  // Broaden file types for debugging
  const filetypes = /jpg|jpeg|png|webp|gif/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  
  if (extname) {
    return cb(null, true);
  } else {
    cb('Images only (jpg, jpeg, png, webp, gif)!');
  }
}

const upload = multer({
  storage,
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  },
});

router.post('/', (req, res) => {
  upload.single('image')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
       console.error('Multer Error during file upload:', err.message, err.code);
       return res.status(400).json({ 
         message: 'Multer error', 
         error: err.message,
         code: err.code 
       });
    } else if (err) {
       console.error('File Upload Filter Error:', err);
       return res.status(400).json({ 
         message: 'Upload failed', 
         error: typeof err === 'string' ? err : err.message || 'Unknown error' 
       });
    }

    if (!req.file) {
      console.error('Upload Request Error: No file found in request "image" field');
      return res.status(400).json({ message: 'Please upload a file using the "image" field' });
    }

    console.log('File uploaded successfully to server:', req.file.path);

    res.send({
      message: 'Image uploaded successfully',
      image: `/${req.file.path.replace(/\\/g, '/')}`,
    });
  });
});

export default router;
