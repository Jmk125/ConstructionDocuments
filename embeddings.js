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
  // Reduced batch size to avoid token limits
  // OpenAI embedding API has 8192 token limit per request (all inputs combined)
  // With truncated chunks (~1500 tokens max each), batches of 5 should be safe
  const batchSize = 5;

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

      // Small delay to avoid rate limiting
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error('Error generating embeddings for batch:', error.message);
      console.error('Batch details:', {
        batchIndex: Math.floor(i / batchSize),
        batchSize: batch.length,
        chunkIds: batch.map(c => c.id),
        textLengths: texts.map(t => t.length)
      });

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

module.exports = {
  initOpenAI,
  generateEmbeddings,
  searchRelevantChunks,
  formatChunksForContext
};
