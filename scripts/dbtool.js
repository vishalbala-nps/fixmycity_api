require('dotenv').config({ path: '../.env' });

const mysql = require("mysql2");

const dbName = process.env.DB_NAME;

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

const schema = [
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\``,
    `USE \`${dbName}\``,
    `CREATE TABLE IF NOT EXISTS Admin (
        id VARCHAR(80) PRIMARY KEY
    )`,
    `CREATE TABLE IF NOT EXISTS Reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        dateofreport DATE NOT NULL,
        type ENUM('Pothole', 'Streetlight', 'Garbage', 'Water Stagnation', 'Other') NOT NULL,
        description TEXT,
        location POINT,
        count INT DEFAULT 1,
        status ENUM('submitted', 'progress', 'complete', 'rejected') DEFAULT 'submitted',
        department ENUM(
            'Department of Drinking Water and Sanitation',
            'Department of Rural Works',
            'Department of Road Construction',
            'Department of Energy',
            'Department of Health, Medical Education & Family Welfare'
        )
    )`,
    `CREATE TABLE IF NOT EXISTS UserReports (
        user VARCHAR(80),
        report INT,
        imagename VARCHAR(255),
        FOREIGN KEY (report) REFERENCES Reports(id)
    )`,
    `CREATE TABLE IF NOT EXISTS ResolvedIssues (
        report INT,
        dateofresolution DATE NOT NULL,
        image VARCHAR(255),
        remarks TEXT,
        FOREIGN KEY (report) REFERENCES Reports(id)
    )`,
    `CREATE OR REPLACE VIEW IssueView AS
      SELECT 
        Reports.id, 
        Reports.dateofreport, 
        Reports.type, 
        Reports.description, 
        Reports.department,
        Reports.count, 
        Reports.status, 
        ST_Y(Reports.location) AS lat,
        ST_X(Reports.location) AS lon,
        GROUP_CONCAT(UserReports.imagename) AS images,
        GROUP_CONCAT(UserReports.user) AS users,
        MAX(ResolvedIssues.dateofresolution) AS dateofresolution,
        MAX(ResolvedIssues.image) AS resolved_image,
        MAX(ResolvedIssues.remarks) AS resolved_remarks
      FROM Reports
      LEFT JOIN UserReports ON Reports.id = UserReports.report
      LEFT JOIN ResolvedIssues ON Reports.id = ResolvedIssues.report
      GROUP BY Reports.id`
];

function runQueries(queries, cb) {
    let i = 0;
    function next(err) {
        if (err || i === queries.length) return cb(err);
        connection.query(queries[i++], next);
    }
    next();
}

const action = process.argv[2];

if (action === 'create') {
    runQueries(schema, err => {
        if (err) {
            console.error("Error creating schema:", err);
        } else {
            console.log("Database, tables, and views created.");
        }
        connection.end();
    });
} else if (action === 'clear') {
    connection.changeUser({ database: dbName }, err => {
        if (err) {
            console.error("Error selecting database:", err);
            connection.end();
            return;
        }
        const clearQueries = [
            "DELETE FROM UserReports",
            "DELETE FROM Reports",
            "DELETE FROM Admin"
        ];
        runQueries(clearQueries, err => {
            if (err) {
                console.error("Error clearing data:", err);
            } else {
                console.log("All data deleted from tables.");
            }
            connection.end();
        });
    });
} else if (action === 'drop') {
    connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``, err => {
        if (err) {
            console.error("Error dropping database:", err);
        } else {
            console.log("Database dropped.");
        }
        connection.end();
    });
} else if (action === 'addadmin') {
    const adminId = process.argv[3];
    if (!adminId) {
        console.error("Please provide an admin id. Usage: node dbtool.js addadmin <adminId>");
        connection.end();
        return;
    }
    connection.changeUser({ database: dbName }, err => {
        if (err) {
            console.error("Error selecting database:", err);
            connection.end();
            return;
        }
        connection.query(
            "INSERT INTO Admin (id) VALUES (?)",
            [adminId],
            (err, result) => {
                if (err) {
                    console.error("Error adding admin:", err);
                } else {
                    console.log(`Admin user '${adminId}' added.`);
                }
                connection.end();
            }
        );
    });
} else {
    console.log("Usage: node dbtool.js [create|clear|drop|addadmin <adminId>]");
    connection.end();
}
