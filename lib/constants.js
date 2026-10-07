const path = require('path');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const ALL_CATEGORIES = [
  { id: 'country', name: 'Country' },
  { id: 'city', name: 'City' },
  { id: 'animal', name: 'Animal' },
  { id: 'food', name: 'Food' },
  { id: 'color', name: 'Colour' },
  { id: 'name', name: 'Name' },
  { id: 'object', name: 'Object' },
  { id: 'plant', name: 'Plant' },
  { id: 'brand', name: 'Brand' },
  { id: 'movie', name: 'Movie' },
  { id: 'book', name: 'Book' },
  { id: 'river', name: 'River' }
];

module.exports = {
  PORT,
  DATA_DIR,
  USERS_FILE,
  ALL_CATEGORIES
};