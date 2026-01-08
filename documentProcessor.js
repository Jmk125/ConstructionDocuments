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

    // Array to collect text from each page
    const pageTexts = [];

    // Parse PDF with page-level text extraction
    const pdfData = await pdf(dataBuffer, {
      max: 0, // parse all pages
      pagerender: async function(pageData) {
        // Extract text content for this page
        const textContent = await pageData.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        pageTexts.push(pageText);
        return pageText;
      }
    });

    const pageCount = pdfData.numpages;

    // Update document with page count
    runQuery('UPDATE documents SET page_count = ? WHERE id = ?', [pageCount, documentId]);

    console.log(`Extracted text from ${pageCount} pages`);

    // Store each page as a chunk
    for (let pageNum = 0; pageNum < pageTexts.length; pageNum++) {
      const pageText = pageTexts[pageNum].trim();

      // Only store non-empty pages
      if (pageText.length > 0) {
        // Store chunk without embedding initially
        runQuery(
          'INSERT INTO chunks (document_id, page_number, content) VALUES (?, ?, ?)',
          [documentId, pageNum + 1, pageText]
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
