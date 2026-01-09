const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { runQuery, getQuery, getOneQuery } = require('../database');
const { processProject } = require('../documentProcessor');
const { generateEmbeddings, generateVisualFindingsEmbeddings } = require('../embeddings');
const { analyzeProjectVision } = require('../services/vision');
const { processProjectOCR } = require('../services/ocr');

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

// Process documents for a project with SSE progress updates
router.get('/:projectId/process-stream', async (req, res) => {
  const projectId = req.params.projectId;

  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    console.log(`\n========================================`);
    console.log(`Starting document processing for project ${projectId}...`);
    console.log(`========================================\n`);

    // Get unprocessed documents
    const docs = getQuery('SELECT * FROM documents WHERE project_id = ? AND processed = 0', [projectId]);
    const totalDocs = docs.length;

    sendProgress({ stage: 'starting', message: `Processing ${totalDocs} document(s)...`, progress: 0 });

    // Process documents (extract text, create chunks)
    sendProgress({ stage: 'extracting', message: 'Extracting text from PDFs...', progress: 10 });
    const processResults = await processProject(projectId);
    console.log(`\nDocument processing results:`, JSON.stringify(processResults, null, 2));

    sendProgress({ stage: 'extracted', message: 'Text extraction complete', progress: 50 });

    // Generate embeddings
    console.log('\n========================================');
    console.log('Generating embeddings...');
    console.log('========================================\n');
    sendProgress({ stage: 'embedding', message: 'Generating embeddings...', progress: 60 });

    const embeddingResults = await generateEmbeddings(projectId, (current, total) => {
      const embeddingProgress = 60 + (current / total) * 35;
      sendProgress({
        stage: 'embedding',
        message: `Generating embeddings... (${current}/${total} chunks)`,
        progress: Math.round(embeddingProgress)
      });
    });
    console.log(`\nEmbedding results:`, JSON.stringify(embeddingResults, null, 2));

    console.log(`\n========================================`);
    console.log(`Processing complete for project ${projectId}`);
    console.log(`========================================\n`);

    sendProgress({
      stage: 'complete',
      message: 'Processing complete!',
      progress: 100,
      results: { processResults, embeddingResults }
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('\n========================================');
    console.error('ERROR processing documents:', error);
    console.error('========================================\n');
    sendProgress({ stage: 'error', message: error.message, progress: 0 });
    res.end();
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

// Analyze drawings with vision models for a project
router.post('/:projectId/vision', async (req, res) => {
  if (process.env.VISION_ANALYSIS_ENABLED !== 'true') {
    return res.status(400).json({
      error: 'Vision analysis is disabled. Set VISION_ANALYSIS_ENABLED=true to enable.'
    });
  }

  try {
    const projectId = req.params.projectId;
    const limit = Number.parseInt(req.body.limit, 10) || 25;
    const results = await analyzeProjectVision(projectId, { limit });
    res.json({ message: 'Vision analysis complete', results });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Process OCR for drawing images in a project
router.post('/:projectId/ocr', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const limit = Number.parseInt(req.body.limit, 10) || 25;

    console.log(`\n========================================`);
    console.log(`Starting OCR processing for project ${projectId}...`);
    console.log(`========================================\n`);

    const results = await processProjectOCR(projectId, { limit });

    console.log(`\n========================================`);
    console.log(`OCR processing complete for project ${projectId}`);
    console.log(`========================================\n`);

    res.json({
      message: 'OCR processing complete',
      ...results
    });
  } catch (error) {
    console.error('\n========================================');
    console.error('ERROR processing OCR:', error);
    console.error('========================================\n');
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Generate embeddings for visual findings
router.post('/:projectId/embed-visual-findings', async (req, res) => {
  try {
    const projectId = req.params.projectId;

    console.log(`\n========================================`);
    console.log(`Generating embeddings for visual findings (project ${projectId})...`);
    console.log(`========================================\n`);

    const results = await generateVisualFindingsEmbeddings(projectId);

    console.log(`\n========================================`);
    console.log(`Visual findings embeddings complete`);
    console.log(`========================================\n`);

    res.json({
      message: 'Visual findings embeddings generated',
      ...results
    });
  } catch (error) {
    console.error('\n========================================');
    console.error('ERROR generating visual findings embeddings:', error);
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
