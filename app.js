const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Middleware pour gérer les requêtes JSON et les problèmes CORS
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// Configuration de la connexion à PostgreSQL
const pool = new Pool({
  user: "qrap_user",
  host: "localhost",
  database: "qrap",
  password: "%*7eYBr[p3Nf84",
  port: 5432,
});

// Configuration de Multer pour le stockage temporaire des fichiers
const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads/", // Dossier où les fichiers seront stockés
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`), // Générer un nom temporaire unique pour chaque fichier
  }),
});

// Créer le dossier "uploads" si nécessaire
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// Fonction pour nettoyer la description
function cleanFilename(filename) {
  return filename.replace(/[<>:"\/\\|?*]+/g, ""); // Remplace tous les caractères spéciaux par une chaîne vide
}

// Fonction pour renommer et enregistrer les fichiers
function processUploadedFiles(files, formData, typePrefix) {
  return files.map((file, index) => {
    const photoIndex = index === 0 ? "photo1" : "photo2";

    // Nettoyer la description avant de l'utiliser
    const cleanedDescription = cleanFilename(formData.description);

    const newFilename = `${typePrefix}.${
      formData.numero
    }.${cleanedDescription}.${photoIndex}${path.extname(file.originalname)}`;
    const newPath = path.join("uploads", newFilename);

    fs.renameSync(file.path, newPath); // Renommer le fichier
    return newPath.replace(/\\/g, "/"); // Utiliser les slashs pour éviter les problèmes de chemin
  });
}

// Fonction pour formater l'heure
const formatTime = (time) => (time.length === 5 ? `${time}:00` : time);

// Route pour récupérer l'historique des 7 derniers jours du formulaire de sécurité
app.get("/api/history", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * 
      FROM form_data_security 
      WHERE submission_time >= NOW() - INTERVAL '7 days' 
      ORDER BY numero ASC
    `);
    res.json(result.rows || []); // Retourner un tableau vide s'il n'y a pas de données
  } catch (err) {
    console.error(
      "Erreur lors de la récupération de l'historique :",
      err.message
    );
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des données." });
  }
});

// Route pour récupérer l'historique des 7 derniers jours du formulaire de panne machine
app.get("/api/machine-breakdown-history", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * 
      FROM form_data_machine_breakdown 
      WHERE submission_time >= NOW() - INTERVAL '7 days' 
      ORDER BY numero ASC
    `);
    res.json(result.rows || []); // Retourner un tableau vide s'il n'y a pas de données
  } catch (err) {
    console.error(
      "Erreur lors de la récupération de l'historique des pannes machines :",
      err.message
    );
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des données." });
  }
});

// Route pour soumettre le formulaire avec des photos (sécurité)
app.post("/api/form-submit", upload.array("photos", 2), async (req, res) => {
  try {
    const formData = JSON.parse(req.body.formDataSecurity || "{}"); // Extraire les données du formulaire
    const sortingData = JSON.parse(req.body.sortingData || "{}"); // Extraire les données de tri
    const files = req.files;

    // Vérification des champs obligatoires
    if (!formData.numero || !formData.description) {
      return res.status(400).json({
        error: "Les champs 'numero' et 'description' sont obligatoires.",
      });
    }

    // Utiliser le préfixe "security" pour les fichiers de sécurité
    formData.photos = processUploadedFiles(files, formData, "security");
    const time = formatTime(formData.time);

    // Requête SQL pour insérer les données dans la base
    const query = `
      INSERT INTO form_data_security 
      (numero, description, date, time, similar_issues, combien, name, location, alert_contacts, securisation, immediate_actions, sorting_data, submission_time, photos)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;

    const values = [
      formData.numero,
      formData.description,
      formData.date,
      time, // Heure corrigée
      JSON.stringify(formData.similarIssues || []), // Sérialiser les données JSON
      formData.combien,
      formData.name,
      formData.location,
      formData.alertContacts || [], // Tableau vide par défaut si aucune alerte
      formData.securisation,
      JSON.stringify(formData.immediateActions || []), // Sérialiser les actions immédiates
      JSON.stringify(sortingData), // Sérialiser les données de tri
      new Date().toISOString(), // Timestamp de soumission
      formData.photos, // Chemins des photos traitées
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]); // Retourner les données insérées
  } catch (err) {
    console.error("Erreur lors de l'insertion des données :", err.message);
    res.status(500).json({ error: "Erreur lors de l'insertion des données." });
  }
});

// Route pour soumettre le formulaire de panne machine
app.post(
  "/api/machine-breakdown-submit",
  upload.array("photos", 2),
  async (req, res) => {
    try {
      const formData = JSON.parse(req.body.formDataMachineBreakdown || "{}"); // Extraire les données du formulaire
      const sortingData = JSON.parse(req.body.sortingData || "{}"); // Extraire les données de tri
      const files = req.files;

      // Vérification des champs obligatoires
      if (!formData.numero || !formData.description) {
        return res.status(400).json({
          error: "Les champs 'numero' et 'description' sont obligatoires.",
        });
      }

      // Utiliser le préfixe "breakdown" pour les fichiers de panne machine
      formData.photos = processUploadedFiles(files, formData, "breakdown");
      const time = formatTime(formData.time);

      // Requête SQL pour insérer les données dans la table de pannes machines
      const query = `
      INSERT INTO form_data_machine_breakdown 
      (numero, description, date, time, similar_issues, combien, name, location, alert_contacts, immediate_actions, sorting_data, submission_time, photos)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;

      const values = [
        formData.numero,
        formData.description,
        formData.date,
        time, // Heure corrigée
        JSON.stringify(formData.similarIssues || []), // Sérialiser les données JSON
        formData.combien,
        formData.name,
        formData.location,
        formData.alertContacts || [], // Tableau vide par défaut
        JSON.stringify(formData.immediateActions || []), // Sérialiser les actions immédiates
        JSON.stringify(sortingData), // Sérialiser les données de tri
        new Date().toISOString(), // Timestamp de soumission
        formData.photos, // Chemins des photos traitées
      ];

      const result = await pool.query(query, values);
      res.status(201).json(result.rows[0]); // Retourner les données insérées
    } catch (err) {
      console.error("Erreur lors de l'insertion des données :", err.message);
      res
        .status(500)
        .json({ error: "Erreur lors de l'insertion des données." });
    }
  }
);

// Route pour soumettre les mesures SPC avec nom et référence de la pièce
app.post("/api/submit-measurements", async (req, res) => {
  try {
    const { pieceName, pieceReference, measurements } = req.body; // Récupérer le nom, référence et lot de mesures

    const query = `
      INSERT INTO spc_measurement_batches (piece_name, piece_reference, measurements)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;

    const values = [pieceName, pieceReference, JSON.stringify(measurements)]; // Sérialiser les mesures en JSON
    const result = await pool.query(query, values);

    res.status(201).json(result.rows[0]); // Retourner les données insérées
  } catch (err) {
    console.error("Erreur lors de l'insertion des mesures :", err.message);
    res.status(500).json({ error: "Erreur lors de l'insertion des mesures." });
  }
});
// Lancer le serveur sur le port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur backend en cours d'exécution sur le port ${PORT}`);
});
