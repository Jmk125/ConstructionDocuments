const OpenAI = require('openai');
const { runQuery, getQuery, getOneQuery } = require('./database');
const { searchRelevantChunks, searchRelevantContent, formatChunksForContext } = require('./embeddings');

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
 * Resolve sheet numbers to page numbers for PDF navigation
 */
function resolveSheetNumbers(citations, projectId) {
  return citations.map(citation => {
    // If already has page number or no sheet number, return as is
    if (citation.page || !citation.sheet) {
      return citation;
    }

    // Look up the page number for this sheet number
    const result = getOneQuery(`
      SELECT c.page_number, d.filename
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.project_id = ?
        AND c.sheet_number = ?
        AND d.filename = ?
      LIMIT 1
    `, [projectId, citation.sheet, citation.source]);

    if (result) {
      return {
        ...citation,
        page: result.page_number,
        filename: result.filename
      };
    }

    // If no exact match found, try to find by filename only
    const fallback = getOneQuery(`
      SELECT c.page_number, c.sheet_number, d.filename
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.project_id = ?
        AND d.filename = ?
      LIMIT 1
    `, [projectId, citation.source]);

    if (fallback) {
      return {
        ...citation,
        page: fallback.page_number,
        filename: fallback.filename
      };
    }

    // Return citation even if we couldn't resolve (will show error to user)
    return citation;
  });
}

function expandChunksWithCallouts(chunks, projectId, maxAdditional = 6) {
  const detailSheets = new Set();
  const chunkIds = new Set(chunks.map(chunk => chunk.id));

  for (const chunk of chunks) {
    if (!chunk.detail_reference) {
      continue;
    }

    try {
      const details = JSON.parse(chunk.detail_reference);
      for (const detailRef of details) {
        const match = detailRef.match(/\/([A-Z]{1,3}-\d+(?:\.\d+)?)/i);
        if (match && match[1]) {
          detailSheets.add(match[1].toUpperCase());
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }
  }

  if (detailSheets.size === 0) {
    return chunks;
  }

  const additionalChunks = getQuery(
    `
    SELECT c.*, d.filename, d.type
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE d.project_id = ?
      AND c.sheet_number IN (${Array.from(detailSheets).map(() => '?').join(', ')})
    ORDER BY c.page_number ASC
    LIMIT ?
    `,
    [projectId, ...Array.from(detailSheets), maxAdditional]
  ).filter(chunk => !chunkIds.has(chunk.id));

  return [...chunks, ...additionalChunks];
}

function formatVisualFindings(projectId, chunks) {
  const pageKeys = chunks.map(chunk => `${chunk.document_id}:${chunk.page_number}`);
  if (pageKeys.length === 0) {
    return '';
  }

  const findings = getQuery(
    `
    SELECT vf.*, d.filename
    FROM visual_findings vf
    JOIN documents d ON vf.document_id = d.id
    WHERE d.project_id = ?
      AND (vf.document_id || ':' || vf.page_number) IN (${pageKeys.map(() => '?').join(', ')})
    `,
    [projectId, ...pageKeys]
  );

  if (findings.length === 0) {
    return '';
  }

  const formatted = findings.map(finding => {
    const location = finding.sheet_number
      ? `Sheet ${finding.sheet_number}`
      : `Page ${finding.page_number}`;
    return `- ${finding.filename}, ${location}: ${finding.findings}`;
  }).join('\n');

  return `\n\n[Visual Findings]\n${formatted}`;
}

/**
 * Format visual findings that came from semantic search
 */
function formatVisualFindingsFromSearch(visualFindings) {
  if (visualFindings.length === 0) {
    return '';
  }

  const formatted = visualFindings.map((finding, index) => {
    const location = finding.sheet_number
      ? `Sheet ${finding.sheet_number}`
      : `Page ${finding.page_number}`;

    let findingsText = '';
    try {
      const parsed = typeof finding.findings === 'string'
        ? JSON.parse(finding.findings)
        : finding.findings;

      findingsText = parsed.summary || '';

      // Add elements if present
      if (parsed.elements && parsed.elements.length > 0) {
        const elementsSummary = parsed.elements
          .map(el => `${el.type}${el.dimensions ? ` (${el.dimensions})` : ''}`)
          .slice(0, 5)  // Limit to first 5 elements
          .join(', ');
        findingsText += `. Elements: ${elementsSummary}`;
      }

      // Add annotations if present
      if (parsed.annotations && parsed.annotations.length > 0) {
        const annotationsSummary = parsed.annotations.slice(0, 3).join('; ');
        findingsText += `. Annotations: ${annotationsSummary}`;
      }
    } catch (e) {
      findingsText = typeof finding.findings === 'string' ? finding.findings : '';
    }

    return `[Visual Finding ${index + 1}: ${finding.filename}, ${location}${finding.sheet_type ? ` (${finding.sheet_type})` : ''}]\n${findingsText}`;
  }).join('\n\n---\n\n');

  return `[Visual Analysis Findings]\n${formatted}`;
}

/**
 * Extract citations from GPT response
 * Formats:
 * - Sheet-based: [Drawing A-101, Sheet A-101] or [Drawing A-101, Sheet S-3.1]
 * - Page-based (fallback): [Section 09 90 00, Page 5]
 * - Detail-based: [Drawing A-101, Detail 3/A-101]
 */
function extractCitations(content) {
  const citations = [];

  // Pattern 1: Sheet number citations [filename, Sheet X-###]
  const sheetRegex = /\[([^\]]+?),\s*Sheet\s+([A-Z]{1,3}-\d+(?:\.\d+)?)\]/gi;
  let match;

  while ((match = sheetRegex.exec(content)) !== null) {
    citations.push({
      source: match[1].trim(),
      sheet: match[2].trim(),
      page: null, // Will be resolved later
      fullText: match[0]
    });
  }

  // Pattern 2: Detail references [filename, Detail #/X-###]
  const detailRegex = /\[([^\]]+?),\s*Detail\s+(\d+\/[A-Z]{1,3}-\d+(?:\.\d+)?)\]/gi;
  while ((match = detailRegex.exec(content)) !== null) {
    const detailRef = match[2].trim();
    const sheetMatch = detailRef.match(/\/([A-Z]{1,3}-\d+(?:\.\d+)?)/);

    citations.push({
      source: match[1].trim(),
      sheet: sheetMatch ? sheetMatch[1] : null,
      detail: detailRef,
      page: null,
      fullText: match[0]
    });
  }

  // Pattern 3: Fallback to page numbers [filename, Page #]
  const pageRegex = /\[([^\]]+?),\s*Page\s+(\d+)\]/gi;
  while ((match = pageRegex.exec(content)) !== null) {
    // Only add if not already captured as sheet citation
    const alreadyAdded = citations.some(c => c.fullText === match[0]);
    if (!alreadyAdded) {
      citations.push({
        source: match[1].trim(),
        page: parseInt(match[2]),
        sheet: null,
        fullText: match[0]
      });
    }
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

  // Search for relevant content (both chunks and visual findings)
  console.log('Searching for relevant document content (text + vision)...');
  const relevantContent = await searchRelevantContent(chat.project_id, userMessage, 15);

  // Separate chunks from visual findings
  const relevantChunks = relevantContent.filter(item => item.source_type === 'chunk');
  const relevantVisualFindings = relevantContent.filter(item => item.source_type === 'visual_finding');

  // Expand chunks with callouts
  const expandedChunks = expandChunksWithCallouts(relevantChunks, chat.project_id);

  if (expandedChunks.length === 0 && relevantVisualFindings.length === 0) {
    const noDocsMessage = "I don't have any processed documents for this project yet. Please upload and process documents first.";
    addMessage(chatId, 'assistant', noDocsMessage);
    return {
      role: 'assistant',
      content: noDocsMessage,
      citations: []
    };
  }

  // Format context from relevant chunks and visual findings
  let context = '';

  if (expandedChunks.length > 0) {
    context += formatChunksForContext(expandedChunks);
  }

  if (relevantVisualFindings.length > 0) {
    context += '\n\n' + formatVisualFindingsFromSearch(relevantVisualFindings);
  }

  // Get chat history for full context
  const history = getChatHistory(chatId);
  
  // Build messages for GPT
  const messages = [
    {
      role: 'system',
      content: `You are a helpful assistant analyzing construction documents for project "${project.name}".

Your task is to answer questions about the construction drawings and specifications based on the provided document excerpts.

When answering:
1. Be specific and cite your sources. For drawings with sheet numbers, use the format: [Source Name, Sheet X-###]
   For specifications or documents without sheet numbers, use: [Source Name, Page X]
2. When referencing specific details, use the format: [Source Name, Detail #/Sheet]
   Example: [Drawing A-101, Detail 3/A-101]
3. If information is found in multiple locations, cite all relevant sources
4. If you cannot find information in the provided documents, say so clearly
5. For scope questions, be thorough and reference all relevant sections

FORMATTING GUIDELINES:
- Use **bold** for important terms, requirements, or key points
- Use bullet points (-) for lists of items, requirements, or findings
- Use numbered lists (1. 2. 3.) for sequential steps or prioritized items
- Use headers (##) to organize longer responses into sections
- Structure your responses for easy readability

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
  let citations = extractCitations(assistantMessage);

  // Resolve sheet numbers to page numbers for PDF navigation
  citations = resolveSheetNumbers(citations, chat.project_id);

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
