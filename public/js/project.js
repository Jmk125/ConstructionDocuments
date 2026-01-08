const API_BASE = 'http://localhost:3000/api';
let currentProjectId = null;
let currentChatId = null;

document.addEventListener('DOMContentLoaded', () => {
    // Get project ID from URL
    const params = new URLSearchParams(window.location.search);
    currentProjectId = params.get('id');

    if (!currentProjectId) {
        window.location.href = '/';
        return;
    }

    loadProject();
    setupEventListeners();
});

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    // Upload button
    document.getElementById('uploadBtn').addEventListener('click', uploadDocuments);

    // Process button
    document.getElementById('processBtn').addEventListener('click', processDocuments);

    // New chat button
    document.getElementById('newChatBtn').addEventListener('click', createNewChat);
}

function switchTab(tabName) {
    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    });
}

async function loadProject() {
    try {
        const response = await fetch(`${API_BASE}/projects/${currentProjectId}`);
        const project = await response.json();

        document.getElementById('projectName').textContent = project.name;
        displayDocuments(project.documents || []);
        displayChats(project.chats || []);
    } catch (error) {
        console.error('Error loading project:', error);
        alert('Error loading project');
    }
}

function displayDocuments(documents) {
    const container = document.getElementById('documentsList');
    const processBtn = document.getElementById('processBtn');

    if (documents.length === 0) {
        container.innerHTML = '<p class="empty-state">No documents uploaded yet.</p>';
        processBtn.style.display = 'none';
        return;
    }

    const hasUnprocessed = documents.some(doc => !doc.processed);
    processBtn.style.display = hasUnprocessed ? 'block' : 'none';

    container.innerHTML = documents.map(doc => `
        <div class="document-item">
            <div class="document-info">
                <div class="document-icon">📄</div>
                <div class="document-details">
                    <div class="document-name">${escapeHtml(doc.filename)}</div>
                    <div class="document-meta">
                        ${doc.type === 'spec' ? 'Specification' : 'Drawing'} · 
                        ${doc.page_count ? doc.page_count + ' pages' : 'Not processed'}
                    </div>
                </div>
            </div>
            <div>
                <span class="document-status ${doc.processed ? 'status-processed' : 'status-pending'}">
                    ${doc.processed ? 'Processed' : 'Pending'}
                </span>
                <button class="btn btn-danger btn-sm" onclick="deleteDocument(${doc.id})" style="margin-left: 0.5rem;">Delete</button>
            </div>
        </div>
    `).join('');
}

function displayChats(chats) {
    const container = document.getElementById('chatsList');

    if (chats.length === 0) {
        container.innerHTML = '<p class="empty-state">No chats yet.</p>';
        return;
    }

    container.innerHTML = chats.map(chat => `
        <div class="chat-item ${chat.id === currentChatId ? 'active' : ''}" onclick="loadChat(${chat.id})">
            <div class="chat-item-title">${escapeHtml(chat.title || 'Untitled Chat')}</div>
            <div class="chat-item-date">${formatDate(chat.updated_at)}</div>
        </div>
    `).join('');
}

async function uploadDocuments() {
    const fileInput = document.getElementById('fileInput');
    const docType = document.getElementById('documentType').value;
    const uploadBtn = document.getElementById('uploadBtn');

    console.log('Upload button clicked');
    console.log('Files selected:', fileInput.files.length);

    if (!fileInput.files.length) {
        alert('Please select at least one PDF file');
        return;
    }

    // Show file sizes
    for (let file of fileInput.files) {
        console.log(`File: ${file.name}, Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
    }

    const formData = new FormData();
    formData.append('type', docType);
    
    for (let file of fileInput.files) {
        formData.append('documents', file);
    }

    // Disable button and show loading state
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    try {
        console.log('Starting upload...');
        const response = await fetch(`${API_BASE}/documents/${currentProjectId}/upload`, {
            method: 'POST',
            body: formData
        });

        console.log('Upload response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
        }

        const result = await response.json();
        console.log('Upload result:', result);

        fileInput.value = '';
        loadProject();
        alert('Documents uploaded successfully! Click "Process Documents" to analyze them.');
    } catch (error) {
        console.error('Error uploading documents:', error);
        alert('Error uploading documents: ' + error.message);
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload PDFs';
    }
}

async function processDocuments() {
    const processBtn = document.getElementById('processBtn');
    const statusDiv = document.getElementById('processStatus');

    processBtn.disabled = true;
    statusDiv.classList.add('active');
    statusDiv.innerHTML = '<p>Processing documents... This may take a few minutes.</p>';

    try {
        const response = await fetch(`${API_BASE}/documents/${currentProjectId}/process`, {
            method: 'POST'
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.error || 'Processing failed');

        statusDiv.innerHTML = '<p class="success">Documents processed successfully! You can now create a chat to ask questions.</p>';
        loadProject();
    } catch (error) {
        console.error('Error processing documents:', error);
        statusDiv.innerHTML = '<p class="error">Error processing documents: ' + error.message + '</p>';
        processBtn.disabled = false;
    }
}

async function deleteDocument(documentId) {
    if (!confirm('Are you sure you want to delete this document?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/documents/${documentId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Delete failed');

        loadProject();
    } catch (error) {
        console.error('Error deleting document:', error);
        alert('Error deleting document');
    }
}

async function createNewChat() {
    try {
        const response = await fetch(`${API_BASE}/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: currentProjectId, title: 'New Chat' })
        });

        if (!response.ok) throw new Error('Failed to create chat');

        const chat = await response.json();
        currentChatId = chat.id;
        
        loadProject();
        switchTab('chat');
        loadChat(chat.id);
    } catch (error) {
        console.error('Error creating chat:', error);
        alert('Error creating chat');
    }
}

async function loadChat(chatId) {
    currentChatId = chatId;
    
    // Update chat list selection
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.toggle('active', item.onclick.toString().includes(chatId));
    });

    try {
        const response = await fetch(`${API_BASE}/chats/${chatId}`);
        const chat = await response.json();

        displayChatMessages(chat.messages || []);
        switchTab('chat');
    } catch (error) {
        console.error('Error loading chat:', error);
        alert('Error loading chat');
    }
}

function displayChatMessages(messages) {
    const chatArea = document.getElementById('chatArea');
    
    chatArea.innerHTML = `
        <div class="chat-messages" id="chatMessages">
            ${messages.map(msg => renderMessage(msg)).join('')}
        </div>
        <div class="chat-input-area">
            <form class="chat-input-form" onsubmit="sendMessage(event)">
                <input type="text" id="messageInput" placeholder="Ask a question about your documents..." required>
                <button type="submit" class="btn btn-primary">Send</button>
            </form>
        </div>
    `;

    // Scroll to bottom
    const messagesDiv = document.getElementById('chatMessages');
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function renderMessage(message) {
    const avatar = message.role === 'user' ? 'U' : 'AI';
    let content = escapeHtml(message.content);
    
    // Parse citations if present
    if (message.citations && message.citations.length > 0) {
        const citations = typeof message.citations === 'string' 
            ? JSON.parse(message.citations) 
            : message.citations;
        
        citations.forEach(citation => {
            const citationHtml = `<a class="citation" href="#" onclick="openCitation('${escapeHtml(citation.source)}', ${citation.page}); return false;">${escapeHtml(citation.fullText)}</a>`;
            content = content.replace(escapeHtml(citation.fullText), citationHtml);
        });
    }

    return `
        <div class="message ${message.role}">
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                <div class="message-text">${content}</div>
            </div>
        </div>
    `;
}

async function sendMessage(event) {
    event.preventDefault();
    
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message) return;

    // Clear input
    input.value = '';
    input.disabled = true;

    // Add user message to UI
    const messagesDiv = document.getElementById('chatMessages');
    messagesDiv.innerHTML += renderMessage({ role: 'user', content: message });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Add loading indicator
    messagesDiv.innerHTML += `
        <div class="message assistant" id="loadingMessage">
            <div class="message-avatar">AI</div>
            <div class="message-content">
                <div class="message-text">Thinking...</div>
            </div>
        </div>
    `;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    try {
        const response = await fetch(`${API_BASE}/chats/${currentChatId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        if (!response.ok) throw new Error('Failed to send message');

        const result = await response.json();

        // Remove loading indicator
        document.getElementById('loadingMessage').remove();

        // Add assistant response
        messagesDiv.innerHTML += renderMessage(result);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        input.disabled = false;
        input.focus();
    } catch (error) {
        console.error('Error sending message:', error);
        document.getElementById('loadingMessage').remove();
        messagesDiv.innerHTML += renderMessage({
            role: 'assistant',
            content: 'Sorry, there was an error processing your message. Please try again.'
        });
        input.disabled = false;
    }
}

function openCitation(source, page) {
    alert(`Citation: ${source}, Page ${page}\n\nPDF viewer functionality would open here.`);
    // TODO: Implement PDF viewer that opens to specific page
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
