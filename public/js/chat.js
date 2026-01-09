const API_BASE = 'http://localhost:3000/api';

let currentChat = null;
let currentProject = null;
let pdfDoc = null;
let currentPage = 1;
let availableModels = [];

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = parseInt(urlParams.get('id'));

  if (!chatId || isNaN(chatId)) {
    window.location.href = '/';
    return;
  }

  loadAvailableModels();
  loadChat(chatId);
  setupEventListeners();
});

function setupEventListeners() {
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  const newChatBtn = document.getElementById('newChatBtn');
  const deleteChatBtn = document.getElementById('deleteChatBtn');
  const modelSelect = document.getElementById('modelSelect');

  messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await sendMessage();
  });

  // Auto-resize textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
  });

  // Allow Ctrl+Enter to send
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      messageForm.dispatchEvent(new Event('submit'));
    }
  });

  // Update model description when selection changes
  modelSelect.addEventListener('change', () => {
    updateModelDescription();
  });

  newChatBtn.addEventListener('click', async () => {
    if (currentProject) {
      await createNewChat();
    }
  });

  deleteChatBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete this chat?')) {
      await deleteChat();
    }
  });

  setupPDFViewerListeners();
}

function setupPDFViewerListeners() {
  const modal = document.getElementById('pdfModal');
  const closeBtn = modal.querySelector('.close');
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
    pdfDoc = null;
  });
  
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderPDFPage(currentPage);
    }
  });
  
  nextBtn.addEventListener('click', () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) {
      currentPage++;
      renderPDFPage(currentPage);
    }
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
      pdfDoc = null;
    }
  });
}

async function loadChat(chatId) {
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}`);
    const chat = await response.json();

    currentChat = chat;

    // Load project info
    const projectResponse = await fetch(`${API_BASE}/projects/${chat.project_id}`);
    currentProject = await projectResponse.json();
    
    // Update UI
    document.getElementById('chatTitle').textContent = chat.title || 'New Chat';
    document.getElementById('sidebarProjectName').textContent = currentProject.name;
    document.getElementById('viewProjectLink').href = `/project.html?id=${currentProject.id}`;
    
    // Load messages
    loadMessages(chat.messages);
    
    // Load other chats for sidebar
    loadChatsList(chat.project_id, chatId);
  } catch (error) {
    console.error('Error loading chat:', error);
    showError('Failed to load chat');
  }
}

function loadMessages(messages) {
  const container = document.getElementById('messagesContainer');
  
  if (!messages || messages.length === 0) {
    // Keep welcome message
    return;
  }
  
  // Clear welcome message
  container.innerHTML = '';
  
  messages.forEach(msg => {
    appendMessage(msg.role, msg.content, msg.citations ? JSON.parse(msg.citations) : []);
  });
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function appendMessage(role, content, citations = []) {
  const container = document.getElementById('messagesContainer');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  let processedContent = escapeHtml(content);

  // Replace citation placeholders with clickable links
  if (citations.length > 0) {
    citations.forEach(citation => {
      let displayText;
      let originalText;

      // Determine what the original citation text looks like in the content
      if (citation.detail) {
        // Detail reference: [filename, Detail #/Sheet]
        displayText = `[${citation.source}, Detail ${citation.detail}]`;
        originalText = displayText;
      } else if (citation.sheet) {
        // Sheet number: [filename, Sheet X-###]
        displayText = `[${citation.source}, Sheet ${citation.sheet}]`;
        originalText = displayText;
      } else {
        // Page number: [filename, Page #]
        displayText = `[${citation.source}, Page ${citation.page}]`;
        originalText = displayText;
      }

      // Create clickable link with metadata
      const citationLink = `<a class="citation" href="#" data-filename="${escapeHtml(citation.filename || citation.source)}" data-page="${citation.page}" data-sheet="${escapeHtml(citation.sheet || '')}" data-detail="${escapeHtml(citation.detail || '')}">${escapeHtml(displayText)}</a>`;

      // Replace in content
      processedContent = processedContent.replace(escapeHtml(originalText), citationLink);
    });
  }

  messageDiv.innerHTML = `
    <div class="message-content">
      ${formatMessageContent(processedContent)}
    </div>
  `;

  container.appendChild(messageDiv);

  // Add click handlers to citations
  const citationLinks = messageDiv.querySelectorAll('.citation');
  citationLinks.forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const filename = link.dataset.filename;
      const page = parseInt(link.dataset.page);
      const sheet = link.dataset.sheet;
      const detail = link.dataset.detail;

      if (page) {
        await openPDFViewer(filename, page, sheet, detail);
      } else {
        showError('Unable to locate page for this citation');
      }
    });
  });

  container.scrollTop = container.scrollHeight;
}

function formatMessageContent(content) {
  // Split into blocks (paragraphs, lists, etc.)
  const blocks = content.split('\n\n');

  return blocks.map(block => {
    const lines = block.split('\n');

    // Check if this is a bullet list (-, *, or •)
    if (lines.every(line => /^[\s]*[-*•]\s+/.test(line) || line.trim() === '')) {
      const items = lines
        .filter(line => line.trim())
        .map(line => {
          const text = line.replace(/^[\s]*[-*•]\s+/, '');
          return `<li>${formatInlineMarkdown(text)}</li>`;
        })
        .join('');
      return `<ul>${items}</ul>`;
    }

    // Check if this is a numbered list
    if (lines.every(line => /^[\s]*\d+\.\s+/.test(line) || line.trim() === '')) {
      const items = lines
        .filter(line => line.trim())
        .map(line => {
          const text = line.replace(/^[\s]*\d+\.\s+/, '');
          return `<li>${formatInlineMarkdown(text)}</li>`;
        })
        .join('');
      return `<ol>${items}</ol>`;
    }

    // Check for headers
    if (/^#{1,3}\s+/.test(block)) {
      const match = block.match(/^(#{1,3})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        return `<h${level + 2}>${formatInlineMarkdown(text)}</h${level + 2}>`;
      }
    }

    // Regular paragraph - handle multi-line within paragraph
    const formattedLines = lines.map(line => formatInlineMarkdown(line)).join('<br>');
    return `<p>${formattedLines}</p>`;
  }).join('');
}

function formatInlineMarkdown(text) {
  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (but not in middle of words)
  text = text.replace(/\b_(.+?)_\b/g, '<em>$1</em>');
  text = text.replace(/\*([^*]+?)\*/g, '<em>$1</em>');

  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  return text;
}

async function loadAvailableModels() {
  try {
    const response = await fetch(`${API_BASE}/chats/models`);
    availableModels = await response.json();

    const modelSelect = document.getElementById('modelSelect');
    modelSelect.innerHTML = availableModels.map(model =>
      `<option value="${model.id}">${model.name}</option>`
    ).join('');

    // Update description for default model
    updateModelDescription();
  } catch (error) {
    console.error('Error loading models:', error);
    document.getElementById('modelDescription').textContent = 'Using default model';
  }
}

function updateModelDescription() {
  const modelSelect = document.getElementById('modelSelect');
  const selectedModelId = modelSelect.value;
  const model = availableModels.find(m => m.id === selectedModelId);

  const descriptionEl = document.getElementById('modelDescription');
  if (model) {
    descriptionEl.textContent = model.description;
  }
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  const modelSelect = document.getElementById('modelSelect');
  const selectedModel = modelSelect.value;

  if (!content) return;

  // Disable input while sending
  const sendBtn = document.getElementById('sendBtn');
  input.disabled = true;
  sendBtn.disabled = true;
  modelSelect.disabled = true;
  sendBtn.innerHTML = '<span class="spinner"></span>';

  // Append user message immediately
  appendMessage('user', content);
  input.value = '';
  input.style.height = 'auto';

  try {
    const response = await fetch(`${API_BASE}/chats/${currentChat.id}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: content,
        model: selectedModel
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }
    
    const result = await response.json();

    // Append assistant response
    appendMessage('assistant', result.content, result.citations);

    // Reload chat to get AI-generated title if this was the first message
    if (currentChat.title === 'New Chat') {
      // Reload the chat to get the updated title
      const chatResponse = await fetch(`${API_BASE}/chats/${currentChat.id}`);
      const updatedChat = await chatResponse.json();

      if (updatedChat.title && updatedChat.title !== 'New Chat') {
        currentChat.title = updatedChat.title;
        document.getElementById('chatTitle').textContent = updatedChat.title;
        loadChatsList(currentChat.project_id, currentChat.id);
      }
    }
  } catch (error) {
    console.error('Error sending message:', error);
    showError(error.message || 'Failed to send message');
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    modelSelect.disabled = false;
    sendBtn.innerHTML = '<span>Send</span>';
    input.focus();
  }
}

async function loadChatsList(projectId, currentChatId) {
  try {
    const response = await fetch(`${API_BASE}/chats/project/${projectId}`);
    const chats = await response.json();
    
    const chatsList = document.getElementById('chatsList');
    
    if (chats.length === 0) {
      chatsList.innerHTML = '<p class="empty-state">No other chats</p>';
      return;
    }
    
    chatsList.innerHTML = chats.map(chat => `
      <div class="sidebar-chat-item ${chat.id === currentChatId ? 'active' : ''}">
        <div onclick="window.location.href='/chat.html?id=${chat.id}'" style="flex: 1; cursor: pointer;">
          <h5>${escapeHtml(chat.title || 'Untitled Chat')}</h5>
          <p>${formatDate(chat.updated_at || chat.created_at)}</p>
        </div>
        <button class="btn btn-danger btn-sm chat-delete-btn" onclick="deleteChatFromList(${chat.id}, event)" title="Delete chat">×</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading chats list:', error);
  }
}

async function createNewChat() {
  try {
    const response = await fetch(`${API_BASE}/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectId: currentProject.id,
        title: 'New Chat'
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to create chat');
    }
    
    const chat = await response.json();
    window.location.href = `/chat.html?id=${chat.id}`;
  } catch (error) {
    console.error('Error creating chat:', error);
    showError('Failed to create chat');
  }
}

async function deleteChat() {
  try {
    const response = await fetch(`${API_BASE}/chats/${currentChat.id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete chat');
    }

    window.location.href = `/project.html?id=${currentProject.id}`;
  } catch (error) {
    console.error('Error deleting chat:', error);
    showError('Failed to delete chat');
  }
}

async function deleteChatFromList(chatId, event) {
  // Prevent triggering the chat item click
  if (event) {
    event.stopPropagation();
  }

  if (!confirm('Are you sure you want to delete this chat?')) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete chat');
    }

    // If deleted chat is the current one, redirect to project page
    if (chatId === currentChat.id) {
      window.location.href = `/project.html?id=${currentProject.id}`;
    } else {
      // Just refresh the chat list
      loadChatsList(currentProject.id, currentChat.id);
    }
  } catch (error) {
    console.error('Error deleting chat:', error);
    showError('Failed to delete chat');
  }
}

async function openPDFViewer(filename, pageNumber, sheetNumber = '', detailRef = '') {
  try {
    // Find the document to get its filepath
    const projectResponse = await fetch(`${API_BASE}/projects/${currentProject.id}`);
    const project = await projectResponse.json();

    const document = project.documents.find(doc => doc.filename === filename);
    if (!document) {
      showError('Document not found');
      return;
    }

    // Construct the URL to the PDF
    const pdfUrl = `/uploads/${currentProject.id}/${document.type === 'spec' ? 'specs' : 'drawings'}/${filename}`;

    // Load PDF
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    pdfDoc = await loadingTask.promise;

    // Set current page
    currentPage = pageNumber;

    // Update modal title with sheet number if available
    let title = filename;
    if (sheetNumber) {
      title += ` - Sheet ${sheetNumber}`;
    }
    if (detailRef) {
      title += ` - Detail ${detailRef}`;
    }
    document.getElementById('pdfTitle').textContent = title;

    // Render page
    await renderPDFPage(currentPage);

    // Show modal
    document.getElementById('pdfModal').classList.add('active');
  } catch (error) {
    console.error('Error opening PDF:', error);
    showError('Failed to open PDF');
  }
}

async function renderPDFPage(pageNum) {
  if (!pdfDoc) return;
  
  try {
    const page = await pdfDoc.getPage(pageNum);
    
    const canvas = document.getElementById('pdfCanvas');
    const context = canvas.getContext('2d');
    
    const viewport = page.getViewport({ scale: 1.5 });
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Update page info
    document.getElementById('pageInfo').textContent = `Page ${pageNum} of ${pdfDoc.numPages}`;
    
    // Update button states
    document.getElementById('prevPage').disabled = pageNum <= 1;
    document.getElementById('nextPage').disabled = pageNum >= pdfDoc.numPages;
  } catch (error) {
    console.error('Error rendering PDF page:', error);
  }
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  alert(message);
}
