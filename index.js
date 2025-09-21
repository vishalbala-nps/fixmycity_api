require('dotenv').config();

const express = require('express');
const cors = require("cors");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");
const db = require('./db'); // Import db from db.js

const app = express();
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
const issueRouter = require('./routes/api');

// Apply auth middleware to all /api routes
app.use('/api/issue', authenticateCitizen, issueRouter);

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