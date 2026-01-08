const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Generate embedding for text
async function createEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error creating embedding:', error);
    throw error;
  }
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Find most relevant chunks for a query
async function findRelevantChunks(queryEmbedding, chunks, topK = 15) {
  const scored = chunks.map(chunk => {
    const chunkEmbedding = JSON.parse(chunk.embedding);
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
    return { ...chunk, similarity };
  });
  
  // Sort by similarity and return top K
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

// Generate chat completion with context
async function generateChatResponse(messages, context) {
  try {
    const systemMessage = {
      role: "system",
      content: `You are an AI assistant helping with construction document analysis. You have access to construction drawings and specifications.

When answering questions:
1. Use the provided context from the documents to answer accurately
2. Always cite your sources using the format: [Document: filename, Page: X]
3. If information isn't in the provided context, say so clearly
4. For scope questions, be specific and reference relevant spec sections or drawing details
5. If asked about whether something is shown in the documents, search the context carefully

Context from documents:
${context}`
    };

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [systemMessage, ...messages],
      temperature: 0.3, // Lower temperature for more factual responses
      max_tokens: 2000
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating chat response:', error);
    throw error;
  }
}

// Parse citations from response
function parseCitations(responseText) {
  const citationRegex = /\[Document:\s*([^,]+),\s*Page:\s*(\d+)\]/g;
  const citations = [];
  let match;
  
  while ((match = citationRegex.exec(responseText)) !== null) {
    citations.push({
      filename: match[1].trim(),
      page: parseInt(match[2])
    });
  }
  
  return citations;
}

module.exports = {
  createEmbedding,
  findRelevantChunks,
  generateChatResponse,
  parseCitations
};
