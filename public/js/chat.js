const API_BASE = 'http://localhost:3000/api';

let currentChat = null;
let currentProject = null;
let pdfDoc = null;
let currentPage = 1;

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('id');
  
  if (!chatId) {
    window.location.href = '/';
    return;
  }
  
  loadChat(chatId);
  setupEventListeners();
});

function setupEventListeners() {
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  const newChatBtn = document.getElementById('newChatBtn');
  const deleteChatBtn = document.getElementById('deleteChatBtn');
  
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
    const response = await fetch(`${API_BASE}/chat/${chatId}`);
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
      const citationText = `[Document: ${citation.filename}, Page: ${citation.page}]`;
      const citationLink = `<a class="citation" href="#" data-filename="${escapeHtml(citation.filename)}" data-page="${citation.page}">${citationText}</a>`;
      processedContent = processedContent.replace(escapeHtml(citationText), citationLink);
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
      await openPDFViewer(filename, page);
    });
  });
  
  container.scrollTop = container.scrollHeight;
}

function formatMessageContent(content) {
  // Convert newlines to paragraphs
  const paragraphs = content.split('\n\n');
  return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  
  if (!content) return;
  
  // Disable input while sending
  const sendBtn = document.getElementById('sendBtn');
  input.disabled = true;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<span class="spinner"></span>';
  
  // Append user message immediately
  appendMessage('user', content);
  input.value = '';
  input.style.height = 'auto';
  
  try {
    const response = await fetch(`${API_BASE}/chat/${currentChat.id}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }
    
    const result = await response.json();
    
    // Append assistant response
    appendMessage('assistant', result.content, result.citations);
    
    // Update chat title in sidebar if this was the first message
    if (currentChat.title === 'New Chat') {
      currentChat.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
      document.getElementById('chatTitle').textContent = currentChat.title;
      loadChatsList(currentChat.project_id, currentChat.id);
    }
  } catch (error) {
    console.error('Error sending message:', error);
    showError(error.message || 'Failed to send message');
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span>Send</span>';
    input.focus();
  }
}

async function loadChatsList(projectId, currentChatId) {
  try {
    const response = await fetch(`${API_BASE}/chat/project/${projectId}`);
    const chats = await response.json();
    
    const chatsList = document.getElementById('chatsList');
    
    if (chats.length === 0) {
      chatsList.innerHTML = '<p class="empty-state">No other chats</p>';
      return;
    }
    
    chatsList.innerHTML = chats.map(chat => `
      <div class="sidebar-chat-item ${chat.id === currentChatId ? 'active' : ''}" 
           onclick="window.location.href='/chat.html?id=${chat.id}'">
        <h5>${escapeHtml(chat.title || 'Untitled Chat')}</h5>
        <p>${formatDate(chat.last_message_at)}</p>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading chats list:', error);
  }
}

async function createNewChat() {
  try {
    const response = await fetch(`${API_BASE}/chat`, {
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
    const response = await fetch(`${API_BASE}/chat/${currentChat.id}`, {
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

async function openPDFViewer(filename, pageNumber) {
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
    
    // Update modal title
    document.getElementById('pdfTitle').textContent = filename;
    
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
