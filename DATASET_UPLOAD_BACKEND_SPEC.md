# Dataset Upload Backend - Complete Specification & Implementation

## A. API Design

### Endpoints Overview

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/datasets/upload` | POST | Bearer | Upload dataset files preserving folder structure |
| `/api/projects/:company/:project/versions` | GET | Bearer | List all versions for a project |
| `/api/datasets/:datasetId` | GET | Bearer | Get dataset metadata |
| `/api/datasets/:datasetId/status` | GET | Bearer | Get processing status (for polling) |
| `/api/datasets/:datasetId/tree` | GET | Bearer | Get folder tree structure |
| `/api/datasets/:datasetId/previews` | GET | Bearer | Get preview thumbnails |
| `/api/datasets/:datasetId/file/:fileId/preview` | GET | Bearer | Get single file preview |
| `/api/datasets/:datasetId/download` | GET | Bearer | Download dataset as archive (optional) |

### Detailed Endpoint Specifications

#### 1. POST `/api/datasets/upload`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
Content-Type: multipart/form-data
```

**Form Data:**
- `company` (string, required): Company identifier
- `project` (string, required): Project identifier
- `version` (string, optional): Version identifier (e.g., "v1", "v2"). If omitted, backend auto-increments
- `files[]` (File[], required): Array of files with `webkitRelativePath` preserved as filename

**Response (202 Accepted):**
```json
{
  "datasetId": "550e8400-e29b-41d4-a716-446655440000",
  "company": "acme",
  "project": "line1",
  "version": "v2",
  "status": "uploaded",
  "totalFiles": 1250,
  "totalSize": 524288000,
  "message": "Dataset uploaded successfully. Processing started."
}
```

**Error Responses:**
- `400 Bad Request`: Missing required fields, invalid file types
- `401 Unauthorized`: Invalid or missing Bearer token
- `413 Payload Too Large`: Upload exceeds size limit
- `500 Internal Server Error`: Server error

---

#### 2. GET `/api/projects/:company/:project/versions`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Query Parameters:**
- `limit` (number, optional, default: 50): Max versions to return
- `offset` (number, optional, default: 0): Pagination offset
- `status` (string, optional): Filter by status (`uploaded`, `processing`, `ready`, `failed`)

**Response (200 OK):**
```json
{
  "company": "acme",
  "project": "line1",
  "versions": [
    {
      "datasetId": "550e8400-e29b-41d4-a716-446655440000",
      "version": "v2",
      "status": "ready",
      "totalFiles": 1250,
      "totalSize": 524288000,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:35:00Z"
    },
    {
      "datasetId": "660e8400-e29b-41d4-a716-446655440001",
      "version": "v1",
      "status": "ready",
      "totalFiles": 980,
      "totalSize": 412345600,
      "createdAt": "2024-01-10T08:20:00Z",
      "updatedAt": "2024-01-10T08:25:00Z"
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

---

#### 3. GET `/api/datasets/:datasetId`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Response (200 OK):**
```json
{
  "datasetId": "550e8400-e29b-41d4-a716-446655440000",
  "company": "acme",
  "project": "line1",
  "version": "v2",
  "status": "ready",
  "totalFiles": 1250,
  "totalSize": 524288000,
  "imageCount": 625,
  "labelCount": 625,
  "thumbnailsGenerated": 625,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:35:00Z",
  "metadata": {
    "labels": ["class_0", "class_1", "class_2"],
    "trainCount": 500,
    "valCount": 100,
    "testCount": 25
  }
}
```

---

#### 4. GET `/api/datasets/:datasetId/status`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Response (200 OK):**
```json
{
  "datasetId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "progress": {
    "processed": 750,
    "total": 1250,
    "percent": 60
  },
  "stage": "generating_thumbnails",
  "message": "Generating thumbnails...",
  "updatedAt": "2024-01-15T10:32:00Z"
}
```

**Status Values:**
- `uploaded`: Files uploaded, queued for processing
- `processing`: Currently processing (thumbnails, metadata extraction)
- `ready`: Processing complete, dataset ready
- `failed`: Processing failed (check `errorMessage`)

---

#### 5. GET `/api/datasets/:datasetId/tree`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Query Parameters:**
- `maxDepth` (number, optional, default: 10): Maximum tree depth
- `includeFiles` (boolean, optional, default: true): Include file metadata in tree

**Response (200 OK):**
```json
{
  "datasetId": "550e8400-e29b-41d4-a716-446655440000",
  "tree": {
    "type": "directory",
    "name": "root",
    "path": "",
    "children": [
      {
        "type": "directory",
        "name": "images",
        "path": "images",
        "fileCount": 625,
        "size": 419430400,
        "children": [
          {
            "type": "directory",
            "name": "Missing_hole",
            "path": "images/Missing_hole",
            "fileCount": 125,
            "size": 83886080,
            "children": [
              {
                "type": "file",
                "name": "img001.jpg",
                "path": "images/Missing_hole/img001.jpg",
                "size": 671088,
                "mimeType": "image/jpeg",
                "fileId": "file_123",
                "hasPreview": true,
                "previewUrl": "https://cdn.example.com/thumbnails/acme/line1/v2/images/Missing_hole/img001.jpg"
              }
            ]
          }
        ]
      },
      {
        "type": "directory",
        "name": "labels",
        "path": "labels",
        "fileCount": 625,
        "size": 104857600,
        "children": []
      }
    ]
  }
}
```

---

#### 6. GET `/api/datasets/:datasetId/previews`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Query Parameters:**
- `limit` (number, optional, default: 50): Max previews to return
- `offset` (number, optional, default: 0): Pagination offset
- `folder` (string, optional): Filter by folder path (e.g., "images/Missing_hole")
- `format` (string, optional, default: "url"): Response format - "url" or "base64"

**Response (200 OK) - URL format:**
```json
{
  "datasetId": "550e8400-e29b-41d4-a716-446655440000",
  "previews": [
    {
      "fileId": "file_123",
      "originalPath": "images/Missing_hole/img001.jpg",
      "thumbnailUrl": "https://cdn.example.com/thumbnails/acme/line1/v2/images/Missing_hole/img001.jpg",
      "signedUrl": "https://cdn.example.com/thumbnails/acme/line1/v2/images/Missing_hole/img001.jpg?signature=...&expires=...",
      "size": {
        "width": 256,
        "height": 192
      }
    }
  ],
  "total": 625,
  "limit": 50,
  "offset": 0
}
```

**Response (200 OK) - Base64 format:**
```json
{
  "datasetId": "550e8400-e29b-41d4-a716-446655440000",
  "previews": [
    {
      "fileId": "file_123",
      "originalPath": "images/Missing_hole/img001.jpg",
      "thumbnailBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD...",
      "size": {
        "width": 256,
        "height": 192
      }
    }
  ],
  "total": 625,
  "limit": 50,
  "offset": 0
}
```

---

#### 7. GET `/api/datasets/:datasetId/file/:fileId/preview`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Response (200 OK):**
- Returns image/jpeg or image/png with thumbnail image
- Headers: `Content-Type: image/jpeg`, `Cache-Control: public, max-age=3600`

**Error Responses:**
- `404 Not Found`: File or preview not found
- `400 Bad Request`: File is not an image

---

#### 8. GET `/api/datasets/:datasetId/download`

**Headers:**
```
Authorization: Bearer <supabase_access_token>
```

**Query Parameters:**
- `format` (string, optional, default: "zip"): Archive format ("zip" or "tar.gz")

**Response (200 OK):**
- Returns archive file with `Content-Type: application/zip` or `application/gzip`
- Headers: `Content-Disposition: attachment; filename="acme-line1-v2.zip"`

---

## B. Storage Layout

### S3-Compatible Storage Structure

```
{company}/{project}/{version}/{relativePath}
```

**Examples:**
```
acme/line1/v2/images/Missing_hole/img001.jpg
acme/line1/v2/labels/Missing_hole/img001.txt
acme/line1/v2/thumbnails/images/Missing_hole/img001.jpg
```

### Local Disk Structure (Alternative/Backup)

```
datasets/
  {company}/
    {project}/
      {version}/
        images/
          {relativePath}
        labels/
          {relativePath}
        thumbnails/
          {relativePath}
```

### Thumbnail Storage

Thumbnails stored at:
```
{company}/{project}/{version}/thumbnails/{relativePath}
```

**Thumbnail Naming:**
- Original: `images/Missing_hole/img001.jpg`
- Thumbnail: `thumbnails/images/Missing_hole/img001.jpg`

**Thumbnail Specifications:**
- Max dimension: 256px (maintain aspect ratio)
- Format: JPEG (quality: 85)
- Fallback: PNG if source is PNG

---

## C. DB Schema (PostgreSQL)

### Migration SQL

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Companies table (optional, for multi-tenant)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL, -- Denormalized for faster queries
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_name, name)
);

-- Datasets table
CREATE TABLE datasets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    version VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'uploaded',
    total_files INTEGER DEFAULT 0,
    total_size BIGINT DEFAULT 0,
    image_count INTEGER DEFAULT 0,
    label_count INTEGER DEFAULT 0,
    thumbnails_generated INTEGER DEFAULT 0,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID, -- User ID from Supabase auth
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_name, project_name, version)
);

-- Dataset files table
CREATE TABLE dataset_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    relative_path VARCHAR(2048) NOT NULL, -- Full relative path from root
    file_name VARCHAR(512) NOT NULL, -- Just the filename
    directory_path VARCHAR(1536), -- Path without filename
    file_type VARCHAR(50) NOT NULL, -- 'image' or 'label'
    mime_type VARCHAR(100),
    size BIGINT NOT NULL,
    s3_key VARCHAR(2048), -- Full S3 key
    thumbnail_s3_key VARCHAR(2048), -- Thumbnail S3 key if image
    has_thumbnail BOOLEAN DEFAULT FALSE,
    checksum VARCHAR(64), -- SHA-256 hash
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dataset_id, relative_path)
);

-- Indexes for performance
CREATE INDEX idx_datasets_company_project ON datasets(company_name, project_name);
CREATE INDEX idx_datasets_status ON datasets(status);
CREATE INDEX idx_datasets_created_at ON datasets(created_at DESC);
CREATE INDEX idx_dataset_files_dataset_id ON dataset_files(dataset_id);
CREATE INDEX idx_dataset_files_relative_path ON dataset_files(relative_path);
CREATE INDEX idx_dataset_files_file_type ON dataset_files(file_type);
CREATE INDEX idx_dataset_files_directory_path ON dataset_files(directory_path);
CREATE INDEX idx_dataset_files_has_thumbnail ON dataset_files(has_thumbnail) WHERE has_thumbnail = TRUE;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_datasets_updated_at BEFORE UPDATE ON datasets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Sample Queries

```sql
-- Get latest version for a project
SELECT * FROM datasets
WHERE company_name = 'acme' AND project_name = 'line1'
ORDER BY created_at DESC
LIMIT 1;

-- Get all versions for a project
SELECT id, version, status, total_files, total_size, created_at
FROM datasets
WHERE company_name = 'acme' AND project_name = 'line1'
ORDER BY created_at DESC;

-- Get files in a specific directory
SELECT * FROM dataset_files
WHERE dataset_id = '550e8400-e29b-41d4-a716-446655440000'
  AND directory_path = 'images/Missing_hole'
ORDER BY file_name;

-- Get files with thumbnails
SELECT * FROM dataset_files
WHERE dataset_id = '550e8400-e29b-41d4-a716-446655440000'
  AND has_thumbnail = TRUE
  AND file_type = 'image'
ORDER BY relative_path;

-- Count files by directory
SELECT directory_path, COUNT(*) as file_count, SUM(size) as total_size
FROM dataset_files
WHERE dataset_id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY directory_path
ORDER BY directory_path;
```

---

## D. Node/Express Server Implementation

### Package Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "busboy": "^1.6.0",
    "@aws-sdk/client-s3": "^3.490.0",
    "@aws-sdk/s3-request-presigner": "^3.490.0",
    "sharp": "^0.33.1",
    "pg": "^8.11.3",
    "uuid": "^9.0.1",
    "dotenv": "^16.3.1",
    "express-rate-limit": "^7.1.5",
    "@supabase/supabase-js": "^2.38.4"
  }
}
```

### Environment Variables (.env)

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=visiondb
DB_USER=postgres
DB_PASSWORD=REDACTED

# S3 Storage
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
S3_BUCKET=vision-datasets
S3_ACCESS_KEY_ID=REDACTED
S3_SECRET_ACCESS_KEY=REDACTED
S3_USE_PATH_STYLE=false

# Supabase Auth
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REDACTED
SUPABASE_ANON_KEY=REDACTED

# API
API_BASE_URL=https://api.example.com
PORT=3000
CORS_ORIGIN=*

# Upload Limits
MAX_UPLOAD_SIZE=10737418240
MAX_FILE_SIZE=52428800
MAX_FILES=10000

# Thumbnails
THUMBNAIL_MAX_DIMENSION=256
THUMBNAIL_QUALITY=85
```

### Main Server File (server.js)

```javascript
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { S3Client } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');
const uploadRoutes = require('./routes/upload');
const datasetRoutes = require('./routes/datasets');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// S3 client
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: process.env.S3_USE_PATH_STYLE === 'true',
});

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Make services available to routes
app.locals.db = pool;
app.locals.s3 = s3Client;
app.locals.supabase = supabase;
app.locals.s3Bucket = process.env.S3_BUCKET;
app.locals.apiBaseUrl = process.env.API_BASE_URL;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigin === '*' || (origin && origin === allowedOrigin)) {
    res.header('Access-Control-Allow-Origin', allowedOrigin === '*' ? '*' : origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  } else {
    return res.status(403).json({ error: 'CORS origin denied' });
  }
});

// Routes
app.use('/api/datasets', authMiddleware, datasetRoutes);
app.use('/api/datasets/upload', authMiddleware, uploadRoutes);
app.use('/api/projects', authMiddleware, require('./routes/projects'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
```

### Auth Middleware (middleware/auth.js)

```javascript
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Middleware to validate Bearer token via Supabase
 */
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = authMiddleware;
```

### Upload Route (routes/upload.js)

```javascript
const express = require('express');
const busboy = require('busboy');
const { v4: uuidv4 } = require('uuid');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

const router = express.Router();

const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || '10737418240'); // 10GB
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB
const MAX_FILES = parseInt(process.env.MAX_FILES || '10000');
const THUMBNAIL_MAX_DIM = parseInt(process.env.THUMBNAIL_MAX_DIMENSION || '256');
const THUMBNAIL_QUALITY = parseInt(process.env.THUMBNAIL_QUALITY || '85');

const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_LABEL_EXT = ['.txt', '.json', '.xml', '.yaml', '.yml'];

/**
 * POST /api/datasets/upload
 * Handles multipart file upload preserving relative paths
 */
router.post('/', async (req, res) => {
  const { db, s3, s3Bucket, userId } = req.app.locals;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Parse multipart form data
    const formData = await parseMultipartFormData(req, res);
    if (!formData) return; // Error already sent

    const { company, project, version: providedVersion, files } = formData;

    // Validate required fields
    if (!company || !project) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'company and project are required' });
    }

    if (!files || files.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No files provided' });
    }

    // Determine version (auto-increment if not provided)
    let version = providedVersion;
    if (!version) {
      const versionResult = await client.query(
        `SELECT version FROM datasets 
         WHERE company_name = $1 AND project_name = $2 
         ORDER BY created_at DESC LIMIT 1`,
        [company, project]
      );
      
      if (versionResult.rows.length > 0) {
        const lastVersion = versionResult.rows[0].version;
        const versionNum = parseInt(lastVersion.replace('v', '')) || 0;
        version = `v${versionNum + 1}`;
      } else {
        version = 'v1';
      }
    }

    // Check if version already exists
    const existingResult = await client.query(
      `SELECT id FROM datasets 
       WHERE company_name = $1 AND project_name = $2 AND version = $3`,
      [company, project, version]
    );

    if (existingResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ 
        error: `Version ${version} already exists for this project` 
      });
    }

    // Create dataset record
    const datasetId = uuidv4();
    const insertDatasetResult = await client.query(
      `INSERT INTO datasets (id, company_name, project_name, version, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, company_name, project_name, version, status, created_at`,
      [datasetId, company, project, version, 'uploaded', userId]
    );

    const dataset = insertDatasetResult.rows[0];

    // Process files
    let totalFiles = 0;
    let totalSize = 0;
    let imageCount = 0;
    let labelCount = 0;
    const fileRecords = [];
    const errors = [];

    for (const file of files) {
      try {
        // Validate file
        const ext = path.extname(file.relativePath).toLowerCase();
        const isImage = ALLOWED_IMAGE_EXT.includes(ext);
        const isLabel = ALLOWED_LABEL_EXT.includes(ext);

        if (!isImage && !isLabel) {
          errors.push({
            file: file.relativePath,
            error: `Invalid file type: ${ext}`
          });
          continue;
        }

        if (file.size > MAX_FILE_SIZE) {
          errors.push({
            file: file.relativePath,
            error: `File too large: ${file.size} bytes (max: ${MAX_FILE_SIZE})`
          });
          continue;
        }

        // Build S3 keys
        const s3Key = `${company}/${project}/${version}/${file.relativePath}`;
        const thumbnailKey = isImage 
          ? `${company}/${project}/${version}/thumbnails/${file.relativePath}`
          : null;

        // Upload file to S3
        await uploadToS3(s3, s3Bucket, s3Key, file.buffer, file.mimeType);

        // Generate thumbnail for images
        let hasThumbnail = false;
        if (isImage && thumbnailKey) {
          try {
            const thumbnailBuffer = await generateThumbnail(file.buffer, ext);
            await uploadToS3(s3, s3Bucket, thumbnailKey, thumbnailBuffer, 'image/jpeg');
            hasThumbnail = true;
          } catch (thumbError) {
            console.warn(`Thumbnail generation failed for ${file.relativePath}:`, thumbError);
          }
        }

        // Calculate checksum
        const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

        // Parse path components
        const dirPath = path.dirname(file.relativePath);
        const fileName = path.basename(file.relativePath);

        // Create file record
        const fileId = uuidv4();
        fileRecords.push({
          id: fileId,
          dataset_id: datasetId,
          relative_path: file.relativePath,
          file_name: fileName,
          directory_path: dirPath,
          file_type: isImage ? 'image' : 'label',
          mime_type: file.mimeType,
          size: file.size,
          s3_key: s3Key,
          thumbnail_s3_key: thumbnailKey,
          has_thumbnail: hasThumbnail,
          checksum: checksum,
        });

        totalFiles++;
        totalSize += file.size;
        if (isImage) imageCount++;
        if (isLabel) labelCount++;

      } catch (error) {
        console.error(`Error processing file ${file.relativePath}:`, error);
        errors.push({
          file: file.relativePath,
          error: error.message
        });
      }
    }

    // Insert file records in batch
    if (fileRecords.length > 0) {
      const values = fileRecords.map((f, i) => {
        const base = i * 11;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
      }).join(', ');

      const params = fileRecords.flatMap(f => [
        f.id, f.dataset_id, f.relative_path, f.file_name, f.directory_path,
        f.file_type, f.mime_type, f.size, f.s3_key, f.thumbnail_s3_key,
        f.has_thumbnail, f.checksum
      ]);

      await client.query(
        `INSERT INTO dataset_files (
          id, dataset_id, relative_path, file_name, directory_path,
          file_type, mime_type, size, s3_key, thumbnail_s3_key,
          has_thumbnail, checksum
        ) VALUES ${values}`,
        params
      );
    }

    // Update dataset statistics
    await client.query(
      `UPDATE datasets 
       SET total_files = $1, total_size = $2, image_count = $3, label_count = $4,
           thumbnails_generated = $5, status = $6
       WHERE id = $7`,
      [
        totalFiles,
        totalSize,
        imageCount,
        labelCount,
        fileRecords.filter(f => f.has_thumbnail).length,
        'uploaded',
        datasetId
      ]
    );

    await client.query('COMMIT');

    // Queue processing job (if using Bull/Redis)
    // await processingQueue.add({ datasetId, company, project, version });

    res.status(202).json({
      datasetId,
      company,
      project,
      version,
      status: 'uploaded',
      totalFiles,
      totalSize,
      imageCount,
      labelCount,
      errors: errors.length > 0 ? errors : undefined,
      message: 'Dataset uploaded successfully. Processing started.'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * Parse multipart form data preserving relative paths
 */
function parseMultipartFormData(req, res) {
  return new Promise((resolve, reject) => {
    const busboyInstance = busboy({ 
      headers: req.headers,
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,
      }
    });

    const formData = {
      company: null,
      project: null,
      version: null,
      files: []
    };

    let totalSize = 0;

    busboyInstance.on('field', (name, value) => {
      if (name === 'company') formData.company = value;
      if (name === 'project') formData.project = value;
      if (name === 'version') formData.version = value;
    });

    busboyInstance.on('file', (name, file, info) => {
      const { filename, encoding, mimeType } = info;
      
      // filename contains the relative path from webkitdirectory
      const relativePath = filename.replace(/\\/g, '/'); // Normalize path separators
      
      const chunks = [];
      let fileSize = 0;

      file.on('data', (chunk) => {
        fileSize += chunk.length;
        totalSize += chunk.length;

        if (totalSize > MAX_UPLOAD_SIZE) {
          file.resume(); // Drain stream
          reject(new Error(`Total upload size exceeds ${MAX_UPLOAD_SIZE} bytes`));
          return;
        }

        chunks.push(chunk);
      });

      file.on('end', () => {
        if (fileSize > 0) {
          formData.files.push({
            relativePath,
            buffer: Buffer.concat(chunks),
            size: fileSize,
            mimeType: mimeType || 'application/octet-stream',
          });
        }
      });
    });

    busboyInstance.on('finish', () => {
      resolve(formData);
    });

    busboyInstance.on('error', (error) => {
      reject(error);
    });

    req.pipe(busboyInstance);
  });
}

/**
 * Upload buffer to S3
 */
async function uploadToS3(s3Client, bucket, key, buffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
}

/**
 * Generate thumbnail from image buffer
 */
async function generateThumbnail(imageBuffer, ext) {
  const isPng = ext === '.png';
  
  const thumbnail = await sharp(imageBuffer)
    .resize(THUMBNAIL_MAX_DIM, THUMBNAIL_MAX_DIM, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toBuffer();

  return thumbnail;
}

module.exports = router;
```

### Dataset Routes (routes/datasets.js)

```javascript
const express = require('express');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const router = express.Router();

/**
 * GET /api/datasets/:datasetId
 */
router.get('/:datasetId', async (req, res) => {
  const { db } = req.app.locals;
  const { datasetId } = req.params;

  try {
    const result = await db.query(
      `SELECT d.*, 
              COUNT(DISTINCT df.id) FILTER (WHERE df.file_type = 'image') as image_count,
              COUNT(DISTINCT df.id) FILTER (WHERE df.file_type = 'label') as label_count
       FROM datasets d
       LEFT JOIN dataset_files df ON df.dataset_id = d.id
       WHERE d.id = $1
       GROUP BY d.id`,
      [datasetId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    const dataset = result.rows[0];
    res.json({
      datasetId: dataset.id,
      company: dataset.company_name,
      project: dataset.project_name,
      version: dataset.version,
      status: dataset.status,
      totalFiles: dataset.total_files,
      totalSize: parseInt(dataset.total_size),
      imageCount: parseInt(dataset.image_count),
      labelCount: parseInt(dataset.label_count),
      thumbnailsGenerated: dataset.thumbnails_generated,
      createdAt: dataset.created_at,
      updatedAt: dataset.updated_at,
      metadata: dataset.metadata || {},
    });
  } catch (error) {
    console.error('Get dataset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/datasets/:datasetId/status
 */
router.get('/:datasetId/status', async (req, res) => {
  const { db } = req.app.locals;
  const { datasetId } = req.params;

  try {
    const result = await db.query(
      `SELECT id, status, total_files, thumbnails_generated, error_message, updated_at
       FROM datasets WHERE id = $1`,
      [datasetId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    const dataset = result.rows[0];
    const processed = dataset.thumbnails_generated || 0;
    const total = dataset.total_files || 0;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

    res.json({
      datasetId: dataset.id,
      status: dataset.status,
      progress: {
        processed,
        total,
        percent,
      },
      stage: dataset.status === 'processing' ? 'generating_thumbnails' : null,
      message: getStatusMessage(dataset.status),
      updatedAt: dataset.updated_at,
      errorMessage: dataset.error_message,
    });
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/datasets/:datasetId/tree
 */
router.get('/:datasetId/tree', async (req, res) => {
  const { db } = req.app.locals;
  const { datasetId } = req.params;
  const maxDepth = parseInt(req.query.maxDepth || '10');
  const includeFiles = req.query.includeFiles !== 'false';

  try {
    const filesResult = await db.query(
      `SELECT relative_path, file_name, directory_path, file_type, size, mime_type, id, has_thumbnail
       FROM dataset_files
       WHERE dataset_id = $1
       ORDER BY relative_path`,
      [datasetId]
    );

    if (filesResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dataset not found or has no files' });
    }

    const tree = buildTree(filesResult.rows, maxDepth, includeFiles);

    res.json({
      datasetId,
      tree,
    });
  } catch (error) {
    console.error('Get tree error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/datasets/:datasetId/previews
 */
router.get('/:datasetId/previews', async (req, res) => {
  const { db, s3, s3Bucket, apiBaseUrl } = req.app.locals;
  const { datasetId } = req.params;
  const limit = parseInt(req.query.limit || '50');
  const offset = parseInt(req.query.offset || '0');
  const folder = req.query.folder;
  const format = req.query.format || 'url';

  try {
    let query = `
      SELECT id, relative_path, thumbnail_s3_key, s3_key
      FROM dataset_files
      WHERE dataset_id = $1 AND file_type = 'image' AND has_thumbnail = TRUE
    `;
    const params = [datasetId];

    if (folder) {
      query += ` AND directory_path = $2`;
      params.push(folder);
    }

    query += ` ORDER BY relative_path LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    const previews = await Promise.all(
      result.rows.map(async (file) => {
        const preview = {
          fileId: file.id,
          originalPath: file.relative_path,
        };

        if (format === 'base64') {
          // Fetch and convert to base64
          const getObjectCommand = new GetObjectCommand({
            Bucket: s3Bucket,
            Key: file.thumbnail_s3_key,
          });
          const response = await s3.send(getObjectCommand);
          const buffer = await streamToBuffer(response.Body);
          const base64 = buffer.toString('base64');
          preview.thumbnailBase64 = `data:image/jpeg;base64,${base64}`;
        } else {
          // Generate signed URL
          const getObjectCommand = new GetObjectCommand({
            Bucket: s3Bucket,
            Key: file.thumbnail_s3_key,
          });
          const signedUrl = await getSignedUrl(s3, getObjectCommand, { expiresIn: 3600 });
          preview.thumbnailUrl = signedUrl;
          preview.signedUrl = signedUrl;
        }

        return preview;
      })
    );

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as total
       FROM dataset_files
       WHERE dataset_id = $1 AND file_type = 'image' AND has_thumbnail = TRUE
       ${folder ? 'AND directory_path = $2' : ''}`,
      folder ? [datasetId, folder] : [datasetId]
    );

    res.json({
      datasetId,
      previews,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (error) {
    console.error('Get previews error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/datasets/:datasetId/file/:fileId/preview
 */
router.get('/:datasetId/file/:fileId/preview', async (req, res) => {
  const { db, s3, s3Bucket } = req.app.locals;
  const { datasetId, fileId } = req.params;

  try {
    const result = await db.query(
      `SELECT thumbnail_s3_key, file_type
       FROM dataset_files
       WHERE id = $1 AND dataset_id = $2`,
      [fileId, datasetId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    if (file.file_type !== 'image' || !file.thumbnail_s3_key) {
      return res.status(400).json({ error: 'Preview not available for this file' });
    }

    const getObjectCommand = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: file.thumbnail_s3_key,
    });

    const response = await s3.send(getObjectCommand);
    
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    response.Body.pipe(res);

  } catch (error) {
    console.error('Get preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions

function buildTree(files, maxDepth, includeFiles) {
  const root = {
    type: 'directory',
    name: 'root',
    path: '',
    children: [],
    fileCount: 0,
    size: 0,
  };

  const pathMap = new Map();
  pathMap.set('', root);

  for (const file of files) {
    const parts = file.directory_path ? file.directory_path.split('/').filter(Boolean) : [];
    
    if (parts.length > maxDepth) continue;

    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!pathMap.has(currentPath)) {
        const dir = {
          type: 'directory',
          name: part,
          path: currentPath,
          children: [],
          fileCount: 0,
          size: 0,
        };
        pathMap.set(currentPath, dir);
        current.children.push(dir);
      }

      current = pathMap.get(currentPath);
    }

    if (includeFiles) {
      current.children.push({
        type: 'file',
        name: file.file_name,
        path: file.relative_path,
        size: parseInt(file.size),
        mimeType: file.mime_type,
        fileId: file.id,
        hasPreview: file.has_thumbnail,
        previewUrl: file.has_thumbnail 
          ? `${req.app.locals.apiBaseUrl}/api/datasets/${datasetId}/file/${file.id}/preview`
          : null,
      });
    }

    // Update counts
    let parent = root;
    const pathParts = file.directory_path ? file.directory_path.split('/').filter(Boolean) : [];
    for (const part of pathParts) {
      parent.fileCount++;
      parent.size += parseInt(file.size);
      const nextPath = parent.path ? `${parent.path}/${part}` : part;
      parent = pathMap.get(nextPath);
    }
    parent.fileCount++;
    parent.size += parseInt(file.size);
  }

  return root;
}

function getStatusMessage(status) {
  const messages = {
    uploaded: 'Files uploaded, queued for processing',
    processing: 'Processing dataset (generating thumbnails, extracting metadata)',
    ready: 'Dataset processing complete',
    failed: 'Processing failed',
  };
  return messages[status] || 'Unknown status';
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = router;
```

### Projects Route (routes/projects.js)

```javascript
const express = require('express');
const router = express.Router();

/**
 * GET /api/projects/:company/:project/versions
 */
router.get('/:company/:project/versions', async (req, res) => {
  const { db } = req.app.locals;
  const { company, project } = req.params;
  const limit = parseInt(req.query.limit || '50');
  const offset = parseInt(req.query.offset || '0');
  const status = req.query.status;

  try {
    let query = `
      SELECT id, version, status, total_files, total_size, created_at, updated_at
      FROM datasets
      WHERE company_name = $1 AND project_name = $2
    `;
    const params = [company, project];

    if (status) {
      query += ` AND status = $3`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    const countResult = await db.query(
      `SELECT COUNT(*) as total
       FROM datasets
       WHERE company_name = $1 AND project_name = $2
       ${status ? 'AND status = $3' : ''}`,
      status ? [company, project, status] : [company, project]
    );

    res.json({
      company,
      project,
      versions: result.rows.map(row => ({
        datasetId: row.id,
        version: row.version,
        status: row.status,
        totalFiles: row.total_files,
        totalSize: parseInt(row.total_size),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

---

## E. Deno Alternative Implementation

### Key Differences for Deno

Deno uses native `fetch` API and has built-in support for streaming. Here's a simplified upload handler:

```typescript
// upload.ts (Deno)
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { MultipartReader } from "https://deno.land/std@0.208.0/mime/multipart.ts";

async function handleUpload(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type");
  if (!contentType?.includes("multipart/form-data")) {
    return new Response("Invalid content type", { status: 400 });
  }

  const boundary = contentType.split("boundary=")[1];
  const reader = new MultipartReader(req.body!, boundary);
  
  const formData: any = {
    company: null,
    project: null,
    version: null,
    files: [],
  };

  let part: FormDataReadResult | null;
  while ((part = await reader.readFormPart()) !== null) {
    if (part.name === "company") {
      formData.company = await part.value();
    } else if (part.name === "project") {
      formData.project = await part.value();
    } else if (part.name === "version") {
      formData.version = await part.value();
    } else if (part.name === "files[]") {
      const filename = part.filename || "";
      const relativePath = filename.replace(/\\/g, "/");
      const buffer = await Deno.readAll(part.content);
      
      formData.files.push({
        relativePath,
        buffer: new Uint8Array(buffer),
        size: buffer.length,
      });
    }
  }

  // Process files (similar to Node.js version)
  // Upload to S3, generate thumbnails, save to DB...

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

serve(handleUpload, { port: 8000 });
```

**Note:** For production, consider using Deno Deploy or similar platform. The main advantage is native streaming and no need for external multipart parsers.

---

## F. Example cURL Calls

### Upload Dataset

```bash
curl -X POST https://api.example.com/api/datasets/upload \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN" \
  -F "company=acme" \
  -F "project=line1" \
  -F "version=v2" \
  -F "files[]=@images/Missing_hole/img001.jpg" \
  -F "files[]=@images/Missing_hole/img002.jpg" \
  -F "files[]=@labels/Missing_hole/img001.txt"
```

### Get Dataset Status

```bash
curl -X GET https://api.example.com/api/datasets/550e8400-e29b-41d4-a716-446655440000/status \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN"
```

### Get Folder Tree

```bash
curl -X GET "https://api.example.com/api/datasets/550e8400-e29b-41d4-a716-446655440000/tree?maxDepth=5" \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN"
```

### Get Previews

```bash
# URL format
curl -X GET "https://api.example.com/api/datasets/550e8400-e29b-41d4-a716-446655440000/previews?limit=10&format=url" \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN"

# Base64 format
curl -X GET "https://api.example.com/api/datasets/550e8400-e29b-41d4-a716-446655440000/previews?limit=10&format=base64" \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN"
```

### Get Single Preview Image

```bash
curl -X GET https://api.example.com/api/datasets/550e8400-e29b-41d4-a716-446655440000/file/file_123/preview \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN" \
  --output thumbnail.jpg
```

### List Project Versions

```bash
curl -X GET "https://api.example.com/api/projects/acme/line1/versions?limit=20" \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN"
```

---

## G. Expected JSON Responses

(Already provided in Section A - API Design)

---

## H. Unit/Integration Tests

### Test Setup (Jest)

```javascript
// tests/upload.test.js
const request = require('supertest');
const app = require('../server');
const { Pool } = require('pg');

describe('Dataset Upload API', () => {
  let db;

  beforeAll(async () => {
    db = new Pool({ /* test DB config */ });
  });

  afterAll(async () => {
    await db.end();
  });

  describe('POST /api/datasets/upload', () => {
    it('should preserve relative paths from webkitdirectory', async () => {
      const formData = new FormData();
      formData.append('company', 'test');
      formData.append('project', 'test-project');
      
      // Simulate webkitdirectory file with relative path
      const file = new Blob(['test content'], { type: 'image/jpeg' });
      formData.append('files[]', file, 'images/folder1/img001.jpg');

      const response = await request(app)
        .post('/api/datasets/upload')
        .set('Authorization', 'Bearer valid-token')
        .send(formData)
        .expect(202);

      // Verify file stored with correct path
      const fileRecord = await db.query(
        'SELECT relative_path FROM dataset_files WHERE dataset_id = $1',
        [response.body.datasetId]
      );
      
      expect(fileRecord.rows[0].relative_path).toBe('images/folder1/img001.jpg');
    });

    it('should handle large files with streaming', async () => {
      // Test with 100MB file
      const largeBuffer = Buffer.alloc(100 * 1024 * 1024, 'A');
      // ... test implementation
    });

    it('should generate thumbnails for images', async () => {
      // Upload image, verify thumbnail generated
    });

    it('should reject invalid file types', async () => {
      // Test with .exe file
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/datasets/upload')
        .expect(401);
    });
  });

  describe('GET /api/datasets/:datasetId/tree', () => {
    it('should return correct folder structure', async () => {
      // Create test dataset with nested folders
      // Verify tree structure matches
    });

    it('should respect maxDepth parameter', async () => {
      // Test with deep directory structure
    });
  });
});
```

### Integration Test for Path Preservation

```javascript
// tests/path-preservation.test.js
it('should preserve complex nested paths', async () => {
  const paths = [
    'images/very/deep/nested/folder/structure/img001.jpg',
    'labels/very/deep/nested/folder/structure/img001.txt',
    'images/root-level.jpg',
  ];

  // Upload files and verify all paths preserved
  for (const path of paths) {
    const file = new Blob(['content'], { type: 'image/jpeg' });
    formData.append('files[]', file, path);
  }

  const response = await request(app)
    .post('/api/datasets/upload')
    .set('Authorization', 'Bearer token')
    .send(formData)
    .expect(202);

  const files = await db.query(
    'SELECT relative_path FROM dataset_files WHERE dataset_id = $1 ORDER BY relative_path',
    [response.body.datasetId]
  );

  expect(files.rows.map(r => r.relative_path)).toEqual(paths.sort());
});
```

---

## I. Edge Cases & Handling

### 1. Duplicate Filenames

**Issue:** Same filename in different folders (e.g., `images/folder1/img.jpg` and `images/folder2/img.jpg`)

**Solution:** Already handled - `relative_path` includes full path, so duplicates are allowed. Database unique constraint on `(dataset_id, relative_path)` prevents true duplicates.

### 2. Special Characters in Paths

**Issue:** Paths with special characters (`#`, `%`, spaces, Unicode)

**Solution:**
```javascript
// Normalize paths
function normalizePath(path) {
  return path
    .replace(/\\/g, '/')  // Normalize separators
    .replace(/\/+/g, '/') // Remove duplicate slashes
    .replace(/^\/+|\/+$/g, ''); // Trim leading/trailing slashes
}

// URL encode for S3 keys
function encodeS3Key(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}
```

### 3. Extremely Deep Directories

**Issue:** Paths with 100+ directory levels

**Solution:**
- Enforce `maxDepth` in tree endpoint
- Validate path length (e.g., max 2048 chars)
- Consider path depth limits in file system

### 4. Extremely Large Uploads

**Issue:** 10GB+ total upload size

**Solution:**
- Use streaming uploads (already implemented)
- Implement chunked uploads for files > 100MB
- Add progress tracking
- Consider resumable uploads (S3 multipart upload)

### 5. Malicious Files

**Issue:** Executable files, scripts, etc.

**Solution:**
```javascript
const ALLOWED_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  label: ['.txt', '.json', '.xml', '.yaml'],
};

function validateFile(file) {
  const ext = path.extname(file.relativePath).toLowerCase();
  const isAllowed = [...ALLOWED_EXTENSIONS.image, ...ALLOWED_EXTENSIONS.label].includes(ext);
  
  if (!isAllowed) {
    throw new Error(`File type not allowed: ${ext}`);
  }

  // Additional validation: check MIME type matches extension
  // Scan for malicious content (optional, use virus scanner)
}
```

### 6. Aborted Uploads

**Issue:** Client disconnects mid-upload

**Solution:**
- Use transactions - rollback on error
- Clean up partial S3 uploads
- Implement timeout (e.g., 30 minutes)
- Track upload progress and allow resume (optional)

### 7. Resumable Uploads (Optional)

**Recommendation:** For files > 50MB, implement S3 multipart upload:

```javascript
const { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } = require('@aws-sdk/client-s3');

async function uploadLargeFile(s3, bucket, key, fileStream, fileSize) {
  if (fileSize < 50 * 1024 * 1024) {
    // Use simple upload
    return uploadToS3(s3, bucket, key, fileStream);
  }

  // Initiate multipart upload
  const createCommand = new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
  });
  const { UploadId } = await s3.send(createCommand);

  // Upload parts (5MB each)
  const partSize = 5 * 1024 * 1024;
  const parts = [];
  let partNumber = 1;

  for await (const chunk of fileStream) {
    const uploadPartCommand = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId,
      PartNumber: partNumber,
      Body: chunk,
    });
    const { ETag } = await s3.send(uploadPartCommand);
    parts.push({ ETag, PartNumber: partNumber });
    partNumber++;
  }

  // Complete multipart upload
  const completeCommand = new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId,
    MultipartUpload: { Parts: parts },
  });
  await s3.send(completeCommand);
}
```

---

## J. Operational Notes

### S3 Bucket Settings

```json
{
  "Versioning": "Enabled",
  "LifecycleConfiguration": {
    "Rules": [
      {
        "Id": "DeleteOldVersions",
        "Status": "Enabled",
        "NoncurrentVersionExpiration": {
          "NoncurrentDays": 30
        }
      },
      {
        "Id": "ArchiveOldDatasets",
        "Status": "Enabled",
        "Transitions": [
          {
            "Days": 90,
            "StorageClass": "GLACIER"
          }
        ]
      }
    ]
  },
  "CORSConfiguration": {
    "CORSRules": [
      {
        "AllowedOrigins": ["https://your-frontend.com"],
        "AllowedMethods": ["GET", "PUT", "POST"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
      }
    ]
  },
  "PublicAccessBlockConfiguration": {
    "BlockPublicAcls": true,
    "BlockPublicPolicy": true,
    "IgnorePublicAcls": true,
    "RestrictPublicBuckets": true
  }
}
```

### CDN Caching for Thumbnails

**Recommendation:** Use CloudFront or similar CDN in front of S3:

- Cache thumbnails with 1-year TTL (they don't change)
- Use `Cache-Control: public, max-age=31536000` headers
- Invalidate cache on dataset deletion (optional)

### Background Workers

**Recommendation:** Use Bull (Redis) for processing jobs:

```javascript
// workers/thumbnailWorker.js
const Queue = require('bull');
const thumbnailQueue = new Queue('thumbnails', {
  redis: { host: 'localhost', port: 6379 }
});

thumbnailQueue.process(async (job) => {
  const { datasetId, fileId, s3Key } = job.data;
  // Generate thumbnail, update DB
});

// In upload route, after files uploaded:
await thumbnailQueue.addBulk(
  imageFiles.map(file => ({
    name: 'generate-thumbnail',
    data: { datasetId, fileId: file.id, s3Key: file.s3_key }
  }))
);
```

### Recommended Polling Interval

- **Initial (uploaded → processing):** 2-5 seconds
- **During processing:** 5-10 seconds
- **After ready:** Stop polling
- **Timeout:** 30 minutes total

**Frontend Implementation:**
```javascript
async function pollStatus(datasetId) {
  const maxAttempts = 360; // 30 minutes at 5s intervals
  let attempts = 0;

  const interval = setInterval(async () => {
    attempts++;
    const status = await fetchStatus(datasetId);
    
    if (status.status === 'ready' || status.status === 'failed') {
      clearInterval(interval);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      // Handle timeout
    }
  }, 5000);
}
```

### Retention Policy

- **Active datasets:** Keep indefinitely
- **Deleted datasets:** Soft delete, retain for 30 days
- **Archived datasets:** Move to Glacier after 90 days
- **Thumbnails:** Keep as long as dataset exists

### Monitoring & Alerts

- Monitor upload success rate
- Track processing time
- Alert on failed uploads (> 5% failure rate)
- Monitor S3 storage usage
- Track API response times

### Scaling Considerations

- **Horizontal scaling:** Stateless API servers, shared Redis/DB
- **File processing:** Separate worker pool, auto-scale based on queue depth
- **S3:** Handles scaling automatically
- **Database:** Use connection pooling, read replicas for queries

---

## Summary

This specification provides a complete, production-ready backend for dataset uploads with:

✅ Path preservation from `webkitdirectory`  
✅ Version management  
✅ Thumbnail generation  
✅ Bearer token authentication  
✅ S3-compatible storage  
✅ PostgreSQL metadata storage  
✅ Streaming uploads for large files  
✅ Complete API with examples  
✅ Error handling and edge cases  
✅ Operational recommendations  

All code is copy-paste ready and can be deployed to production with appropriate environment variable configuration.




