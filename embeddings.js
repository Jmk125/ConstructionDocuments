const OpenAI = require('openai');
const { runQuery, getQuery, getOneQuery, saveDatabase } = require('./database');

let openai = null;

function initOpenAI(apiKey) {
  openai = new OpenAI({ apiKey });
}

/**
 * Generate embeddings for all unprocessed chunks in a project
 */
async function generateEmbeddings(projectId) {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  // Get all chunks for this project that don't have embeddings yet
  const chunks = getQuery(`
    SELECT c.* FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ? AND c.embedding IS NULL
  `, [projectId]);

  console.log(`Generating embeddings for ${chunks.length} chunks...`);

  let processed = 0;
  const batchSize = 100; // OpenAI allows up to 2048 inputs per request

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(chunk => chunk.content);

    try {
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
      console.log(`Processed ${processed}/${chunks.length} chunks`);

    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw error;
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
    return `[Source ${index + 1}: ${docType} - ${chunk.filename}, Page ${chunk.page_number}]\n${chunk.content}`;
  }).join('\n\n---\n\n');
}

module.exports = {
  initOpenAI,
  generateEmbeddings,
  searchRelevantChunks,
  formatChunksForContext
};
