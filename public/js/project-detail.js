const API_BASE = 'http://localhost:3000/api';

let currentProject = null;

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('id');
  
  if (!projectId) {
    window.location.href = '/';
    return;
  }
  
  loadProject(projectId);
  setupEventListeners();
});

function setupEventListeners() {
  const uploadDocsBtn = document.getElementById('uploadDocsBtn');
  const cancelUpload = document.getElementById('cancelUpload');
  const uploadForm = document.getElementById('uploadForm');
  const documentUploadForm = document.getElementById('documentUploadForm');
  const processBtn = document.getElementById('processBtn');
  const deleteProjectBtn = document.getElementById('deleteProjectBtn');
  const newChatBtn = document.getElementById('newChatBtn');

  uploadDocsBtn.addEventListener('click', () => {
    uploadForm.style.display = 'block';
  });

  cancelUpload.addEventListener('click', () => {
    uploadForm.style.display = 'none';
    documentUploadForm.reset();
  });

  documentUploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await uploadDocuments();
  });

  processBtn.addEventListener('click', async () => {
    await processProjectDocuments();
  });

  deleteProjectBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete this project? This will delete all documents and chats.')) {
      await deleteProject();
    }
  });

  newChatBtn.addEventListener('click', async () => {
    await createNewChat();
  });
}

async function loadProject(projectId) {
  try {
    const response = await fetch(`${API_BASE}/projects/${projectId}`);
    const project = await response.json();
    
    currentProject = project;
    
    document.getElementById('projectName').textContent = project.name;
    document.getElementById('projectDescription').textContent = project.description || 'No description';
    
    loadDocuments(project.documents);
    loadChats(projectId);
  } catch (error) {
    console.error('Error loading project:', error);
    showError('Failed to load project');
  }
}

function loadDocuments(documents) {
  const documentsList = document.getElementById('documentsList');
  const processBtn = document.getElementById('processBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  
  if (!documents || documents.length === 0) {
    documentsList.innerHTML = `
      <div class="empty-state">
        <p>No documents uploaded yet. Upload specifications and drawings to get started.</p>
      </div>
    `;
    processBtn.disabled = true;
    newChatBtn.disabled = true;
    return;
  }
  
  const hasUnprocessed = documents.some(doc => !doc.processed);
  const hasProcessed = documents.some(doc => doc.processed);
  
  processBtn.disabled = !hasUnprocessed;
  newChatBtn.disabled = !hasProcessed;
  
  documentsList.innerHTML = documents.map(doc => `
    <div class="document-item">
      <div class="document-info">
        <span class="document-type ${doc.type}">${doc.type}</span>
        <span>${escapeHtml(doc.filename)}</span>
        ${doc.page_count ? `<span class="text-secondary">(${doc.page_count} pages)</span>` : ''}
      </div>
      <div>
        <span class="document-status ${doc.processed ? 'processed' : 'pending'}">
          ${doc.processed ? 'Processed' : 'Pending'}
        </span>
      </div>
    </div>
  `).join('');
}

async function loadChats(projectId) {
  try {
    const response = await fetch(`${API_BASE}/chat/project/${projectId}`);
    const chats = await response.json();
    
    const chatsList = document.getElementById('chatsList');
    
    if (chats.length === 0) {
      chatsList.innerHTML = `
        <div class="empty-state">
          <p>No chats yet. Create a new chat to start asking questions about your documents.</p>
        </div>
      `;
      return;
    }
    
    chatsList.innerHTML = chats.map(chat => `
      <div class="chat-item" onclick="window.location.href='/chat.html?id=${chat.id}'">
        <div class="chat-item-info">
          <h4>${escapeHtml(chat.title || 'Untitled Chat')}</h4>
          <p>Last active ${formatDate(chat.last_message_at)}</p>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading chats:', error);
  }
}

async function uploadDocuments() {
  const fileInput = document.getElementById('fileInput');
  const files = fileInput.files;
  
  if (files.length === 0) {
    showError('Please select files to upload');
    return;
  }
  
  const formData = new FormData();
  const docType = document.querySelector('input[name="docType"]:checked').value;
  
  for (let file of files) {
    formData.append('documents', file);
  }
  formData.append('type', docType);
  
  try {
    const uploadBtn = document.querySelector('#documentUploadForm button[type="submit"]');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    
    const response = await fetch(`${API_BASE}/documents/${currentProject.id}/upload`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Upload failed');
    }
    
    const result = await response.json();
    
    // Reload project to show new documents
    await loadProject(currentProject.id);
    
    // Reset form
    document.getElementById('uploadForm').style.display = 'none';
    document.getElementById('documentUploadForm').reset();
    
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload';
  } catch (error) {
    console.error('Error uploading documents:', error);
    showError('Failed to upload documents');
  }
}

async function processProjectDocuments() {
  const processBtn = document.getElementById('processBtn');
  const processingStatus = document.getElementById('processingStatus');
  
  try {
    processBtn.disabled = true;
    processingStatus.style.display = 'block';
    
    const response = await fetch(`${API_BASE}/documents/${currentProject.id}/process`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error('Processing failed');
    }
    
    const result = await response.json();

    processingStatus.style.display = 'none';

    // Reload project to show processed documents
    await loadProject(currentProject.id);

    const processResults = result.processResults || [];
    const successCount = processResults.filter(r => r.success).length;
    alert(`Processing complete! ${successCount} of ${processResults.length} documents processed successfully.\nEmbeddings: ${result.embeddingResults?.chunksProcessed || 0} chunks embedded.`);
  } catch (error) {
    console.error('Error processing documents:', error);
    processingStatus.style.display = 'none';
    showError('Failed to process documents');
    processBtn.disabled = false;
  }
}

async function deleteProject() {
  try {
    const response = await fetch(`${API_BASE}/projects/${currentProject.id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Delete failed');
    }
    
    window.location.href = '/';
  } catch (error) {
    console.error('Error deleting project:', error);
    showError('Failed to delete project');
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

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
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
