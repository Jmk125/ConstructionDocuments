const API_BASE = 'http://localhost:3000/api';

// Load projects on page load
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('newProjectBtn').addEventListener('click', () => {
        document.getElementById('newProjectModal').classList.add('active');
    });

    document.getElementById('newProjectForm').addEventListener('submit', createProject);
}

function closeModal() {
    document.getElementById('newProjectModal').classList.remove('active');
    document.getElementById('newProjectForm').reset();
}

async function loadProjects() {
    try {
        const response = await fetch(`${API_BASE}/projects`);
        const projects = await response.json();
        displayProjects(projects);
    } catch (error) {
        console.error('Error loading projects:', error);
        document.getElementById('projectsList').innerHTML = '<p class="error">Error loading projects</p>';
    }
}

function displayProjects(projects) {
    const container = document.getElementById('projectsList');
    
    if (projects.length === 0) {
        container.innerHTML = '<p class="empty-state">No projects yet. Create your first project to get started!</p>';
        return;
    }

    container.innerHTML = projects.map(project => `
        <div class="project-card" onclick="openProject(${project.id})">
            <h3>${escapeHtml(project.name)}</h3>
            <p>${escapeHtml(project.description || 'No description')}</p>
            <div class="project-meta">
                <span>Created ${formatDate(project.created_at)}</span>
            </div>
            <button class="btn btn-danger" onclick="deleteProject(event, ${project.id})" style="margin-top: 1rem;">Delete</button>
        </div>
    `).join('');
}

async function createProject(e) {
    e.preventDefault();
    
    const name = document.getElementById('projectName').value;
    const description = document.getElementById('projectDescription').value;

    try {
        const response = await fetch(`${API_BASE}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });

        if (!response.ok) throw new Error('Failed to create project');

        closeModal();
        loadProjects();
    } catch (error) {
        console.error('Error creating project:', error);
        alert('Error creating project');
    }
}

async function deleteProject(event, projectId) {
    event.stopPropagation(); // Prevent opening the project

    if (!confirm('Are you sure you want to delete this project? This will delete all associated documents and chats.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete project');

        loadProjects();
    } catch (error) {
        console.error('Error deleting project:', error);
        alert('Error deleting project');
    }
}

function openProject(projectId) {
    window.location.href = `/project.html?id=${projectId}`;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
