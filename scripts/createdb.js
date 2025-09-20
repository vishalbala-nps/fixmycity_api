require('dotenv').config({path: '../.env'});

const mysql = require("mysql2");
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect(function(err) {
    if (err) {
        console.error("Error connecting to database:", err);
        return;
    }

    console.log("Connected to database");

    const tables = [
        `CREATE TABLE IF NOT EXISTS Admin (
            id INT PRIMARY KEY
        )`,
        `CREATE TABLE IF NOT EXISTS Reports (
            id INT AUTO_INCREMENT PRIMARY KEY,
            dateofreport DATE NOT NULL,
            type VARCHAR(100) NOT NULL,
            description TEXT,
            location POINT,
            count INT DEFAULT 1,
            status VARCHAR(50) DEFAULT 'Pending'
        )`,
        `CREATE TABLE IF NOT EXISTS UserReports (
            user INT,
            report INT,
            imagename VARCHAR(255),
            FOREIGN KEY (report) REFERENCES Reports(id)
        )`
    ];

    let created = 0;
    tables.forEach((sql, idx) => {
        db.query(sql, function(err, result) {
            if (err) {
                console.error(`Error creating table ${idx + 1}:`, err);
            } else {
                console.log(`Table ${idx + 1} created or already exists.`);
            }
            created++;
            if (created === tables.length) {
                db.end();
            }
        });
    });
});