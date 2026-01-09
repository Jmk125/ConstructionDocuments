const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { getQuery, runQuery } = require('../database');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function buildVisionPrompt(context) {
  return [
    'You are analyzing construction drawing images.',
    'Identify architectural or construction elements visible in the drawing.',
    'Summarize any curved/soffit/ceiling features, key geometry, and notable constructability concerns.',
    'Return a JSON object with this shape:',
    '{ "summary": string, "elements": [{ "type": string, "shape": string, "location": string, "notes": string }] }.',
    'If nothing relevant is visible, return { "summary": "No notable visual findings.", "elements": [] }.',
    context ? `Context: ${context}` : ''
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
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
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
    max_tokens: 800
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

function saveVisualFinding(documentId, pageNumber, sheetNumber, findings) {
  runQuery(
    `INSERT INTO visual_findings (document_id, page_number, sheet_number, findings)
     VALUES (?, ?, ?, ?)`,
    [documentId, pageNumber, sheetNumber, JSON.stringify(findings)]
  );
}

async function analyzeProjectVision(projectId, { limit = 25 } = {}) {
  const chunks = getQuery(
    `
    SELECT c.id, c.document_id, c.page_number, c.sheet_number, c.image_path, d.filename
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ?
      AND c.image_path IS NOT NULL
      AND c.image_path != ''
    ORDER BY c.document_id ASC, c.page_number ASC
    LIMIT ?
    `,
    [projectId, limit]
  );

  const results = [];
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

    const context = chunk.sheet_number
      ? `Sheet ${chunk.sheet_number} (${chunk.filename})`
      : `Page ${chunk.page_number} (${chunk.filename})`;

    const raw = await analyzeImage(chunk.image_path, context);
    const findings = parseVisionResponse(raw);
    saveVisualFinding(chunk.document_id, chunk.page_number, chunk.sheet_number, findings);
    results.push({ ...chunk, analyzed: true });
  }

  return results;
}

module.exports = {
  analyzeProjectVision
};
