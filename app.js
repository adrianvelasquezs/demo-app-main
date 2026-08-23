const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");

const app = express();
const PORT = process.env.PORT || 8080;
const REGION = process.env.AWS_REGION || "us-east-1";

// Estas dos variables si son env vars normales (no son secretas):
// - SECRET_NAME: el nombre del secreto en Secrets Manager (ej. "demo-app/db-credentials")
// - S3_BUCKET: el nombre de tu bucket
const SECRET_NAME = process.env.SECRET_NAME;
const S3_BUCKET = process.env.S3_BUCKET;

const secretsClient = new SecretsManagerClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });
const publicDir = path.join(__dirname, "public");

app.use(express.static(publicDir));
app.use(express.json({ limit: "1mb" }));

// Cacheamos el secreto en memoria para no llamar a Secrets Manager en cada request
// (cada llamada a GetSecretValue tiene un costo pequeno pero real).
let cachedDbConfig = null;

async function getDbConfig() {
  if (cachedDbConfig) return cachedDbConfig;

  const command = new GetSecretValueCommand({ SecretId: SECRET_NAME });
  const response = await secretsClient.send(command);
  const secret = JSON.parse(response.SecretString);

  cachedDbConfig = {
    host: secret.host,
    port: secret.port || 3306,
    user: secret.username,
    password: secret.password,
    database: secret.dbname,
    connectTimeout: 5000,
  };
  return cachedDbConfig;
}

async function ensureNotesTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS demo_notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      note_text VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// 1) UI simple para probar los endpoints desde el navegador.
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Health check simple: no depende de RDS ni de Secrets Manager.
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "La app esta corriendo detras del ALB y Beanstalk",
    timestamp: new Date().toISOString(),
  });
});

// 2) API interactiva de DB para crear y listar notas.
app.get("/api/db/notes", async (req, res) => {
  let connection;
  try {
    const dbConfig = await getDbConfig();
    connection = await mysql.createConnection(dbConfig);
    await ensureNotesTable(connection);

    const [rows] = await connection.query(
      "SELECT id, note_text, created_at FROM demo_notes ORDER BY id DESC LIMIT 20",
    );

    res.status(200).json({
      status: "ok",
      notes: rows,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo la consulta de notas en DB",
      error: err.message,
    });
  } finally {
    if (connection) await connection.end();
  }
});

app.post("/api/db/notes", async (req, res) => {
  let connection;
  const noteText = String(req.body?.noteText || "").trim();

  if (!noteText) {
    return res.status(400).json({
      status: "error",
      message: "noteText es obligatorio",
    });
  }

  if (noteText.length > 255) {
    return res.status(400).json({
      status: "error",
      message: "noteText no puede superar 255 caracteres",
    });
  }

  try {
    const dbConfig = await getDbConfig();
    connection = await mysql.createConnection(dbConfig);
    await ensureNotesTable(connection);

    const [result] = await connection.query(
      "INSERT INTO demo_notes (note_text) VALUES (?)",
      [noteText],
    );

    res.status(201).json({
      status: "ok",
      message: "Nota guardada en DB",
      inserted_id: result.insertId,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo al guardar nota en DB",
      error: err.message,
    });
  } finally {
    if (connection) await connection.end();
  }
});

// 3) API interactiva de S3 para crear y listar objetos.
app.get("/api/s3/objects", async (req, res) => {
  try {
    const prefix = String(req.query.prefix || "user-notes/");
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        MaxKeys: 20,
      }),
    );

    res.status(200).json({
      status: "ok",
      bucket: S3_BUCKET,
      prefix,
      objects: (listResult.Contents || []).map((obj) => ({
        key: obj.Key,
        size: obj.Size,
        last_modified: obj.LastModified,
      })),
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo al listar objetos en S3",
      error: err.message,
    });
  }
});

app.post("/api/s3/objects", async (req, res) => {
  const fileName = String(req.body?.fileName || "").trim();
  const content = String(req.body?.content || "");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!safeName) {
    return res.status(400).json({
      status: "error",
      message: "fileName es obligatorio",
    });
  }

  if (!content.trim()) {
    return res.status(400).json({
      status: "error",
      message: "content es obligatorio",
    });
  }

  try {
    const key = `user-notes/${Date.now()}-${safeName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: "text/plain",
      }),
    );

    res.status(201).json({
      status: "ok",
      message: "Objeto subido a S3",
      key,
      bucket: S3_BUCKET,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo al subir objeto a S3",
      error: err.message,
    });
  }
});

// 2) Prueba RDS + Secrets Manager: obtiene las credenciales del secreto,
//    se conecta, crea una tabla de prueba, inserta y lee.
app.get("/db-test", async (req, res) => {
  let connection;
  try {
    const dbConfig = await getDbConfig();
    connection = await mysql.createConnection(dbConfig);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS ping_test (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query("INSERT INTO ping_test () VALUES ()");
    const [rows] = await connection.query(
      "SELECT id, created_at FROM ping_test ORDER BY id DESC LIMIT 5",
    );

    res.status(200).json({
      status: "ok",
      message:
        "Credenciales obtenidas de Secrets Manager, conexion a RDS exitosa",
      recent_pings: rows,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo la conexion a RDS o la lectura del secreto",
      error: err.message,
    });
  } finally {
    if (connection) await connection.end();
  }
});

// 3) Prueba S3: sube un archivo de texto pequeno y lista el contenido del bucket.
app.get("/s3-test", async (req, res) => {
  try {
    const key = `ping-test/${Date.now()}.txt`;
    const body = `ping desde la app - ${new Date().toISOString()}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: "text/plain",
      }),
    );

    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: "ping-test/",
        MaxKeys: 5,
      }),
    );

    res.status(200).json({
      status: "ok",
      message: "Archivo subido a S3 via Gateway Endpoint",
      uploaded_key: key,
      recent_objects: (listResult.Contents || []).map((obj) => obj.Key),
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Fallo la subida o lectura en S3",
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
