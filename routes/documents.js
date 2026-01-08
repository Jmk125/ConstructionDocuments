const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { runQuery, getQuery, getOneQuery } = require('../database');
const { processProject } = require('../documentProcessor');
const { generateEmbeddings } = require('../embeddings');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const projectId = req.params.projectId;
    const type = req.body.type || 'drawing'; // 'spec' or 'drawing'
    const uploadPath = path.join(__dirname, '..', 'uploads', projectId, type === 'spec' ? 'specs' : 'drawings');
    
    // Ensure directory exists before multer tries to save
    if (!require('fs').existsSync(uploadPath)) {
      require('fs').mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Keep original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit per file
  },
  fileFilter: function (req, file, cb) {
    // Only accept PDFs
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  }
});

// Upload documents for a project
router.post('/:projectId/upload', upload.array('documents'), (req, res) => {
  try {
    const projectId = req.params.projectId;
    const type = req.body.type || 'drawing';

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Add documents to database
    const uploadedDocs = [];
    for (const file of req.files) {
      runQuery(
        'INSERT INTO documents (project_id, filename, filepath, type, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
        [projectId, file.originalname, file.path, type]
      );

      // Get the last inserted document
      const docs = getQuery('SELECT * FROM documents ORDER BY id DESC LIMIT 1');
      if (docs[0]) {
        uploadedDocs.push(docs[0]);
      }
    }

    res.json({
      message: `${uploadedDocs.length} document(s) uploaded successfully`,
      documents: uploadedDocs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process documents for a project (extract text and create chunks)
router.post('/:projectId/process', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    console.log(`\n========================================`);
    console.log(`Starting document processing for project ${projectId}...`);
    console.log(`========================================\n`);

    // Process documents (extract text, create chunks)
    const processResults = await processProject(projectId);
    console.log(`\nDocument processing results:`, JSON.stringify(processResults, null, 2));

    // Generate embeddings
    console.log('\n========================================');
    console.log('Generating embeddings...');
    console.log('========================================\n');
    const embeddingResults = await generateEmbeddings(projectId);
    console.log(`\nEmbedding results:`, JSON.stringify(embeddingResults, null, 2));

    console.log(`\n========================================`);
    console.log(`Processing complete for project ${projectId}`);
    console.log(`========================================\n`);

    res.json({
      message: 'Documents processed successfully',
      processResults,
      embeddingResults
    });
  } catch (error) {
    console.error('\n========================================');
    console.error('ERROR processing documents:', error);
    console.error('========================================\n');
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Delete a document
router.delete('/:documentId', (req, res) => {
  try {
    const docs = getQuery('SELECT * FROM documents WHERE id = ?', [req.params.documentId]);
    const doc = docs[0];
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete file
    const fs = require('fs');
    if (fs.existsSync(doc.filepath)) {
      fs.unlinkSync(doc.filepath);
    }

    // Delete from database (cascades to chunks)
    runQuery('DELETE FROM documents WHERE id = ?', [req.params.documentId]);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
