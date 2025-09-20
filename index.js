require('dotenv').config();

const express = require('express');
const mysql = require("mysql2");
const cors = require("cors");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");

const app = express();
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
app.use(cors());
app.use(express.json());

// Firebase Auth middleware
function authenticateCitizen(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    admin.auth().verifyIdToken(idToken)
        .then(decodedToken => {
            req.user = decodedToken.uid; // Only set user id
            next();
        })
        .catch(() => {
            res.status(401).json({ error: 'Invalid or expired token' });
        });
}

//Routes
const apiRouter = require('./routes/api');

// Apply auth middleware to all /api routes
app.use('/api', authenticateCitizen, apiRouter);

db.connect(function(err) {
    if (err) {
        console.error("Error connecting to database:", err);
        return;
    }
    console.log("Connected to database");
    app.listen(process.env.PORT, function() {
        console.log("Server is running");
    });
});