const pdf = require('pdf-parse');
const fs = require('fs').promises;
const { createEmbedding } = require('./openai');
const { run, query } = require('../db/database');

// Extract text from PDF
async function extractTextFromPDF(filepath) {
  try {
    const dataBuffer = await fs.readFile(filepath);
    const data = await pdf(dataBuffer);
    return {
      text: data.text,
      numPages: data.numpages
    };
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw error;
  }
}

// Split text into pages (basic approach)
function splitIntoPages(text, numPages) {
  // This is a simplified approach - in reality PDFs don't always have clear page breaks in text
  // We'll estimate by splitting text into roughly equal chunks
  const lines = text.split('\n');
  const linesPerPage = Math.ceil(lines.length / numPages);
  const pages = [];
  
  for (let i = 0; i < numPages; i++) {
    const start = i * linesPerPage;
    const end = Math.min((i + 1) * linesPerPage, lines.length);
    const pageText = lines.slice(start, end).join('\n').trim();
    if (pageText) {
      pages.push({
        pageNumber: i + 1,
        text: pageText
      });
    }
  }
  
  return pages;
}

// Process a single document
async function processDocument(documentId) {
  try {
    console.log(`Starting processing for document ${documentId}`);
    
    // Get document info
    const docs = await query('SELECT * FROM documents WHERE id = ?', [documentId]);
    if (docs.length === 0) {
      throw new Error('Document not found');
    }
    const doc = docs[0];
    
    // Extract text from PDF
    const { text, numPages } = await extractTextFromPDF(doc.filepath);
    
    // Update page count
    await run('UPDATE documents SET page_count = ? WHERE id = ?', [numPages, documentId]);
    
    // Split into pages (chunks by sheet for drawings, by page for specs)
    const pages = splitIntoPages(text, numPages);
    
    console.log(`Extracted ${pages.length} pages from document ${doc.filename}`);
    
    // Process each page
    for (const page of pages) {
      if (page.text.length < 50) {
        // Skip pages with very little text
        continue;
      }
      
      // Create embedding
      console.log(`Creating embedding for page ${page.pageNumber}...`);
      const embedding = await createEmbedding(page.text);
      
      // Store chunk with embedding
      await run(
        `INSERT INTO chunks (document_id, content, page_number, embedding) 
         VALUES (?, ?, ?, ?)`,
        [documentId, page.text, page.pageNumber, JSON.stringify(embedding)]
      );
    }
    
    // Mark document as processed
    await run('UPDATE documents SET processed = 1 WHERE id = ?', [documentId]);
    
    console.log(`Document ${documentId} processed successfully`);
    return { success: true, pagesProcessed: pages.length };
    
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    throw error;
  }
}

// Process all documents in a project
async function processProject(projectId) {
  const documents = await query(
    'SELECT id FROM documents WHERE project_id = ? AND processed = 0',
    [projectId]
  );
  
  const results = [];
  for (const doc of documents) {
    try {
      const result = await processDocument(doc.id);
      results.push({ documentId: doc.id, ...result });
    } catch (error) {
      results.push({ 
        documentId: doc.id, 
        success: false, 
        error: error.message 
      });
    }
  }
  
  return results;
}

module.exports = {
  extractTextFromPDF,
  processDocument,
  processProject
};
