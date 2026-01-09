const OpenAI = require('openai');
const { runQuery, getQuery, getOneQuery, saveDatabase } = require('./database');

let openai = null;

function initOpenAI(apiKey) {
  openai = new OpenAI({ apiKey });
}

/**
 * Generate embeddings for all unprocessed chunks in a project
 * @param {number} projectId - The project ID
 * @param {function} onProgress - Optional callback for progress updates (current, total)
 */
async function generateEmbeddings(projectId, onProgress = null) {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  // Get all chunks for this project that don't have embeddings yet
  const chunks = getQuery(`
    SELECT c.* FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ? AND c.embedding IS NULL
  `, [projectId]);

  if (chunks.length === 0) {
    console.log('No chunks need embeddings - all chunks already processed');
    return { chunksProcessed: 0 };
  }

  console.log(`Generating embeddings for ${chunks.length} chunks...`);

  let processed = 0;
  // Conservative batch size for Tier 1 rate limits (200k TPM)
  // Each chunk ~1500 tokens, batch of 2 = 3000 tokens
  // With 2 second delay = 1800 tokens/sec = 108k TPM (well under 200k limit)
  const batchSize = 2; // Reduced to 2 for strict rate limit compliance

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(chunk => chunk.content);

    try {
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)} (${batch.length} chunks)...`);

      // Calculate approximate token count for logging
      const approxTokens = texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
      console.log(`  Estimated tokens: ${approxTokens}`);

      // Generate embeddings for batch
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts
      });

      // Store embeddings
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = response.data[j].embedding;

        runQuery(
          'UPDATE chunks SET embedding = ? WHERE id = ?',
          [JSON.stringify(embedding), chunk.id]
        );
      }

      processed += batch.length;
      console.log(`✓ Processed ${processed}/${chunks.length} chunks`);

      // Report progress if callback provided
      if (onProgress) {
        onProgress(processed, chunks.length);
      }

      // Aggressive delay to stay under Tier 1 TPM limits (200k TPM)
      // 2 second delay between batches = max 30 batches/min = 90k TPM (safe margin)
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds
      }

    } catch (error) {
      console.error('Error generating embeddings for batch:', error.message);
      console.error('Batch details:', {
        batchIndex: Math.floor(i / batchSize),
        batchSize: batch.length,
        chunkIds: batch.map(c => c.id),
        textLengths: texts.map(t => t.length)
      });

      // If rate limit error, wait and retry with exponential backoff
      if (error.status === 429) {
        console.log('⚠️  Rate limit hit. Waiting 60 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute

        // Retry this batch
        console.log('Retrying batch after rate limit wait...');
        try {
          const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: texts
          });

          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const embedding = response.data[j].embedding;
            runQuery(
              'UPDATE chunks SET embedding = ? WHERE id = ?',
              [JSON.stringify(embedding), chunk.id]
            );
          }

          processed += batch.length;
          console.log(`✓ Retry successful: ${processed}/${chunks.length} chunks`);

          if (onProgress) {
            onProgress(processed, chunks.length);
          }
        } catch (retryError) {
          console.error('Retry failed:', retryError.message);
          throw retryError; // Give up after one retry
        }

        continue; // Skip the rest of error handling
      }

      // If token limit error, try processing chunks one at a time
      if (error.status === 400 && error.message.includes('maximum context length')) {
        console.log('Token limit exceeded. Retrying with individual chunks...');

        for (let j = 0; j < batch.length; j++) {
          try {
            const chunk = batch[j];
            const text = texts[j];

            console.log(`  Processing chunk ${chunk.id} individually (${text.length} chars)...`);

            const response = await openai.embeddings.create({
              model: 'text-embedding-3-small',
              input: [text]
            });

            const embedding = response.data[0].embedding;
            runQuery(
              'UPDATE chunks SET embedding = ? WHERE id = ?',
              [JSON.stringify(embedding), chunk.id]
            );

            processed++;
            console.log(`  ✓ Chunk ${chunk.id} processed`);

            // Report progress if callback provided
            if (onProgress) {
              onProgress(processed, chunks.length);
            }

            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (innerError) {
            console.error(`  ✗ Failed to process chunk ${batch[j].id}:`, innerError.message);
            // Continue with other chunks instead of failing completely
          }
        }
      } else {
        throw error;
      }
    }
  }

  return { chunksProcessed: processed };
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search for relevant chunks based on query
 */
async function searchRelevantChunks(projectId, query, topK = 10) {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  // Generate embedding for query
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  });

  const queryEmbedding = response.data[0].embedding;

  // Get all chunks for this project with embeddings
  const chunks = getQuery(`
    SELECT c.*, d.filename, d.type
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ? AND c.embedding IS NOT NULL
  `, [projectId]);

  if (chunks.length === 0) {
    return [];
  }

  // Calculate similarity scores
  const scoredChunks = chunks.map(chunk => {
    const chunkEmbedding = JSON.parse(chunk.embedding);
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
    
    return {
      ...chunk,
      similarity
    };
  });

  // Sort by similarity and return top K
  scoredChunks.sort((a, b) => b.similarity - a.similarity);
  
  return scoredChunks.slice(0, topK);
}

/**
 * Format chunks for GPT context
 */
function formatChunksForContext(chunks) {
  return chunks.map((chunk, index) => {
    const docType = chunk.type === 'drawing' ? 'Drawing' : 'Specification';

    // Prefer sheet number for drawings, fallback to page number
    let location;
    if (chunk.sheet_number) {
      location = `Sheet ${chunk.sheet_number}`;
    } else {
      location = `Page ${chunk.page_number}`;
    }

    // Add detail references if available
    let detailInfo = '';
    if (chunk.detail_reference) {
      try {
        const details = JSON.parse(chunk.detail_reference);
        if (details.length > 0) {
          detailInfo = ` (Details: ${details.join(', ')})`;
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }

    const ocrInfo = chunk.ocr_text ? `\n[OCR Text]\n${chunk.ocr_text}` : '';

    return `[Source ${index + 1}: ${docType} - ${chunk.filename}, ${location}${detailInfo}]\n${chunk.content}${ocrInfo}`;
  }).join('\n\n---\n\n');
}

/**
 * Convert visual findings JSON to searchable text for embedding
 */
function visualFindingsToText(findings) {
  try {
    const parsed = typeof findings === 'string' ? JSON.parse(findings) : findings;

    const parts = [parsed.summary || ''];

    // Add elements descriptions
    if (parsed.elements && parsed.elements.length > 0) {
      parsed.elements.forEach(el => {
        const elementText = [
          el.type,
          el.shape,
          el.location,
          el.dimensions,
          el.materials,
          el.notes
        ].filter(Boolean).join(' ');
        parts.push(elementText);
      });
    }

    // Add annotations
    if (parsed.annotations && parsed.annotations.length > 0) {
      parts.push(parsed.annotations.join(' '));
    }

    // Add symbols
    if (parsed.symbols && parsed.symbols.length > 0) {
      parts.push(parsed.symbols.join(' '));
    }

    // Add detail markers
    if (parsed.detailMarkers && parsed.detailMarkers.length > 0) {
      parts.push(parsed.detailMarkers.join(' '));
    }

    return parts.filter(Boolean).join(' ');
  } catch (error) {
    console.error('Error parsing visual findings:', error);
    return typeof findings === 'string' ? findings : '';
  }
}

/**
 * Generate embeddings for all visual findings without embeddings
 */
async function generateVisualFindingsEmbeddings(projectId, onProgress = null) {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  // Get all visual findings for this project without embeddings
  const findings = getQuery(`
    SELECT vf.* FROM visual_findings vf
    JOIN documents d ON vf.document_id = d.id
    WHERE d.project_id = ? AND vf.embedding IS NULL
  `, [projectId]);

  if (findings.length === 0) {
    console.log('No visual findings need embeddings');
    return { findingsProcessed: 0 };
  }

  console.log(`Generating embeddings for ${findings.length} visual findings...`);

  let processed = 0;
  const batchSize = 10; // Visual findings are typically smaller than full chunks

  for (let i = 0; i < findings.length; i += batchSize) {
    const batch = findings.slice(i, i + batchSize);
    const texts = batch.map(finding => visualFindingsToText(finding.findings));

    try {
      console.log(`Processing visual findings batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(findings.length / batchSize)}...`);

      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts
      });

      // Store embeddings
      for (let j = 0; j < batch.length; j++) {
        const finding = batch[j];
        const embedding = response.data[j].embedding;

        runQuery(
          'UPDATE visual_findings SET embedding = ? WHERE id = ?',
          [JSON.stringify(embedding), finding.id]
        );
      }

      processed += batch.length;
      console.log(`✓ Processed ${processed}/${findings.length} visual findings`);

      if (onProgress) {
        onProgress(processed, findings.length);
      }

      // Aggressive delay to stay under Tier 1 TPM limits
      if (i + batchSize < findings.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds
      }

    } catch (error) {
      console.error('Error generating embeddings for visual findings batch:', error.message);
      // Continue with next batch
    }
  }

  return { findingsProcessed: processed };
}

/**
 * Search both chunks and visual findings, returning combined results
 */
async function searchRelevantContent(projectId, query, topK = 10) {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  // Generate embedding for query
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  });

  const queryEmbedding = response.data[0].embedding;

  // Get all chunks with embeddings
  const chunks = getQuery(`
    SELECT c.*, d.filename, d.type, 'chunk' as source_type
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ? AND c.embedding IS NOT NULL
  `, [projectId]);

  // Get all visual findings with embeddings
  const visualFindings = getQuery(`
    SELECT vf.*, d.filename, d.type, 'visual_finding' as source_type
    FROM visual_findings vf
    JOIN documents d ON vf.document_id = d.id
    WHERE d.project_id = ? AND vf.embedding IS NOT NULL
  `, [projectId]);

  // Combine and score all content
  const allContent = [...chunks, ...visualFindings];

  if (allContent.length === 0) {
    return [];
  }

  const scoredContent = allContent.map(item => {
    const itemEmbedding = JSON.parse(item.embedding);
    const similarity = cosineSimilarity(queryEmbedding, itemEmbedding);

    return {
      ...item,
      similarity
    };
  });

  // Sort by similarity and return top K
  scoredContent.sort((a, b) => b.similarity - a.similarity);

  return scoredContent.slice(0, topK);
}

module.exports = {
  initOpenAI,
  generateEmbeddings,
  generateVisualFindingsEmbeddings,
  searchRelevantChunks,
  searchRelevantContent,
  formatChunksForContext,
  visualFindingsToText
};
