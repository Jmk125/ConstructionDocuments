const API_BASE = 'http://localhost:3000/api';

// Load projects on page load
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
  setupEventListeners();
});

function setupEventListeners() {
  const newProjectBtn = document.getElementById('newProjectBtn');
  const modal = document.getElementById('newProjectModal');
  const closeBtn = modal.querySelector('.close');
  const cancelBtn = document.getElementById('cancelBtn');
  const form = document.getElementById('newProjectForm');

  newProjectBtn.addEventListener('click', () => {
    modal.classList.add('active');
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
    form.reset();
  });

  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('active');
    form.reset();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createProject();
  });

  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
      form.reset();
    }
  });
}

async function loadProjects() {
  try {
    const response = await fetch(`${API_BASE}/projects`);
    const projects = await response.json();
    
    const projectsList = document.getElementById('projectsList');
    
    if (projects.length === 0) {
      projectsList.innerHTML = `
        <div class="empty-state">
          <p>No projects yet. Create your first project to get started!</p>
        </div>
      `;
      return;
    }
    
    projectsList.innerHTML = projects.map(project => `
      <div class="project-card" onclick="window.location.href='/project.html?id=${project.id}'">
        <h3>${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.description) || 'No description'}</p>
        <div class="project-card-footer">
          <span>Created ${formatDate(project.created_at)}</span>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading projects:', error);
    showError('Failed to load projects');
  }
}

async function createProject() {
  const name = document.getElementById('projectName').value;
  const description = document.getElementById('projectDescription').value;
  
  try {
    const response = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, description })
    });
    
    if (!response.ok) {
      throw new Error('Failed to create project');
    }
    
    const project = await response.json();
    
    // Close modal and redirect to project page
    document.getElementById('newProjectModal').classList.remove('active');
    window.location.href = `/project.html?id=${project.id}`;
  } catch (error) {
    console.error('Error creating project:', error);
    showError('Failed to create project');
  }
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  alert(message); // Simple error handling for now
}
