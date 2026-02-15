import multer from 'multer';
import path from 'path';

// Configure storage
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP and PDF files are allowed.'));
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter
});

// Profile image upload middleware
export const uploadProfileImage = upload.single('profileImage');

// Multiple files upload middleware
export const uploadMultiple = (fields) => {
  return upload.fields(fields);
};

// Specific upload configurations

// Rider registration upload
export const uploadRiderDocuments = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'licenseFront', maxCount: 1 },
  { name: 'licenseBack', maxCount: 1 },
  { name: 'policeVerification', maxCount: 1 },
  { name: 'rcFront', maxCount: 1 },
  { name: 'rcBack', maxCount: 1 },
  { name: 'insuranceFront', maxCount: 1 },
  { name: 'insuranceBack', maxCount: 1 },
  { name: 'fitnessCertificate', maxCount: 1 },
  { name: 'permitCertificate', maxCount: 1 },
  // ✅ CAB IMAGES
  { name: 'cabImages', maxCount: 5 },
]);

// Cab documents upload
export const uploadCabDocuments = upload.fields([
  { name: 'rcFront', maxCount: 1 },
  { name: 'rcBack', maxCount: 1 },
  { name: 'insuranceFront', maxCount: 1 },
  { name: 'insuranceBack', maxCount: 1 },
  { name: 'fitnessCertificate', maxCount: 1 },
  { name: 'permitCertificate', maxCount: 1 },
  // ✅ CAB IMAGES
  { name: 'cabImages', maxCount: 5 },
]);

// Error handling middleware for multer
export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 5MB.'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
};

// Validate file upload
export const validateFileUpload = (req, res, next) => {
  if (!req.file && !req.files) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }
  next();
};

// Check specific file exists
export const checkFileExists = (fieldName) => {
  return (req, res, next) => {
    if (!req.file && !req.files?.[fieldName]) {
      return res.status(400).json({
        success: false,
        message: `${fieldName} is required`
      });
    }
    next();
  };
};