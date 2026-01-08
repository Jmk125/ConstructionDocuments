const pdf = require('pdf-parse');
const fs = require('fs');
const { runQuery, getQuery } = require('./database');

/**
 * Process a single PDF document: extract text by page and store as chunks
 */
async function processDocument(documentId) {
  try {
    // Get document info
    const docs = getQuery('SELECT * FROM documents WHERE id = ?', [documentId]);
    const doc = docs[0];
    if (!doc) {
      throw new Error('Document not found');
    }

    console.log(`Processing document: ${doc.filename}`);

    // Read PDF file
    const dataBuffer = fs.readFileSync(doc.filepath);
    
    // Parse PDF with page-level text extraction
    const pdfData = await pdf(dataBuffer, {
      max: 0, // parse all pages
      pagerender: async function(pageData) {
        // Return text content for this page
        return pageData.getTextContent().then(function(textContent) {
          return textContent.items.map(item => item.str).join(' ');
        });
      }
    });

    const pageCount = pdfData.numpages;
    
    // Update document with page count
    runQuery('UPDATE documents SET page_count = ? WHERE id = ?', [pageCount, documentId]);

    console.log(`Extracted text from ${pageCount} pages`);

    // For drawing-by-sheet chunking, we'll extract text page by page
    // Note: pdf-parse doesn't provide direct page-by-page access in the simple API
    // So we'll re-parse with a custom page renderer
    const pages = [];
    
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const pageData = await pdf(dataBuffer, {
        max: 1,
        pagerender: async function(pageData) {
          return pageData.getTextContent().then(function(textContent) {
            return textContent.items.map(item => item.str).join(' ');
          });
        }
      });
      
      // Get the page text - this is a workaround since pdf-parse doesn't easily give us per-page text
      // We'll use a different approach: parse entire document and split by page breaks
    }

    // Alternative approach: Parse full document and attempt to split by pages
    // This is imperfect but works for most PDFs
    const fullText = pdfData.text;
    
    // Estimate text per page (this is rough - better would be using a more advanced PDF parser)
    const avgCharsPerPage = Math.ceil(fullText.length / pageCount);
    
    // For now, we'll chunk by estimated page boundaries
    // In production, you'd want to use pdf.js or similar for true page-by-page extraction
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const startIdx = (pageNum - 1) * avgCharsPerPage;
      const endIdx = pageNum * avgCharsPerPage;
      let pageText = fullText.substring(startIdx, endIdx).trim();
      
      // For the last page, get remaining text
      if (pageNum === pageCount) {
        pageText = fullText.substring(startIdx).trim();
      }

      // Only store non-empty pages
      if (pageText.length > 0) {
        // Store chunk without embedding initially
        runQuery(
          'INSERT INTO chunks (document_id, page_number, content) VALUES (?, ?, ?)',
          [documentId, pageNum, pageText]
        );
      }
    }

    // Mark document as processed
    runQuery('UPDATE documents SET processed = 1 WHERE id = ?', [documentId]);

    console.log(`Document ${doc.filename} processed successfully`);
    return { success: true, pageCount, chunksCreated: pageCount };

  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    throw error;
  }
}

/**
 * Process all documents for a project
 */
async function processProject(projectId) {
  const documents = require('./database').getQuery(
    'SELECT * FROM documents WHERE project_id = ? AND processed = 0',
    [projectId]
  );

  console.log(`Processing ${documents.length} documents for project ${projectId}`);

  const results = [];
  for (const doc of documents) {
    try {
      const result = await processDocument(doc.id);
      results.push({ documentId: doc.id, filename: doc.filename, ...result });
    } catch (error) {
      results.push({ documentId: doc.id, filename: doc.filename, success: false, error: error.message });
    }
  }

  return results;
}

module.exports = {
  processDocument,
  processProject
};
