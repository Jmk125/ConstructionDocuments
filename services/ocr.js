const { createWorker } = require('tesseract.js');
const fs = require('fs');
const { getQuery, runQuery } = require('../database');

/**
 * Extract text from an image using Tesseract OCR
 */
async function extractTextFromImage(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  const worker = await createWorker('eng');

  try {
    // Configure Tesseract for construction documents
    // PSM 3 = Fully automatic page segmentation (good for mixed text/graphics)
    await worker.setParameters({
      tessedit_pageseg_mode: '3',
      preserve_interword_spaces: '1',
    });

    const { data: { text, confidence } } = await worker.recognize(imagePath);

    await worker.terminate();

    return {
      text: text.trim(),
      confidence: confidence
    };
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}

/**
 * Process OCR for all chunks with images in a project
 */
async function processProjectOCR(projectId, { limit = 25 } = {}) {
  const chunks = getQuery(
    `
    SELECT c.id, c.document_id, c.page_number, c.sheet_number, c.image_path, d.filename
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ?
      AND c.image_path IS NOT NULL
      AND c.image_path != ''
      AND (c.ocr_text IS NULL OR c.ocr_text = '')
    ORDER BY c.document_id ASC, c.page_number ASC
    LIMIT ?
    `,
    [projectId, limit]
  );

  if (chunks.length === 0) {
    console.log('No chunks need OCR processing');
    return { chunksProcessed: 0, results: [] };
  }

  console.log(`Processing OCR for ${chunks.length} chunks...`);

  const results = [];
  let processed = 0;

  for (const chunk of chunks) {
    try {
      if (!fs.existsSync(chunk.image_path)) {
        results.push({
          ...chunk,
          success: false,
          error: 'image_not_found'
        });
        continue;
      }

      console.log(`Processing OCR for ${chunk.filename} page ${chunk.page_number}...`);

      const { text, confidence } = await extractTextFromImage(chunk.image_path);

      // Only save if we got meaningful text (> 10 characters and reasonable confidence)
      if (text.length > 10 && confidence > 30) {
        runQuery(
          'UPDATE chunks SET ocr_text = ? WHERE id = ?',
          [text, chunk.id]
        );

        results.push({
          ...chunk,
          success: true,
          textLength: text.length,
          confidence: confidence.toFixed(2)
        });

        processed++;
        console.log(`  ✓ Extracted ${text.length} characters (confidence: ${confidence.toFixed(2)}%)`);
      } else {
        results.push({
          ...chunk,
          success: false,
          error: 'low_confidence_or_no_text',
          confidence: confidence.toFixed(2)
        });
        console.log(`  ⚠ Low confidence or minimal text (${text.length} chars, confidence: ${confidence.toFixed(2)}%)`);
      }

      // Small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`Error processing OCR for chunk ${chunk.id}:`, error.message);
      results.push({
        ...chunk,
        success: false,
        error: error.message
      });
    }
  }

  console.log(`OCR processing complete: ${processed}/${chunks.length} chunks processed successfully`);

  return {
    chunksProcessed: processed,
    totalAttempted: chunks.length,
    results
  };
}

/**
 * Extract text from a single image (standalone function)
 */
async function ocrSingleImage(imagePath) {
  return extractTextFromImage(imagePath);
}

module.exports = {
  extractTextFromImage,
  processProjectOCR,
  ocrSingleImage
};
