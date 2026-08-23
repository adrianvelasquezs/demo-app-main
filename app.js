const express = require("express");
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

// 1) Health check simple: no depende de RDS ni de Secrets Manager.
//    Util como health check path del ALB.
app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "La app esta corriendo detras del ALB y Beanstalk",
    timestamp: new Date().toISOString(),
  });
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
      "SELECT id, created_at FROM ping_test ORDER BY id DESC LIMIT 5"
    );

    res.status(200).json({
      status: "ok",
      message: "Credenciales obtenidas de Secrets Manager, conexion a RDS exitosa",
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
      })
    );

    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: "ping-test/",
        MaxKeys: 5,
      })
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
