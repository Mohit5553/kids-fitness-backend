import path from 'path';
import express from 'express';
import multer from 'multer';

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
       console.error('Multer Error:', err.message);
       return res.status(400).json({ message: 'Multer error', error: err.message });
    } else if (err) {
       console.error('Upload Failed Error Object:', err);
       return res.status(400).json({ message: 'Upload failed', error: typeof err === 'string' ? err : err.message || 'Unknown error' });
    }

    if (!req.file) {
      console.error('No file in request');
      return res.status(400).json({ message: 'Please upload a file' });
    }

    console.log('File uploaded successfully:', req.file.path);

    res.send({
      message: 'Image uploaded',
      image: `/${req.file.path.replace(/\\/g, '/')}`,
    });
  });
});

export default router;
