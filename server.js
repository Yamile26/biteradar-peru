const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'food-discoverer-secret-key-2026';
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions for reading/writing db.json
function readDb() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database file, returning empty structure:', err);
    return { users: [], businesses: [] };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing database file:', err);
  }
}

// Haversine formula to calculate distance in km
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. Token missing.' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Access denied. Invalid token.' });
    }
    req.user = user;
    next();
  });
}

// --- AUTHENTICATION ENDPOINTS ---

// Register User
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = readDb();
  const existingUser = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (existingUser) {
    return res.status(400).json({ error: 'User already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const newUser = {
    id: 'u_' + Math.random().toString(36).substr(2, 9),
    email: email.toLowerCase(),
    passwordHash
  };

  db.users.push(newUser);
  writeDb(db);

  res.status(201).json({ message: 'User registered successfully.' });
});

// Login User
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = readDb();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '24h' });

  res.json({ token, email: user.email });
});

// --- FOOD BUSINESS ENDPOINTS ---

// Get Food Businesses (Requires authentication)
app.get('/api/businesses', authenticateToken, (req, res) => {
  const db = readDb();
  
  // Geolocation params - fallback to Lima (Plaza Kennedy, Miraflores) if not provided
  const userLat = parseFloat(req.query.lat) || -12.1213;
  const userLng = parseFloat(req.query.lng) || -77.0296;
  
  const categoryFilter = req.query.category; // string
  const minRatingFilter = parseFloat(req.query.minRating) || 0;

  // Process businesses
  let list = db.businesses.map(b => {
    // 1. Calculate distance (km)
    const distance = calculateDistance(userLat, userLng, b.latitude, b.longitude);
    
    // 2. Average rating (foodQuality + service + price) / 3
    const avgRating = parseFloat(((b.ratings.foodQuality + b.ratings.service + b.ratings.price) / 3).toFixed(1));
    
    // 3. Travel time: assume walking at 5 km/h (12 mins per km), driving at 30 km/h (2 mins per km)
    const walkingTime = Math.round(distance * 12);
    const drivingTime = Math.round(distance * 2) || 1; // minimum 1 minute

    return {
      ...b,
      distance: parseFloat(distance.toFixed(2)),
      averageRating: avgRating,
      walkingTime,
      drivingTime
    };
  });

  // Apply Category Filter
  if (categoryFilter && categoryFilter.toLowerCase() !== 'all') {
    list = list.filter(b => b.category.toLowerCase() === categoryFilter.toLowerCase());
  }

  // Apply Rating Filter
  if (minRatingFilter > 0) {
    list = list.filter(b => b.averageRating >= minRatingFilter);
  }

  // Sort by highest rating descending
  list.sort((a, b) => b.averageRating - a.averageRating);

  res.json({
    userLocation: { lat: userLat, lng: userLng },
    businesses: list
  });
});

// Post a new review / experience (Requires authentication)
app.post('/api/businesses/:id/reviews', authenticateToken, (req, res) => {
  const businessId = req.params.id;
  const { comment, ratings } = req.body;

  if (!ratings || ratings.foodQuality === undefined || ratings.service === undefined || ratings.price === undefined) {
    return res.status(400).json({ error: 'Faltan las valoraciones de calidad de comida, servicio o precio.' });
  }

  const db = readDb();
  const business = db.businesses.find(b => b.id === businessId);

  if (!business) {
    return res.status(404).json({ error: 'Negocio no encontrado.' });
  }

  if (!business.reviews) {
    business.reviews = [];
  }

  // Create new review
  const newReview = {
    id: 'r_' + Math.random().toString(36).substr(2, 9),
    userEmail: req.user.email,
    comment: comment || '',
    ratings: {
      foodQuality: parseFloat(ratings.foodQuality),
      service: parseFloat(ratings.service),
      price: parseFloat(ratings.price)
    },
    createdAt: new Date().toISOString()
  };

  business.reviews.push(newReview);

  // Recalculate ratings
  const count = business.reviews.length;
  let sumFood = 0;
  let sumService = 0;
  let sumPrice = 0;

  business.reviews.forEach(rev => {
    sumFood += rev.ratings.foodQuality;
    sumService += rev.ratings.service;
    sumPrice += rev.ratings.price;
  });

  business.ratings = {
    foodQuality: parseFloat((sumFood / count).toFixed(1)),
    service: parseFloat((sumService / count).toFixed(1)),
    price: parseFloat((sumPrice / count).toFixed(1))
  };

  writeDb(db);

  res.status(201).json({
    message: 'Reseña agregada con éxito.',
    review: newReview,
    updatedRatings: business.ratings
  });
});

// Get Categories List (Helper endpoint for filters)
app.get('/api/categories', (req, res) => {
  const db = readDb();
  const categories = [...new Set(db.businesses.map(b => b.category))];
  res.json(categories);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
