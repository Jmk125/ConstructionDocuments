/**
 * Fix existing chunks that are too large for OpenAI embedding API
 * Run this script to truncate any existing chunks over the size limit
 */

const { getQuery, runQuery } = require('./database');

async function fixExistingChunks() {
  console.log('Checking for oversized chunks...\n');

  const MAX_CHUNK_LENGTH = 6000;

  // Get all chunks
  const chunks = getQuery('SELECT * FROM chunks');
  console.log(`Found ${chunks.length} total chunks`);

  let oversizedCount = 0;
  let truncatedCount = 0;

  for (const chunk of chunks) {
    if (chunk.content.length > MAX_CHUNK_LENGTH) {
      oversizedCount++;
      console.log(`Chunk ${chunk.id} (page ${chunk.page_number}): ${chunk.content.length} chars -> truncating to ${MAX_CHUNK_LENGTH}`);

      const truncatedContent = chunk.content.substring(0, MAX_CHUNK_LENGTH) + '... [truncated]';

      // Update the chunk with truncated content
      // Note: This will clear the embedding if it exists, requiring re-processing
      runQuery(
        'UPDATE chunks SET content = ?, embedding = NULL WHERE id = ?',
        [truncatedContent, chunk.id]
      );

      truncatedCount++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Results:`);
  console.log(`  Total chunks: ${chunks.length}`);
  console.log(`  Oversized chunks found: ${oversizedCount}`);
  console.log(`  Chunks truncated: ${truncatedCount}`);
  console.log(`========================================\n`);

  if (truncatedCount > 0) {
    console.log('✓ Oversized chunks have been truncated.');
    console.log('  Their embeddings have been cleared and will be regenerated on next processing.');
    console.log('  Run document processing again to generate embeddings for truncated chunks.');
  } else {
    console.log('✓ No oversized chunks found. All chunks are within size limits.');
  }
}

// Initialize database and run
require('./database').initDatabase().then(() => {
  fixExistingChunks().catch(error => {
    console.error('Error fixing chunks:', error);
    process.exit(1);
  });
}).catch(error => {
  console.error('Error initializing database:', error);
  process.exit(1);
});
