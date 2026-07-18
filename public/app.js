// Global Application State
const state = {
  token: localStorage.getItem('token') || null,
  email: localStorage.getItem('email') || null,
  coords: null, // { lat, lng }
  usingFallback: false
};

const API_BASE = window.location.origin;

// Leaflet Map Variables
let map = null;
let markersGroup = null;

// Initialize App
function startApp() {
  initAuthUI();
  if (state.token) {
    showMainApp();
  } else {
    showAuthScreen();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

// --- AUTHENTICATION STATE & UI MANAGERS ---

function initAuthUI() {
  const container = document.getElementById('auth-status-container');
  if (state.token && state.email) {
    container.innerHTML = `
      <span class="user-email">${state.email}</span>
      <button class="btn btn-secondary" onclick="handleLogout()">Cerrar Sesión</button>
    `;
  } else {
    container.innerHTML = `
      <span class="text-dark">No has iniciado sesión</span>
    `;
  }
}

function showAuthScreen() {
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('main-view').classList.add('hidden');
  initAuthUI();
}

function showMainApp() {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('main-view').classList.remove('hidden');
  initAuthUI();
  
  // Triggers geolocation and first fetch
  requestLocation();
  fetchCategories();
}

function switchAuthTab(tab) {
  const loginTab = document.getElementById('tab-login');
  const registerTab = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (tab === 'login') {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    loginTab.classList.remove('active');
    registerTab.classList.add('active');
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  }
}

// --- AUTH API HANDLERS ---

async function handleRegister(event) {
  event.preventDefault();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirmPassword = document.getElementById('register-confirm-password').value;
  const errorEl = document.getElementById('register-error');

  errorEl.classList.add('hidden');

  if (password !== confirmPassword) {
    errorEl.textContent = "Las contraseñas no coinciden.";
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al registrarse.');
    }

    // Auto-login after registration
    await performLogin(email, password);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  errorEl.classList.add('hidden');

  try {
    await performLogin(email, password);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function performLogin(email, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Credenciales incorrectas.');
  }

  state.token = data.token;
  state.email = data.email;
  localStorage.setItem('token', data.token);
  localStorage.setItem('email', data.email);

  showMainApp();
}

function handleLogout() {
  state.token = null;
  state.email = null;
  localStorage.removeItem('token');
  localStorage.removeItem('email');
  
  // Clear forms
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
  
  // Reset map if it exists
  if (map) {
    map.remove();
    map = null;
    markersGroup = null;
  }
  
  showAuthScreen();
}

// --- GEOLOCATION MANAGEMENT ---

function requestLocation() {
  const textEl = document.getElementById('location-text');
  textEl.textContent = "Solicitando coordenadas GPS...";
  state.usingFallback = false;

  if (!navigator.geolocation) {
    textEl.textContent = "Tu navegador no soporta geolocalización. Usando Miraflores, Lima (predeterminado).";
    setCoordinates(-12.1213, -77.0296, true);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setCoordinates(position.coords.latitude, position.coords.longitude, false);
    },
    (error) => {
      console.warn('Geolocation failed or denied, using fallback:', error);
      textEl.textContent = "Acceso a la ubicación denegado. Usando Miraflores, Lima (predeterminado).";
      setCoordinates(-12.1213, -77.0296, true);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function setCoordinates(lat, lng, isFallback) {
  state.coords = { lat, lng };
  state.usingFallback = isFallback;
  
  const textEl = document.getElementById('location-text');
  if (!isFallback) {
    textEl.textContent = `Ubicación activa: (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }
  
  // Initialize Leaflet Map
  if (!map) {
    map = L.map('map').setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    markersGroup = L.layerGroup().addTo(map);
  } else {
    map.setView([lat, lng], 15);
  }

  fetchBusinesses();
}

// --- DYNAMIC DATA FETCH & RENDER ---

async function fetchCategories() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    if (!res.ok) return;
    const categories = await res.json();
    
    const select = document.getElementById('filter-category');
    const currentVal = select.value;
    
    select.innerHTML = '<option value="all">Todas las Categorías</option>';
    categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      select.appendChild(option);
    });
    
    if (categories.includes(currentVal)) {
      select.value = currentVal;
    }
  } catch (err) {
    console.error('Error fetching categories:', err);
  }
}

async function fetchBusinesses() {
  if (!state.token || !state.coords) return;

  const spinner = document.getElementById('loading-spinner');
  const emptyState = document.getElementById('empty-state');
  const listContainer = document.getElementById('businesses-list');
  const countEl = document.getElementById('results-count');

  spinner.classList.remove('hidden');
  emptyState.classList.add('hidden');
  listContainer.classList.add('hidden');
  countEl.textContent = '0 encontrados';

  const category = document.getElementById('filter-category').value;
  const minRating = document.getElementById('filter-rating').value;

  try {
    const query = new URLSearchParams({
      lat: state.coords.lat,
      lng: state.coords.lng,
      category: category,
      minRating: minRating
    });

    const res = await fetch(`${API_BASE}/api/businesses?${query}`, {
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    if (res.status === 401 || res.status === 403) {
      handleLogout();
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al cargar los negocios.');
    }

    renderBusinesses(data.businesses);
  } catch (err) {
    console.error('Error in fetchBusinesses:', err);
    listContainer.innerHTML = `<div class="error-message">${err.message}</div>`;
    listContainer.classList.remove('hidden');
  } finally {
    spinner.classList.add('hidden');
  }
}

function renderBusinesses(businesses) {
  const listContainer = document.getElementById('businesses-list');
  const emptyState = document.getElementById('empty-state');
  const countEl = document.getElementById('results-count');

  listContainer.innerHTML = '';
  countEl.textContent = `${businesses.length} encontrados`;

  // Update map markers
  if (markersGroup) {
    markersGroup.clearLayers();
    
    // Add user marker
    L.circleMarker([state.coords.lat, state.coords.lng], {
      radius: 8,
      fillColor: '#3b82f6',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(markersGroup).bindPopup('<b>Tu ubicación</b>');

    // Add business markers
    businesses.forEach(b => {
      const marker = L.marker([b.latitude, b.longitude]).addTo(markersGroup);
      
      const popupHtml = `
        <div style="min-width: 150px;">
          <div class="map-popup-title">${escapeHtml(b.name)}</div>
          <div class="map-popup-category">${escapeHtml(b.category)}</div>
          <div class="map-popup-rating">
            <svg style="width: 12px; height: 12px; fill: #fbbf24; vertical-align: middle; margin-right: 2px;" viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <strong>${b.averageRating.toFixed(1)}</strong>
          </div>
          <a class="map-popup-link" onclick="focusBusinessCard('${b.id}')">Ver en la lista</a>
        </div>
      `;
      marker.bindPopup(popupHtml);
    });
  }

  if (businesses.length === 0) {
    emptyState.classList.remove('hidden');
    listContainer.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  listContainer.classList.remove('hidden');

  businesses.forEach((b, idx) => {
    let distanceStr = '';
    if (b.distance < 1) {
      distanceStr = `${Math.round(b.distance * 1000)} m`;
    } else {
      distanceStr = `${b.distance.toFixed(2)} km`;
    }

    const card = document.createElement('article');
    card.className = 'business-card';
    card.id = `card-${b.id}`;
    card.style.animationDelay = `${idx * 0.05}s`;

    // Render past reviews
    const reviewsHtml = b.reviews && b.reviews.length > 0
      ? b.reviews.map(r => `
          <div class="review-item">
            <div class="review-meta">
              <span class="review-user">${escapeHtml(r.userEmail)}</span>
              <span class="review-date">${new Date(r.createdAt).toLocaleDateString('es-PE')}</span>
            </div>
            <p class="review-comment">"${escapeHtml(r.comment)}"</p>
            <div class="review-ratings">
              <span>Calidad: <strong>${r.ratings.foodQuality}</strong></span>
              <span>Servicio: <strong>${r.ratings.service}</strong></span>
              <span>Precio: <strong>${r.ratings.price}</strong></span>
            </div>
          </div>
        `).join('')
      : `<p class="text-dark" style="font-size: 0.9rem; font-style: italic; margin-bottom: 0.5rem;">No hay opiniones todavía. ¡Sé el primero en compartir tu experiencia!</p>`;

    // Render review form
    const formHtml = `
      <div class="review-form-container">
        <div class="review-form-title">Comparte tu experiencia</div>
        <form class="review-form" onsubmit="submitReview(event, '${b.id}')">
          <div class="form-row">
            <div class="form-subgroup">
              <label>Calidad</label>
              <select name="foodQuality" required>
                <option value="5">5 - Excelente</option>
                <option value="4">4 - Bueno</option>
                <option value="3">3 - Regular</option>
                <option value="2">2 - Malo</option>
                <option value="1">1 - Pésimo</option>
              </select>
            </div>
            <div class="form-subgroup">
              <label>Servicio</label>
              <select name="service" required>
                <option value="5">5 - Excelente</option>
                <option value="4">4 - Bueno</option>
                <option value="3">3 - Regular</option>
                <option value="2">2 - Malo</option>
                <option value="1">1 - Pésimo</option>
              </select>
            </div>
            <div class="form-subgroup">
              <label>Precio</label>
              <select name="price" required>
                <option value="5">5 - Muy Barato</option>
                <option value="4">4 - Económico</option>
                <option value="3">3 - Regular</option>
                <option value="2">2 - Caro</option>
                <option value="1">1 - Muy Caro</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <textarea name="comment" placeholder="Cuéntanos cómo fue tu experiencia... (opcional)"></textarea>
          </div>
          <button type="submit" class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.8rem; align-self: flex-end;">Publicar Opinión</button>
        </form>
      </div>
    `;

    card.innerHTML = `
      <div class="card-left">
        <span class="category-tag">${escapeHtml(b.category)}</span>
        <h3 class="business-name">${escapeHtml(b.name)}</h3>
        <div class="metrics-row">
          <div class="metric-item">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
            <span>Distancia: <strong>${distanceStr}</strong></span>
          </div>
          <div class="metric-item" title="Tiempo estimado a pie">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            <span>A pie: <strong>${b.walkingTime} min</strong></span>
          </div>
          <div class="metric-item" title="Tiempo estimado en auto">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>En auto: <strong>${b.drivingTime} min</strong></span>
          </div>
        </div>
      </div>
      
      <div class="card-right">
        <div class="avg-rating-badge" title="Valoración promedio">
          <svg class="icon" viewBox="0 0 24 24">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
          <span>${b.averageRating.toFixed(1)}</span>
        </div>
        <div class="detailed-ratings">
          <div class="rating-bar">
            <span class="rating-bar-label">Calidad de comida:</span>
            <span class="rating-bar-value">${b.ratings.foodQuality.toFixed(1)}</span>
          </div>
          <div class="rating-bar">
            <span class="rating-bar-label">Servicio:</span>
            <span class="rating-bar-value">${b.ratings.service.toFixed(1)}</span>
          </div>
          <div class="rating-bar">
            <span class="rating-bar-label">Precio:</span>
            <span class="rating-bar-value">${b.ratings.price.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <button class="btn-toggle-reviews" onclick="toggleReviews('${b.id}')">
        Opiniones e Historias (${b.reviews ? b.reviews.length : 0})
      </button>

      <div id="drawer-${b.id}" class="reviews-drawer hidden">
        <div class="reviews-header">Experiencias de la Comunidad</div>
        <div class="reviews-list">
          ${reviewsHtml}
        </div>
        ${formHtml}
      </div>
    `;

    listContainer.appendChild(card);
  });
}

function toggleReviews(businessId) {
  const drawer = document.getElementById(`drawer-${businessId}`);
  if (drawer) {
    drawer.classList.toggle('hidden');
  }
}

async function submitReview(event, businessId) {
  event.preventDefault();
  const form = event.target;
  const comment = form.elements.comment.value.trim();
  const foodQuality = parseFloat(form.elements.foodQuality.value);
  const service = parseFloat(form.elements.service.value);
  const price = parseFloat(form.elements.price.value);

  try {
    const res = await fetch(`${API_BASE}/api/businesses/${businessId}/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        comment,
        ratings: { foodQuality, service, price }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al enviar la reseña.');
    }

    // Refresh businesses
    await fetchBusinesses();
    
    // Automatically reopen the review drawer for this business
    setTimeout(() => {
      const drawer = document.getElementById(`drawer-${businessId}`);
      if (drawer) {
        drawer.classList.remove('hidden');
      }
    }, 150);

  } catch (err) {
    alert(err.message);
  }
}

function focusBusinessCard(businessId) {
  const el = document.getElementById(`card-${businessId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Highlight effect
    el.style.borderColor = 'var(--primary)';
    el.style.boxShadow = 'var(--shadow-glow)';
    setTimeout(() => {
      el.style.borderColor = '';
      el.style.boxShadow = '';
    }, 2000);
  }
}

// Helper to escape HTML tags to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
