const express = require('express');
const router = express.Router();
const multer = require('multer');
const {GoogleGenAI,Type} = require("@google/genai")
const db = require('../db'); // Import the shared db connection
const fs = require("fs");
const path = require('path');
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
const storage = multer({ dest: path.join(__dirname,"..",'uploads') });

const dupradii = 100; // in meters

/**
 * @openapi
 * /api/issue/summary:
 *   get:
 *     summary: Get issue summary with image and location
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               lat:
 *                 type: number
 *               lon:
 *                 type: number
 *     responses:
 *       200:
 *         description: Issue summary with duplicate check
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 description:
 *                   type: string
 *                 category:
 *                   type: string
 *                   enum: ["Pothole", "Streetlight", "Garbage", "Water Stagnation", "Other"]
 *                 department:
 *                   type: string
 *                   enum: ["Department of Drinking Water and Sanitation", "Department of Rural Works", "Department of Road Construction", "Department of Energy", "Department of Health, Medical Education & Family Welfare"]
 *                 duplicate:
 *                   type: boolean
 *                 image:
 *                   type: string
 *                 report:
 *                   type: integer
 *                   nullable: true
 *       400:
 *         description: Bad request (missing image or lat/lon)
 *       500:
 *         description: Database or Gemini error
 */
router.get('/summary', storage.single("image"), (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Request body is required' });
  }
  const { lat, lon } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (typeof lat === 'undefined' || typeof lon === 'undefined') {
    // Delete the uploaded file if lat/lon are missing
    fs.unlink(req.file.path, () => {
      return res.status(400).json({ error: 'lat and lon are required' });
    });
    return;
  }
  const base64 = fs.readFileSync(req.file.path, {encoding: "base64"});
  let prompt;
  let dupid = 0;
  // Only consider reports within 20 meters using ST_Distance_Sphere
  db.query(
    `SELECT id, description, category
     FROM Reports 
     WHERE status IN('submitted','progress') 
     AND ST_Distance_Sphere(location, POINT(?, ?)) <= ?`,
    [lon, lat, dupradii],
    function(err, results) {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({ error: 'Database error' });
      } else {
        if (results.length === 0) {
          console.log("No nearby reports found.");
          prompt = "This is a civic issue reporting system. Describe the issue in detail to report it and specify which category and department does it come under. Also set duplicate to false";
        } else {
          console.log("Found nearby report");
          dupid = results[0].id;
          prompt = "This is a civic issue reporting system. Check if this image matches the description '" + results[0].description + "' and category '" + results[0].category + "'. If it does, set duplicate to true. If false, describe the issue in detail to report, categorise and specify which department does it come under.";
        }
        console.log("Calling Gemini with prompt:", prompt);
        ai.models.generateContent({
          model: "gemini-2.0-flash-001",
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                description: {
                  type: Type.STRING
                },
                category: {
                  type: Type.STRING,
                  enum: ["Pothole", "Streetlight", "Garbage", "Water Stagnation", "Other"]
                },
                department: {
                  type: Type.STRING,
                  enum: ["Department of Drinking Water and Sanitation", "Department of Rural Works", "Department of Road Construction", "Department of Energy", "Department of Health, Medical Education & Family Welfare"]
                },
                duplicate: {
                  type: Type.BOOLEAN
                }
              },
              required: ["description", "category", "duplicate", "department"]
            }
          },
          contents: [{
            inlineData: {
              mimeType: req.file.mimetype,
              data: base64
            }
          }, { text: prompt }]
        }).then(function(r) {
          let rjson = JSON.parse(r.text);
          rjson.image = req.file.filename;
          if (rjson.duplicate === true) {
            rjson.report = dupid;
          }
          return res.status(200).json(rjson);
        }).catch(function(err) {
          console.error("Error generating content:", err);
          return res.status(500).json({ error: 'Error generating content' });
        });
      }
    }
  );
});

/**
 * @openapi
 * /api/issue:
 *   post:
 *     summary: Report a new issue or mark as duplicate
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               duplicate:
 *                 type: boolean
 *               image:
 *                 type: string
 *               report:
 *                 type: integer
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               department:
 *                 type: string
 *                 enum: ["Department of Drinking Water and Sanitation", "Department of Rural Works", "Department of Road Construction", "Department of Energy", "Department of Health, Medical Education & Family Welfare"]
 *               lat:
 *                 type: number
 *               lon:
 *                 type: number
 *     responses:
 *       201:
 *         description: Issue reported or duplicate marked
 *       400:
 *         description: Bad request
 *       500:
 *         description: Database error
 */
router.post('/', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is required' });
  }
  const { duplicate, image, report, description, category, department, lat, lon } = req.body;

  if (typeof duplicate === 'undefined' || !image) {
    return res.status(400).json({ error: 'duplicate and image are required' });
  }

  if (duplicate === true || duplicate === 'true') {
    // Duplicate: require report id
    if (!report) {
      return res.status(400).json({ error: 'report is required for duplicate issues' });
    }
    // Increment count in Reports and insert into UserReports
    db.query(
      "UPDATE Reports SET count = count + 1 WHERE id = ?",
      [report],
      function(err, updateResult) {
        if (err) {
          console.error("Database update error:", err);
          return res.status(500).json({ error: 'Database error' });
        }
        db.query(
          "INSERT INTO UserReports (user, report, imagename) VALUES (?, ?, ?)",
          [req.user, report, image],
          function(err2, result) {
            if (err2) {
              console.error("Database insert error:", err2);
              return res.status(500).json({ error: 'Database error' });
            }
            return res.status(201).json({ message: 'Duplicate issue reported', reportId: report, image });
          }
        );
      }
    );
  } else {
    // Not duplicate: require description, category, department, latitude, longitude
    if (!description || !category || !department || typeof lat === 'undefined' || typeof lon === 'undefined') {
      return res.status(400).json({ error: 'description, category, department, lat, and lon are required for new issues' });
    }
    // Insert into Reports
    db.query(
      "INSERT INTO Reports (dateofreport, category, description, department, location, count, status) VALUES (CURDATE(), ?, ?, ?, POINT(?,?), 1, 'submitted')",
      [category, description, department, lon, lat],
      function(err, result) {
        if (err) {
          console.error("Database insert error:", err);
          return res.status(500).json({ error: 'Database error' });
        }
        const newReportId = result.insertId;
        // Insert into UserReports
        db.query(
          "INSERT INTO UserReports (user, report, imagename) VALUES (?, ?, ?)",
          [req.user, newReportId, image],
          function(err2, result2) {
            if (err2) {
              console.error("Database insert error:", err2);
              return res.status(500).json({ error: 'Database error' });
            }
            return res.status(201).json({ message: 'Issue reported', reportId: newReportId, image });
          }
        );
      }
    );
  }
});

/**
 * @openapi
 * /api/issue:
 *   get:
 *     summary: Get all issues (with optional filter)
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [all, user]
 *         description: Filter issues (all or only for the logged-in user)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [submitted, progress, complete, rejected]
 *         description: Filter issues by status
 *     responses:
 *       200:
 *         description: List of issues
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer }
 *                   dateofreport: { type: string }
 *                   category: { type: string }
 *                   description: { type: string }
 *                   department:
 *                     type: string
 *                     enum: ["Department of Drinking Water and Sanitation", "Department of Rural Works", "Department of Road Construction", "Department of Energy", "Department of Health, Medical Education & Family Welfare"]
 *                   count: { type: integer }
 *                   status: { type: string }
 *                   lat: { type: number }
 *                   lon: { type: number }
 *                   images:
 *                     type: array
 *                     items: { type: string }
 *                   resolved:
 *                     type: object
 *                     properties:
 *                       dateofresolution: { type: string }
 *                       image: { type: string }
 *                       remarks: { type: string }
 *                     description: Present only if the issue is resolved
 *       500:
 *         description: Database error
 */
router.get('/', (req, res) => {
  const { filter, status } = req.query;
  let sql = `
    SELECT 
      id, 
      dateofreport, 
      category, 
      description, 
      department,
      count, 
      status, 
      lat,
      lon,
      images,
      users,
      dateofresolution,
      resolved_image,
      resolved_remarks
    FROM IssueView
    `;
  const params = [];

  const conditions = [];
  if (filter === 'user') {
    conditions.push('FIND_IN_SET(?, users)');
    params.push(req.user);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY dateofreport DESC';

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({ error: 'Database error' });
    }
    const formatted = results.map(r => {
      const base = {
        id: r.id,
        dateofreport: r.dateofreport,
        category: r.category,
        description: r.description,
        department: r.department,
        count: r.count,
        status: r.status,
        lat: r.lat,
        lon: r.lon,
        images: r.images ? r.images.split(',') : []
        // users field intentionally omitted from response
      };
      if (r.dateofresolution) {
        base.resolved = {
          dateofresolution: r.dateofresolution,
          image: r.resolved_image,
          remarks: r.resolved_remarks
        };
      }
      return base;
    });
    res.json(formatted);
  });
});

module.exports = router;