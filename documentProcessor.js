const pdfParse = require('pdf-parse');
const fs = require('fs');
const { runQuery, getQuery } = require('./database');

/**
 * Extract sheet number from page text
 * Common patterns in construction drawings:
 * - "SHEET: A-101", "SHEET NO: S-3.1", "DRAWING NO: E-201"
 * - "Sheet A-101", "DWG. NO. M-301"
 * - Just "A-101" or similar format
 */
function extractSheetNumber(pageText) {
  // Common sheet number patterns (ordered by specificity)
  const patterns = [
    // Explicit sheet/drawing labels
    /(?:SHEET|DRAWING|DWG\.?)\s*(?:NO\.?|NUMBER|#)?\s*:?\s*([A-Z]{1,3}[-\s]?\d+(?:\.\d+)?)/i,
    // Sheet number at start of line or with specific formatting
    /^([A-Z]{1,3}[-\s]?\d+(?:\.\d+)?)\s*$/m,
    // Sheet number with common prefixes (A-, S-, E-, M-, P-, etc.)
    /\b([A-Z]{1,3}[-]\d+(?:\.\d+)?)\b/,
  ];

  for (const pattern of patterns) {
    const match = pageText.match(pattern);
    if (match && match[1]) {
      // Normalize: remove extra spaces, ensure hyphen format
      const sheetNum = match[1].replace(/\s+/g, '').replace(/([A-Z]+)(\d)/, '$1-$2');

      // Validate it looks like a real sheet number (1-3 letters, hyphen, numbers)
      if (/^[A-Z]{1,3}-\d+(\.\d+)?$/.test(sheetNum)) {
        return sheetNum;
      }
    }
  }

  return null;
}

/**
 * Extract detail references from page text
 * Common patterns: "3/A-101", "DETAIL 5/S-201", "SEE DETAIL 2/A-301"
 */
function extractDetailReferences(pageText) {
  const detailPattern = /(?:DETAIL|DTL\.?|SEE)\s*(\d+)\s*\/\s*([A-Z]{1,3}[-]?\d+(?:\.\d+)?)/gi;
  const simplePattern = /\b(\d+)\s*\/\s*([A-Z]{1,3}[-]\d+(?:\.\d+)?)\b/g;

  const details = new Set();
  let match;

  // Try explicit detail references first
  while ((match = detailPattern.exec(pageText)) !== null) {
    const detailNum = match[1];
    const sheetNum = match[2].replace(/\s+/g, '').replace(/([A-Z]+)(\d)/, '$1-$2');
    details.add(`${detailNum}/${sheetNum}`);
  }

  // Try simple format (number/sheet) - but be more conservative
  const lines = pageText.split('\n');
  for (const line of lines) {
    if (line.length < 100) { // Only check short lines to avoid false positives
      let simpleMatch;
      while ((simpleMatch = simplePattern.exec(line)) !== null) {
        const detailNum = simpleMatch[1];
        const sheetNum = simpleMatch[2].replace(/\s+/g, '').replace(/([A-Z]+)(\d)/, '$1-$2');
        // Only add if it looks like a valid detail reference
        if (parseInt(detailNum) <= 50) { // Reasonable detail number
          details.add(`${detailNum}/${sheetNum}`);
        }
      }
    }
  }

  return Array.from(details);
}

function parseDetailReference(detailReference) {
  const match = detailReference.match(/^(\d+)\s*\/\s*([A-Z]{1,3}-\d+(?:\.\d+)?)$/i);
  if (!match) {
    return null;
  }

  return {
    detailNumber: match[1],
    targetSheet: match[2].toUpperCase()
  };
}

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
    const pdfData = await pdfParse(dataBuffer, {
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
        // Extract sheet number and detail references
        const sheetNumber = extractSheetNumber(pageText);
        const detailRefs = extractDetailReferences(pageText);
        const detailReference = detailRefs.length > 0 ? JSON.stringify(detailRefs) : null;

        if (sheetNumber) {
          console.log(`  Page ${pageNum + 1}: Found sheet number ${sheetNumber}`);
        }
        if (detailRefs.length > 0) {
          console.log(`  Page ${pageNum + 1}: Found ${detailRefs.length} detail references`);
        }

        // Truncate very large chunks to prevent token limit issues
        // OpenAI embedding model has 8192 token limit total per batch
        // We'll limit each chunk to ~6000 chars (roughly 1500 tokens) to be safe
        const MAX_CHUNK_LENGTH = 6000;
        const truncatedText = pageText.length > MAX_CHUNK_LENGTH
          ? pageText.substring(0, MAX_CHUNK_LENGTH) + '... [truncated]'
          : pageText;

        // Store chunk without embedding initially
        runQuery(
          'INSERT INTO chunks (document_id, page_number, sheet_number, detail_reference, ocr_text, image_path, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [documentId, pageNum + 1, sheetNumber, detailReference, null, null, truncatedText]
        );

        if (detailRefs.length > 0) {
          for (const detailRef of detailRefs) {
            const parsed = parseDetailReference(detailRef);
            runQuery(
              `INSERT INTO callouts (document_id, page_number, sheet_number, detail_reference, detail_number, target_sheet)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                documentId,
                pageNum + 1,
                sheetNumber,
                detailRef,
                parsed ? parsed.detailNumber : null,
                parsed ? parsed.targetSheet : null
              ]
            );
          }
        }
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
