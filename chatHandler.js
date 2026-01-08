const OpenAI = require('openai');
const { runQuery, getQuery, getOneQuery } = require('./database');
const { searchRelevantChunks, formatChunksForContext } = require('./embeddings');

let openai = null;

function initOpenAI(apiKey) {
  openai = new OpenAI({ apiKey });
}

/**
 * Create a new chat
 */
function createChat(projectId, title = 'New Chat') {
  runQuery(
    'INSERT INTO chats (project_id, title, created_at, updated_at) VALUES (?, ?, datetime("now"), datetime("now"))',
    [projectId, title]
  );
  
  // Get the last inserted chat
  const chats = getQuery('SELECT * FROM chats ORDER BY id DESC LIMIT 1');
  return chats[0] ? chats[0].id : null;
}

/**
 * Get chat history
 */
function getChatHistory(chatId) {
  return getQuery(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
    [chatId]
  );
}

/**
 * Add message to chat
 */
function addMessage(chatId, role, content, citations = null) {
  runQuery(
    'INSERT INTO messages (chat_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
    [chatId, role, content, citations ? JSON.stringify(citations) : null]
  );
  
  // Update chat's updated_at timestamp
  runQuery('UPDATE chats SET updated_at = datetime("now") WHERE id = ?', [chatId]);
}

/**
 * Extract citations from GPT response
 * Format: [Drawing A-101, Page 3] or [Section 09 90 00, Page 5]
 */
function extractCitations(content) {
  const citationRegex = /\[([^\]]+),\s*Page\s*(\d+)\]/gi;
  const citations = [];
  let match;
  
  while ((match = citationRegex.exec(content)) !== null) {
    citations.push({
      source: match[1].trim(),
      page: parseInt(match[2]),
      fullText: match[0]
    });
  }
  
  return citations;
}

/**
 * Send message and get response
 */
async function sendMessage(chatId, userMessage) {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  // Get chat and project info
  const chats = getQuery('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = chats[0];
  if (!chat) {
    throw new Error('Chat not found');
  }

  const projects = getQuery('SELECT * FROM projects WHERE id = ?', [chat.project_id]);
  const project = projects[0];
  if (!project) {
    throw new Error('Project not found');
  }

  // Add user message to database
  addMessage(chatId, 'user', userMessage);

  // Search for relevant chunks
  console.log('Searching for relevant document chunks...');
  const relevantChunks = await searchRelevantChunks(chat.project_id, userMessage, 15);
  
  if (relevantChunks.length === 0) {
    const noDocsMessage = "I don't have any processed documents for this project yet. Please upload and process documents first.";
    addMessage(chatId, 'assistant', noDocsMessage);
    return {
      role: 'assistant',
      content: noDocsMessage,
      citations: []
    };
  }

  // Format context from relevant chunks
  const context = formatChunksForContext(relevantChunks);

  // Get chat history for full context
  const history = getChatHistory(chatId);
  
  // Build messages for GPT
  const messages = [
    {
      role: 'system',
      content: `You are a helpful assistant analyzing construction documents for project "${project.name}".

Your task is to answer questions about the construction drawings and specifications based on the provided document excerpts.

When answering:
1. Be specific and cite your sources using the format: [Source Name, Page X]
2. If information is found in multiple locations, cite all relevant sources
3. If you cannot find information in the provided documents, say so clearly
4. For scope questions, be thorough and reference all relevant sections

Available document context:
${context}`
    }
  ];

  // Add chat history (excluding the last user message we just added)
  for (let i = 0; i < history.length - 1; i++) {
    const msg = history[i];
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // Add current user message
  messages.push({
    role: 'user',
    content: userMessage
  });

  console.log('Sending request to GPT...');

  // Get response from GPT
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: messages,
    temperature: 0.7,
    max_tokens: 2000
  });

  const assistantMessage = completion.choices[0].message.content;

  // Extract citations
  const citations = extractCitations(assistantMessage);

  // Add assistant message to database
  addMessage(chatId, 'assistant', assistantMessage, citations);

  // Auto-generate chat title if this is the first exchange
  if (history.length === 1) {
    const titlePrompt = `Generate a brief, descriptive title (5-7 words max) for a conversation that starts with this question: "${userMessage}". Just return the title, nothing else.`;
    
    try {
      const titleCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: titlePrompt }],
        max_tokens: 20
      });
      
      const title = titleCompletion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
      runQuery('UPDATE chats SET title = ? WHERE id = ?', [title, chatId]);
    } catch (error) {
      console.error('Error generating chat title:', error);
    }
  }

  return {
    role: 'assistant',
    content: assistantMessage,
    citations: citations
  };
}

/**
 * Delete old chats based on retention policy
 */
function deleteOldChats(retentionDays) {
  const result = runQuery(`
    DELETE FROM chats 
    WHERE datetime(updated_at) < datetime('now', '-' || ? || ' days')
  `, [retentionDays]);
  
  return result;
}

module.exports = {
  initOpenAI,
  createChat,
  getChatHistory,
  sendMessage,
  deleteOldChats
};
