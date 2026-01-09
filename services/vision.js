const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { getQuery, runQuery } = require('../database');
const { visualFindingsToText } = require('../embeddings');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Construction element taxonomy for comprehensive detection
const CONSTRUCTION_ELEMENTS = {
  structural: ['beam', 'column', 'footing', 'wall', 'slab', 'foundation', 'rebar', 'post', 'truss', 'joist', 'shear_wall', 'bracing'],
  architectural: ['door', 'window', 'ceiling', 'soffit', 'trim', 'molding', 'stairs', 'railing', 'partition', 'cladding', 'roof', 'skylight'],
  mep: ['duct', 'pipe', 'conduit', 'outlet', 'fixture', 'valve', 'diffuser', 'panel', 'equipment', 'hvac_unit'],
  finishes: ['flooring', 'tile', 'paint', 'wallpaper', 'countertop', 'cabinet', 'millwork'],
  site: ['grading', 'drainage', 'paving', 'landscape', 'curb', 'sidewalk', 'parking'],
  geometry: ['curve', 'angle', 'radius', 'slope', 'elevation_change']
};

function buildVisionPrompt(context) {
  const elementList = Object.entries(CONSTRUCTION_ELEMENTS)
    .map(([category, elements]) => `  ${category.toUpperCase()}: ${elements.join(', ')}`)
    .join('\n');

  return [
    'You are analyzing construction drawing images with expertise in architecture, structural, and MEP systems.',
    '',
    'ANALYSIS OBJECTIVES:',
    '1. IDENTIFY ELEMENTS: Detect and classify all visible construction elements from the taxonomy below',
    '2. EXTRACT DIMENSIONS: Note any dimensions, measurements, callouts, or scale information',
    '3. READ ANNOTATIONS: Capture material specifications, notes, detail callouts, and labels',
    '4. INTERPRET SYMBOLS: Recognize architectural symbols, line types, hatching patterns, and legends',
    '5. SPATIAL RELATIONSHIPS: Describe how elements connect (e.g., wall-to-ceiling junction, beam-to-column)',
    '6. DETECT DETAILS: Identify detail markers, section cuts, elevation markers, grid lines',
    '',
    'CONSTRUCTION ELEMENT TAXONOMY:',
    elementList,
    '',
    'OUTPUT FORMAT:',
    'Return a JSON object with this exact structure:',
    '{',
    '  "summary": "Brief overview of the drawing content and purpose",',
    '  "elements": [',
    '    {',
    '      "type": "element type from taxonomy or specific description",',
    '      "shape": "geometric description",',
    '      "location": "position on drawing (e.g., upper-left, center, grid line A/1)",',
    '      "dimensions": "any measurements or callouts visible",',
    '      "materials": "material specifications if noted",',
    '      "notes": "additional observations, connections, or concerns"',
    '    }',
    '  ],',
    '  "annotations": ["list of text annotations, callouts, notes visible in the drawing"],',
    '  "symbols": ["architectural symbols detected (e.g., door swing, electrical outlet)"],',
    '  "detailMarkers": ["detail references found (e.g., 3/A-101, DETAIL 5)"]',
    '}',
    '',
    'If nothing relevant is visible, return { "summary": "No notable visual findings.", "elements": [], "annotations": [], "symbols": [], "detailMarkers": [] }.',
    '',
    context ? `CONTEXT: ${context}` : ''
  ].filter(Boolean).join('\n');
}

function toDataUrl(imagePath) {
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const buffer = fs.readFileSync(imagePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function analyzeImage(imagePath, context) {
  const dataUrl = toDataUrl(imagePath);
  // Use GPT-4o-mini for lower cost (set VISION_MODEL env var to override)
  const model = process.env.VISION_MODEL || 'gpt-4o-mini'; // Changed default to mini

  const response = await openai.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildVisionPrompt(context) },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    temperature: 0.2,
    max_tokens: 1500  // Increased for more detailed analysis
  });

  return response.choices[0].message.content;
}

function parseVisionResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { summary: raw, elements: [] };
  }
}

/**
 * Classify sheet type based on sheet number and content
 */
function classifySheetType(sheetNumber, pageText = '') {
  if (!sheetNumber) {
    return 'unknown';
  }

  const prefix = sheetNumber.split('-')[0].toUpperCase();
  const text = pageText.toLowerCase();

  // Prefix-based classification (most reliable)
  const prefixMap = {
    'A': 'architectural',
    'S': 'structural',
    'M': 'mechanical',
    'E': 'electrical',
    'P': 'plumbing',
    'FP': 'fire_protection',
    'L': 'landscape',
    'C': 'civil',
    'G': 'general',
    'T': 'title'
  };

  if (prefixMap[prefix]) {
    return prefixMap[prefix];
  }

  // Content-based classification as fallback
  if (text.includes('floor plan') || text.includes('plan view')) {
    return 'floor_plan';
  }
  if (text.includes('elevation')) {
    return 'elevation';
  }
  if (text.includes('section') || text.includes('sect.')) {
    return 'section';
  }
  if (text.includes('detail')) {
    return 'detail';
  }
  if (text.includes('schedule')) {
    return 'schedule';
  }

  return 'unknown';
}

async function saveVisualFinding(documentId, pageNumber, sheetNumber, sheetType, findings) {
  // Save findings first
  runQuery(
    `INSERT INTO visual_findings (document_id, page_number, sheet_number, sheet_type, findings)
     VALUES (?, ?, ?, ?, ?)`,
    [documentId, pageNumber, sheetNumber, sheetType, JSON.stringify(findings)]
  );

  // Generate and save embedding for the findings
  try {
    const findingsText = visualFindingsToText(findings);
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: findingsText
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Update the visual finding with embedding
    runQuery(
      `UPDATE visual_findings
       SET embedding = ?
       WHERE document_id = ? AND page_number = ? AND sheet_number = ?`,
      [JSON.stringify(embedding), documentId, pageNumber, sheetNumber]
    );
  } catch (error) {
    console.error('Error generating embedding for visual finding:', error.message);
    // Continue even if embedding fails - we still have the findings
  }
}

async function analyzeProjectVision(projectId, { limit = 25, skipTextHeavy = true, sheetTypes = null } = {}) {
  let query = `
    SELECT c.id, c.document_id, c.page_number, c.sheet_number, c.image_path, c.content, d.filename, d.type
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ?
      AND c.image_path IS NOT NULL
      AND c.image_path != ''
  `;

  // Only process drawings, not specs (saves costs)
  if (skipTextHeavy) {
    query += ` AND d.type = 'drawing'`;
  }

  query += ` ORDER BY c.document_id ASC, c.page_number ASC LIMIT ?`;

  const chunks = getQuery(query, [projectId, limit]);

  const results = [];
  let processed = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    const existing = getQuery(
      `SELECT id FROM visual_findings WHERE document_id = ? AND page_number = ? LIMIT 1`,
      [chunk.document_id, chunk.page_number]
    );
    if (existing.length > 0) {
      results.push({ ...chunk, skipped: true, reason: 'already_analyzed' });
      continue;
    }

    if (!fs.existsSync(chunk.image_path)) {
      results.push({ ...chunk, skipped: true, reason: 'image_not_found' });
      continue;
    }

    // Classify sheet type
    const sheetType = classifySheetType(chunk.sheet_number, chunk.content);

    const context = chunk.sheet_number
      ? `Sheet ${chunk.sheet_number} (${chunk.filename}) - Type: ${sheetType}`
      : `Page ${chunk.page_number} (${chunk.filename})`;

    const raw = await analyzeImage(chunk.image_path, context);
    const findings = parseVisionResponse(raw);
    await saveVisualFinding(chunk.document_id, chunk.page_number, chunk.sheet_number, sheetType, findings);
    processed++;
    results.push({ ...chunk, analyzed: true, sheetType });

    console.log(`Progress: ${processed}/${chunks.length} images analyzed (${skipped} skipped)`);
  }

  console.log(`\nVision analysis complete: ${processed} processed, ${skipped} skipped`);
  return { results, processed, skipped, total: chunks.length };
}

module.exports = {
  analyzeProjectVision
};
